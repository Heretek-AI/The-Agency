#!/usr/bin/env bash
# 07-scout-completes: a scout task completes with a report through REST.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
# shellcheck disable=SC1091
source "$(dirname "$0")/rest.inc"
root="$(git rev-parse --show-toplevel)"
require_cmd curl
require_cmd python3
require_provider_key
cd "$root" || fail "cannot cd to $root"

for c in agency-scout agency-dispatcher agency-gateway agency-verifier; do
  [ "$(container_health "$c")" = "healthy" ] || fail "$c is not healthy (run check 02 first)"
done
[ -f secrets/allowlist.env ] || fail "no operator passwords (run: make init)"
set -a
# shellcheck disable=SC1091
source secrets/allowlist.env
set +a

token=$(rest_login approver "$AGENCY_APPROVER_PASSWORD") || fail "approver login failed"
body=$(mktemp)
printf '{"objective":"acceptance 07: scout report"}' >"$body"
mission=$(rest_api POST "/api/missions" "$token" "$body" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])') ||
  fail "mission create failed"
rm -f "$body"
mcp_text fleet_plan_submit "$(python3 -c '
import json,sys
print(json.dumps({
  "missionId": sys.argv[1],
  "tasks": [{"key": "accept-07-recon", "expert": "scout", "title": "recon",
             "objective": "List every top-level directory in the demo repository with one line on what it holds.",
             "acceptance": ["every top-level directory listed"],
             "paths": [], "deps": []}]}))' "$mission")" >/dev/null ||
  fail "scout plan submit failed for $mission"
final=$(wait_for_mission "$mission" "$token" 1200) || fail "mission $mission never settled"
[ "$final" = "done" ] || fail "mission $mission ended $final, want done"
report=$(mcp_text fleet_task_result '{"taskId": "accept-07-recon"}') ||
  fail "task result unreadable for accept-07-recon"
echo "$report" | grep -qi "src" || fail "scout report names no repository content"
pass
