#!/usr/bin/env bash
# 08-docs-lands: a docs task lands on the integration branch after green
# verify, with the four landing trailers on the merge commit.
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

for c in agency-docs agency-dispatcher agency-gateway agency-verifier; do
  [ "$(container_health "$c")" = "healthy" ] || fail "$c is not healthy (run check 02 first)"
done
[ -f secrets/allowlist.env ] || fail "no operator passwords (run: make init)"
set -a
# shellcheck disable=SC1091
source secrets/allowlist.env
set +a

token=$(rest_login approver "$AGENCY_APPROVER_PASSWORD") || fail "approver login failed"
body=$(mktemp)
printf '{"objective":"acceptance 08: readme line"}' >"$body"
mission=$(rest_api POST "/api/missions" "$token" "$body" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])') ||
  fail "mission create failed"
rm -f "$body"
mcp_text fleet_plan_submit "$(python3 -c '
import json,sys
print(json.dumps({
  "missionId": sys.argv[1],
  "tasks": [{"key": "accept-08-readme", "expert": "docs", "title": "readme line",
             "objective": "Append the line Acceptance-08-was-here to the end of README.md and commit it. Change no other file.",
             "acceptance": ["line present in README.md"],
             "paths": ["README.md"], "deps": []}]}))' "$mission")" >/dev/null ||
  fail "docs plan submit failed for $mission"
final=$(wait_for_mission "$mission" "$token" 1500) || fail "mission $mission never settled"
[ "$final" = "done" ] || fail "mission $mission ended $final, want done"

info=$(rest_api GET "/api/missions/$mission" "$token") || fail "cannot read $mission"
landed=$(python3 -c '
import json,sys
tasks = json.load(sys.stdin)["tasks"]
land = [t for t in tasks if t["kind"] == "land"]
ok = [t for t in land if t["status"] == "done" and t["landedSha"]]
print(ok[0]["landedSha"] if ok else "")
' <<<"$info")
[ -n "$landed" ] || fail "no landed land task in $mission"
branch="fleet/integration/$mission"
[ "$(git -C workspace/demo/repo rev-parse "$branch")" = "$landed" ] ||
  fail "branch $branch tip is not the landed sha $landed"
message=$(git -C workspace/demo/repo log -1 --format=%B "$landed")
for trailer in "Agency-Mission: $mission" "Agency-Task: accept-08-readme" "Agency-Verify:" "Agency-Audit-Tip:"; do
  echo "$message" | grep -qF "$trailer" || fail "merge $landed lacks trailer $trailer"
done
git -C workspace/demo/repo show "$landed:README.md" | grep -q "Acceptance-08-was-here" ||
  fail "landed README.md lacks the acceptance line"
pass
