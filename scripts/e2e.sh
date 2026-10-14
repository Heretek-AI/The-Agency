#!/usr/bin/env bash
# End to end for Stage 1d (Step 6, `make e2e`): on the demo repository,
# ask the Director through its API to add a /health endpoint returning
# the app version, with a test, and document it in the README. Assert
# backend and docs dispatches, landed commits with trailers, green
# verify, passing tests run by the verifier, endpoint source and README
# text on the branch, and a full audit chain to mission.closed.
# Exit 0 on success, 1 on failure, 77 without a provider key.
set -u
set -o pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root" || exit 1

key_value="$(grep '^OPENCODE_API_KEY=' .env.provider 2>/dev/null | cut -d= -f2)"
if [ -z "$key_value" ] || [ "$key_value" = "disabled-no-key" ]; then
  echo "e2e: SKIP no provider key in .env.provider"
  exit 77
fi

# shellcheck disable=SC1091
source scripts/accept/1d/rest.inc
require_cmd docker
require_cmd curl
require_cmd python3
require_cmd git
require_cmd bun

die() {
  echo "e2e: FAIL $*" >&2
  exit 1
}

for c in agency-director agency-backend agency-docs agency-dispatcher agency-gateway agency-verifier; do
  [ "$(container_health "$c")" = "healthy" ] || die "$c is not healthy (run check 02 first)"
done
[ -f .env ] || die "no .env (run: make init)"
[ -f secrets/allowlist.env ] || die "no operator passwords (run: make init)"
set -a
# shellcheck disable=SC1091
source .env
# shellcheck disable=SC1091
source secrets/allowlist.env
set +a
[ -n "${PW_DIRECTOR:-}" ] || die "PW_DIRECTOR is empty in .env"

token=$(rest_login approver "$AGENCY_APPROVER_PASSWORD") || die "approver login failed"
body=$(mktemp)
printf '{"objective":"e2e: versioned health endpoint"}' >"$body"
mission=$(rest_api POST "/api/missions" "$token" "$body" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])') || die "mission create failed"
rm -f "$body"

# The Director does the planning: prompt its session and let it drive
# the fleet tools, then supervise the mission it created.
port="$(rest_port)"
base="http://127.0.0.1:$port"
session=$(curl -fsS --noproxy '*' -m 20 -u "opencode:$PW_DIRECTOR" -X POST "$base/api/session" \
  -H "Host: director.agency.localhost" -H 'content-type: application/json' \
  -d '{"agent":"director","location":{"directory":"/work/demo/repo"}}' |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])') ||
  die "cannot create a director session"
prompt_body=$(mktemp)
python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' \
  "End-to-end probe for mission $mission. The mission objective is: add a /health endpoint to the demo service that returns the app version from package.json as {status, version}, with a test asserting the version, and document the endpoint in the README. Use your fleet tools: submit one plan with a backend task (key e2e-backend, paths [src/health.ts, src/health.test.ts]) and a docs task (key e2e-docs, paths [README.md]), wait with fleet_wait, decide accepts and rework, and close with fleet_mission_close when everything has landed. Reply with the mission id when you are done." >"$prompt_body"
curl -fsS --noproxy '*' -m 30 -u "opencode:$PW_DIRECTOR" \
  -X POST "$base/api/session/$session/prompt" \
  -H "Host: director.agency.localhost" -H 'content-type: application/json' \
  --data-binary "@$prompt_body" >/dev/null || die "director prompt refused"
rm -f "$prompt_body"

final=$(wait_for_mission "$mission" "$token" 2400) || die "mission $mission never settled"
[ "$final" = "done" ] || die "mission $mission ended $final, want done"

info=$(rest_api GET "/api/missions/$mission" "$token") || die "cannot read $mission"
python3 -c '
import json,sys
tasks = {t["id"]: t for t in json.load(sys.stdin)["tasks"]}
for key in ("e2e-backend", "e2e-docs"):
    assert key in tasks, f"no {key} task dispatched"
land = [t for t in tasks.values() if t["kind"] == "land"]
assert land, "no land tasks"
assert all(t["status"] == "done" and t["landedSha"] for t in land), \
    f"land tasks not all landed: {[(t[\"id\"], t[\"status\"]) for t in land]}"
for t in land:
    verify = (t.get("result") or {}).get("verify") or {}
    assert verify.get("ok"), f"landing {t[\"id\"]} has no green verify record"
' <<<"$info" || die "backend/docs dispatch, landing, or verify record missing in $mission"

branch="fleet/integration/$mission"
tip=$(git -C workspace/demo/repo rev-parse "$branch") || die "no branch $branch"
log=$(git -C workspace/demo/repo log --format=%B "$tip")
echo "$log" | grep -q "Agency-Mission: $mission" || die "no mission trailer on $branch"
echo "$log" | grep -q "Agency-Verify:" || die "no verify trailer on $branch"
echo "$log" | grep -q "Agency-Audit-Tip:" || die "no audit trailer on $branch"
git -C workspace/demo/repo show "$tip:src/health.ts" | grep -q "version" ||
  die "src/health.ts on $branch has no version field"
git -C workspace/demo/repo show "$tip:README.md" | grep -qi "health" ||
  die "README.md on $branch documents no health endpoint"

# The verifier itself runs the branch tests: clone the branch under /work
# (the verifier refuses directories outside its work root) and call it
# through the Dispatcher container, which already joins the fleet network.
rm -rf workspace/e2e-check
git clone -q -b "$branch" workspace/demo/repo workspace/e2e-check 2>/dev/null ||
  die "cannot clone $branch"
verifier_token="$VERIFIER_TOKEN"
out=$(python3 -c 'import json; print(json.dumps({
  "taskId": "e2e-check", "dir": "/work/e2e-check", "setup": ["bun install"],
  "checks": [{"id": "test", "run": "bun test", "timeoutSec": 600}]}))' |
  docker exec -i agency-dispatcher curl -fsS --noproxy '*' -m 600 \
    -X POST http://verifier:8080/run -H "authorization: Bearer $verifier_token" \
    -H 'content-type: application/json' --data-binary @- 2>/dev/null) ||
  die "verifier call failed"
echo "$out" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)["ok"] else 1)' ||
  die "verifier reports failing tests on $branch"
rm -rf workspace/e2e-check

audit_tip=$(git -C workspace/demo/repo log -1 --format=%B "$tip" |
  grep -oE '^Agency-Audit-Tip: [0-9a-f]+' | awk '{print $2}')
[ -n "$audit_tip" ] || die "no audit tip on $tip"
chain=$(bun scripts/accept-helpers/audit-chain.ts state/audit "$audit_tip" 2>&1) ||
  die "audit chain broken: $chain"
python3 -c '
import json,sys
mission, found = sys.argv[1], {"mission.created": False, "mission.closed": False}
with open("state/audit/audit.jsonl") as fh:
    for line in fh:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        data = entry.get("data") or {}
        if data.get("mission") == mission and entry.get("event") in found:
            found[entry["event"]] = True
assert all(found.values()), f"audit chain lacks events: {found}"
' "$mission" || die "audit chain lacks mission.created to mission.closed for $mission"
curl -fsS --noproxy '*' -m 20 -u "opencode:$PW_DIRECTOR" \
  -X DELETE "$base/api/session/$session" \
  -H "Host: director.agency.localhost" >/dev/null 2>&1 ||
  echo "e2e: warning: director session $session left behind" >&2
echo "e2e: PASS mission $mission ($chain)"
