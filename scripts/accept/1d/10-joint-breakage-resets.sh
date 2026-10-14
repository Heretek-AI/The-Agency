#!/usr/bin/env bash
# 10-joint-breakage: two tasks green alone but red together are caught by
# post-merge verify, and the integration branch is reset to the first
# merge. Both tasks add a plain script file (no imports or exports)
# declaring the same top-level constant, which typechecks alone and
# collides when merged.
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
printf '{"objective":"acceptance 10: joint breakage"}' >"$body"
mission=$(rest_api POST "/api/missions" "$token" "$body" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])') ||
  fail "mission create failed"
rm -f "$body"
objective_a="Create src/accept10a.ts with byte-for-byte this content, as a plain script with no import or export statements, and do not alter, rename, or improve it: const accept10Shared: number = 1; console.log(accept10Shared);"
objective_b="Create src/accept10b.ts with byte-for-byte this content, as a plain script with no import or export statements, and do not alter, rename, or improve it: const accept10Shared: number = 2; console.log(accept10Shared);"
mcp_text fleet_plan_submit "$(python3 -c '
import json,sys
mission, obja, objb = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({
  "missionId": mission,
  "tasks": [
    {"key": "accept-10-a", "expert": "backend", "title": "declare shared once",
     "objective": obja, "acceptance": ["src/accept10a.ts exists"],
     "paths": ["src/accept10a.ts"], "deps": []},
    {"key": "accept-10-b", "expert": "backend", "title": "declare shared twice",
     "objective": objb, "acceptance": ["src/accept10b.ts exists"],
     "paths": ["src/accept10b.ts"], "deps": []}]}))' "$mission" "$objective_a" "$objective_b")" >/dev/null ||
  fail "plan submit failed for $mission"
final=$(wait_for_mission "$mission" "$token" 1500) || fail "mission $mission never settled"
[ "$final" = "failed" ] || fail "mission $mission ended $final, want failed"

info=$(rest_api GET "/api/missions/$mission" "$token") || fail "cannot read $mission"
read -r landed failed_land <<<"$(python3 -c '
import json,sys
tasks = json.load(sys.stdin)["tasks"]
land = [t for t in tasks if t["kind"] == "land"]
done = [t["landedSha"] for t in land if t["status"] == "done" and t["landedSha"]]
bad = [(t["id"], t.get("reason") or "") for t in land if t["status"] == "failed"]
print(f"{done[0] if done else \"\"} {(bad[0][0] + \"/\" + bad[0][1]) if bad else \"\"}")
' <<<"$info")"
[ -n "$landed" ] || fail "no successful first landing in $mission"
[ -n "$failed_land" ] || fail "no failed second landing in $mission"
case "$failed_land" in
  */conflict | */no-worktree | */)
    fail "second landing failed with $failed_land, want a post-merge verify failure"
    ;;
esac
branch="fleet/integration/$mission"
[ "$(git -C workspace/demo/repo rev-parse "$branch")" = "$landed" ] ||
  fail "branch $branch was not reset to the first merge $landed"
pass
