#!/usr/bin/env bash
# 09-linter-break: a task whose change breaks typecheck fails at verify
# and merges nothing.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
# shellcheck disable=SC1091
source "$(dirname "$0")/rest.inc"
root="$(git rev-parse --show-toplevel)"
require_cmd curl
require_cmd python3
require_cmd git
require_provider_key
cd "$root" || fail "cannot cd to $root"

for c in agency-backend agency-dispatcher agency-gateway agency-verifier; do
  [ "$(container_health "$c")" = "healthy" ] || fail "$c is not healthy (run check 02 first)"
done
[ -f secrets/allowlist.env ] || fail "no operator passwords (run: make init)"
set -a
# shellcheck disable=SC1091
source secrets/allowlist.env
set +a

token=$(rest_login approver "$AGENCY_APPROVER_PASSWORD") || fail "approver login failed"
body=$(mktemp)
printf '{"objective":"acceptance 09: deliberate type error"}' >"$body"
mission=$(rest_api POST "/api/missions" "$token" "$body" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])') ||
  fail "mission create failed"
rm -f "$body"
objective="This file is a negative control for the fleet verify step. Create src/accept09.ts with byte-for-byte this content and do not correct, format, rename, or improve it in any way: export const accept09: number = \"not a number\";"
mcp_text fleet_plan_submit "$(python3 -c '
import json,sys
mission, objective = sys.argv[1], sys.argv[2]
print(json.dumps({
  "missionId": mission,
  "tasks": [{"key": "accept-09-break", "expert": "backend", "title": "negative control",
             "objective": objective,
             "acceptance": ["src/accept09.ts exists"],
             "paths": ["src/accept09.ts"], "deps": []}]}))' "$mission" "$objective")" >/dev/null ||
  fail "plan submit failed for $mission"
final=$(wait_for_mission "$mission" "$token" 1500) || fail "mission $mission never settled"
[ "$final" = "failed" ] || fail "mission $mission ended $final, want failed"

info=$(rest_api GET "/api/missions/$mission" "$token") || fail "cannot read $mission"
python3 -c '
import json,sys
tasks = {t["id"]: t for t in json.load(sys.stdin)["tasks"]}
verify = [t for t in tasks.values() if t["kind"] == "verify"]
assert verify, "no verify task"
assert all(t["status"] == "failed" for t in verify), f"verify tasks: {[(t[\"id\"], t[\"status\"]) for t in verify]}"
land = [t for t in tasks.values() if t["kind"] == "land"]
assert all(t["status"] != "done" for t in land), "a land task is done after failed verify"
' <<<"$info" || fail "verify-failed/nothing-landed invariant broken in $mission"

branch="fleet/integration/$mission"
merges=$(git -C workspace/demo/repo log --format=%H "main..$branch" 2>/dev/null | wc -l)
[ "$merges" -eq 0 ] || fail "branch $branch holds $merges commit(s) after failed verify"
pass
