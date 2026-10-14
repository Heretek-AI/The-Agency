#!/usr/bin/env bash
# 05-verifier-live: the deployed verifier is healthy; a wrong token gets
# 401; a `dir` outside /work is refused; the demo repository's checks run
# green; a worktree with a deliberate lint error runs red with the failing
# check named; an empty check list returns `no-checks`; a check that
# backgrounds a process and times out leaves no process behind.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
cd "$root" || fail "cannot cd to $root"

base="http://127.0.0.1:8080"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# vexec runs a command inside the verifier container.
vexec() {
  docker compose exec -T verifier "$@"
}

# vpost <path> <body-file> [bearer]: POST JSON from a host file via stdin
# (curl -d @-). Prints the HTTP code to stdout; the response body lands in
# $work/resp.json. Fails when the request itself cannot be made.
vpost() {
  local path="$1" body="$2" bearer="${3:-__none__}"
  local auth=()
  [ "$bearer" = "__none__" ] || auth=(-H "Authorization: Bearer $bearer")
  rm -f "$work/resp.json"
  local code
  code=$(vexec curl -s -o /tmp/vresp.json -w '%{http_code}' --noproxy '*' \
    -X POST "$base$path" -H 'content-type: application/json' "${auth[@]}" \
    -d @- <"$body") || fail "POST $path unreachable"
  docker compose exec -T verifier cat /tmp/vresp.json >"$work/resp.json" \
    || fail "cannot read verifier response"
  printf '%s' "$code"
}

token="$(vexec sh -c 'printf "%s" "$VERIFIER_TOKEN"')" \
  || fail "cannot read VERIFIER_TOKEN from the verifier container"
[ -n "$token" ] || fail "VERIFIER_TOKEN is empty in the verifier container"

# 1. Healthy and open.
health=$(vexec curl -fsS --noproxy '*' "$base/healthz") \
  || fail "GET /healthz failed"
echo "$health" | grep -q '"ok":true' || fail "healthz is not ok: $health"

# 2. A wrong token gets 401.
printf '{"taskId":"c05-auth","dir":"/work/demo/repo","checks":[]}' >"$work/auth.json"
code=$(vpost /run "$work/auth.json" "wrong-token")
[ "$code" = "401" ] || fail "wrong token got HTTP $code, want 401"

# 3. A dir outside /work is refused.
printf '{"taskId":"c05-outside","dir":"/tmp","checks":[]}' >"$work/outside.json"
code=$(vpost /run "$work/outside.json" "$token")
[ "$code" = "403" ] || fail "outside dir got HTTP $code, want 403"
grep -q '"reason":"outside-work"' "$work/resp.json" \
  || fail "outside dir has the wrong reason: $(cat "$work/resp.json")"

# 4. The demo repository's declared checks run green.
cat >"$work/green.json" <<'JSON'
{"taskId":"c05-green","dir":"/work/demo/repo","setup":["bun install"],
 "checks":[{"id":"format","run":"bun run format:check","timeoutSec":300},
           {"id":"lint","run":"bun run lint","timeoutSec":300},
           {"id":"typecheck","run":"bun run typecheck","timeoutSec":600},
           {"id":"test","run":"bun test","timeoutSec":900}]}
JSON
code=$(vpost /run "$work/green.json" "$token")
[ "$code" = "200" ] || fail "green run got HTTP $code: $(cat "$work/resp.json")"
grep -q '"ok":true' "$work/resp.json" || fail "green run is not ok: $(cat "$work/resp.json")"
for id in format lint typecheck test; do
  grep -q "\"id\":\"$id\",\"exit\":0" "$work/resp.json" \
    || fail "green run: check $id is not exit 0: $(cat "$work/resp.json")"
done

# 5. A worktree with a deliberate lint error runs red, naming the check.
lint_tree="$root/workspace/demo/trees/c05-lint"
git -C "$root/workspace/demo/repo" worktree remove --force "$lint_tree" >/dev/null 2>&1 || true
git -C "$root/workspace/demo/repo" branch -D "fleet/c05-lint" >/dev/null 2>&1 || true
git -C "$root/workspace/demo/repo" worktree add "$lint_tree" -b "fleet/c05-lint" >/dev/null 2>&1 \
  || fail "cannot create lint worktree"
cleanup_lint() {
  git -C "$root/workspace/demo/repo" worktree remove --force "$lint_tree" >/dev/null 2>&1 || true
  git -C "$root/workspace/demo/repo" branch -D "fleet/c05-lint" >/dev/null 2>&1 || true
}
printf 'const broken = (;\n' >"$lint_tree/src/c05-break.ts"
cat >"$work/red.json" <<'JSON'
{"taskId":"c05-red","dir":"/work/demo/trees/c05-lint","setup":["bun install"],
 "checks":[{"id":"lint","run":"bun run lint","timeoutSec":300}]}
JSON
code=$(vpost /run "$work/red.json" "$token")
[ "$code" = "200" ] || { cleanup_lint; fail "red run got HTTP $code"; }
if ! grep -q '"ok":false' "$work/resp.json" \
  || ! grep -q '"id":"lint"' "$work/resp.json" \
  || grep -q '"exit":0' "$work/resp.json"; then
  cleanup_lint
  fail "red run does not name failing check lint: $(cat "$work/resp.json")"
fi
cleanup_lint

# 6. An empty check list returns no-checks, never success.
printf '{"taskId":"c05-empty","dir":"/work/demo/repo","checks":[]}' >"$work/empty.json"
code=$(vpost /run "$work/empty.json" "$token")
[ "$code" = "200" ] || fail "empty run got HTTP $code"
grep -q '"ok":false' "$work/resp.json" \
  && grep -q '"reason":"no-checks"' "$work/resp.json" \
  || fail "empty check list is not a no-checks failure: $(cat "$work/resp.json")"

# 7. A check that backgrounds a process and times out leaves none behind.
cat >"$work/bg.json" <<'JSON'
{"taskId":"c05-bg","dir":"/work/demo/repo",
 "checks":[{"id":"bg","run":"sh -c 'sleep 297 & sleep 4'","timeoutSec":2}]}
JSON
code=$(vpost /run "$work/bg.json" "$token")
[ "$code" = "200" ] || fail "background run got HTTP $code"
grep -q '"ok":false' "$work/resp.json" \
  || fail "timed-out background check is not a failure: $(cat "$work/resp.json")"
leftover=""
for _ in $(seq 1 15); do
  leftover=$(vexec sh -c 'ps -ef | grep "[s]leep 297" || true')
  [ -z "$leftover" ] && break
  sleep 2
done
[ -z "$leftover" ] || fail "backgrounded sleep survived the timeout: $leftover"

pass
