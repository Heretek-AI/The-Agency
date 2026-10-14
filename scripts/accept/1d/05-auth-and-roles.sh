#!/usr/bin/env bash
# 05-auth-and-roles: unauthenticated requests get 401, viewer approval
# gets 403, approver approval succeeds, and only admin runs GC. Drives
# an ephemeral Dispatcher on the fleet network with known credentials so
# production state is never touched.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
# shellcheck disable=SC1091
source "$(dirname "$0")/rest.inc"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
require_cmd bun
require_cmd python3
cd "$root" || fail "cannot cd to $root"

[ -f .env ] || fail "no .env (run: make init)"
docker image inspect agency-dispatcher:1.0.0 >/dev/null 2>&1 ||
  fail "agency-dispatcher:1.0.0 missing (run check 02 first)"
for c in agency-director agency-verifier; do
  [ "$(container_health "$c")" = "healthy" ] || fail "$c is not healthy (run check 02 first)"
done
[ -d workspace/demo/repo ] || fail "workspace/demo/repo missing (run check 02 first)"

work=$(mktemp -d)
trap 'docker rm -f agency-dispatcher-test >/dev/null 2>&1; rm -rf "$work"' EXIT
mkdir -p "$work/state/registry/demo"
cp registry.example/demo/repo.yaml registry.example/demo/ownership.yaml \
  registry.example/demo/checks.yaml "$work/state/registry/demo/" ||
  fail "cannot seed test registry"
hash_of() {
  bun -e 'console.log(await Bun.password.hash(process.argv[1], { algorithm: "argon2id" }))' "$1" ||
    return 1
}
{
  echo "version: 1"
  echo "users:"
  echo "  - username: admin"
  echo "    role: admin"
  echo "    passwordHash: '$(hash_of test-admin-pw)'"
  echo "  - username: approver"
  echo "    role: approver"
  echo "    passwordHash: '$(hash_of test-approver-pw)'"
  echo "  - username: viewer"
  echo "    role: viewer"
  echo "    passwordHash: '$(hash_of test-viewer-pw)'"
} >"$work/state/registry/allowlist.yaml" || fail "cannot write test allowlist"
chmod 600 "$work/state/registry/allowlist.yaml"

# Values travel inside docker only, never into logs.
set -a
# shellcheck disable=SC1091
source .env
set +a
docker rm -f agency-dispatcher-test >/dev/null 2>&1 || true
artifacts_vol=$(docker inspect agency-verifier \
  --format '{{ range .Mounts }}{{ if eq .Destination "/artifacts" }}{{ print .Name }}{{ end }}{{ end }}' 2>/dev/null) ||
  fail "cannot find the artifacts volume (run check 02 first)"
[ -n "$artifacts_vol" ] || fail "verifier has no /artifacts mount (run check 02 first)"
docker run -d --name agency-dispatcher-test --network agency_fleet \
  -p 127.0.0.1:18080:8080 \
  -v "$root/workspace:/work:rw,z" \
  -v "$artifacts_vol:/artifacts:z" \
  -v "$work/state:/data:rw,z" \
  -e AGENCY_MODEL="$AGENCY_MODEL" -e FLEET_MCP_TOKEN="$FLEET_MCP_TOKEN" \
  -e VERIFIER_TOKEN="$VERIFIER_TOKEN" \
  -e PW_DIRECTOR="$PW_DIRECTOR" -e PW_SCOUT="$PW_SCOUT" \
  -e PW_ARCHITECT="$PW_ARCHITECT" -e PW_PRODUCT="$PW_PRODUCT" \
  -e PW_FRONTEND="$PW_FRONTEND" -e PW_BACKEND="$PW_BACKEND" \
  -e PW_DBA="$PW_DBA" -e PW_PLATFORM="$PW_PLATFORM" \
  -e PW_SECURITY="$PW_SECURITY" -e PW_QA="$PW_QA" \
  -e PW_REVIEWER="$PW_REVIEWER" -e PW_DOCS="$PW_DOCS" \
  -e DISPATCHER_STATE_DIR=/data -e DISPATCHER_REGISTRY_DIR=/data/registry \
  -e DISPATCHER_WORKSPACE=/work -e DISPATCHER_ARTIFACTS=/artifacts \
  -e DISPATCHER_ALLOWLIST=/data/registry/allowlist.yaml \
  agency-dispatcher:1.0.0 >/dev/null || fail "cannot start test dispatcher"

test_base="http://127.0.0.1:18080"
healthy=""
for _ in $(seq 1 36); do
  if curl -fsS --noproxy '*' -m 5 "$test_base/healthz" 2>/dev/null | grep -q '"ok":true'; then
    healthy=1
    break
  fi
  sleep 5
done
[ -n "$healthy" ] || fail "test dispatcher never healthy"

anon=$(curl -sS --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$test_base/api/fleet") ||
  fail "anonymous fleet request failed"
[ "$anon" = "401" ] || fail "anonymous fleet request returned $anon, want 401"

viewer=$(curl -fsS --noproxy '*' -m 10 -X POST "$test_base/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"username":"viewer","password":"test-viewer-pw"}' |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])') ||
  fail "viewer login failed"
wrong=$(curl -sS --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' \
  -X POST "$test_base/api/auth/login" -H 'content-type: application/json' \
  -d '{"username":"viewer","password":"wrong"}') || fail "wrong-password probe failed"
[ "$wrong" = "401" ] || fail "wrong password returned $wrong, want 401"

approver=$(curl -fsS --noproxy '*' -m 10 -X POST "$test_base/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"username":"approver","password":"test-approver-pw"}' |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])') ||
  fail "approver login failed"
admin=$(curl -fsS --noproxy '*' -m 10 -X POST "$test_base/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"test-admin-pw"}' |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])') ||
  fail "admin login failed"

mission=$(curl -fsS --noproxy '*' -m 10 -X POST "$test_base/api/missions" \
  -H "authorization: Bearer $approver" -H 'content-type: application/json' \
  -d '{"objective":"role probe"}' |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])') ||
  fail "approver mission create failed"
mcptoken="$FLEET_MCP_TOKEN"
plan=$(curl -fsS --noproxy '*' -m 30 -X POST "$test_base/mcp" \
  -H "authorization: Bearer $mcptoken" -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"fleet_plan_submit\",\"arguments\":{\"missionId\":\"$mission\",\"tasks\":[{\"key\":\"t1\",\"expert\":\"scout\",\"objective\":\"look\",\"acceptance\":[\"report\"],\"paths\":[],\"deps\":[]},{\"key\":\"t2\",\"expert\":\"scout\",\"objective\":\"look\",\"acceptance\":[\"report\"],\"paths\":[],\"deps\":[]},{\"key\":\"t3\",\"expert\":\"scout\",\"objective\":\"look\",\"acceptance\":[\"report\"],\"paths\":[],\"deps\":[]},{\"key\":\"t4\",\"expert\":\"scout\",\"objective\":\"look\",\"acceptance\":[\"report\"],\"paths\":[],\"deps\":[]}]}}}") ||
  fail "plan submit through MCP failed"
echo "$plan" | grep -q 'waiting-human' || fail "four-task plan did not park: $plan"

code=$(curl -sS --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' \
  -X POST "$test_base/api/missions/$mission/approve" -H "authorization: Bearer $viewer") ||
  fail "viewer approve probe failed"
[ "$code" = "403" ] || fail "viewer approve returned $code, want 403"

code=$(curl -sS --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' \
  -X POST "$test_base/api/missions/$mission/approve" -H "authorization: Bearer $approver") ||
  fail "approver approve probe failed"
[ "$code" = "200" ] || fail "approver approve returned $code, want 200"

code=$(curl -sS --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' \
  -X POST "$test_base/api/gc" -H "authorization: Bearer $approver") ||
  fail "approver gc probe failed"
[ "$code" = "403" ] || fail "approver gc returned $code, want 403"
code=$(curl -sS --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' \
  -X POST "$test_base/api/gc" -H "authorization: Bearer $admin") ||
  fail "admin gc probe failed"
[ "$code" = "200" ] || fail "admin gc returned $code, want 200"
code=$(curl -sS --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' \
  -X POST "$test_base/api/gc") || fail "anonymous gc probe failed"
[ "$code" = "401" ] || fail "anonymous gc returned $code, want 401"
pass
