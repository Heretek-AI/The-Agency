#!/usr/bin/env bash
# 11-scope-refusal: a docs task told to edit src/ is refused at plan
# validation time. Needs no model, only the running stack.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
# shellcheck disable=SC1091
source "$(dirname "$0")/rest.inc"
root="$(git rev-parse --show-toplevel)"
require_cmd curl
require_cmd python3
cd "$root" || fail "cannot cd to $root"

[ "$(container_health agency-dispatcher)" = "healthy" ] ||
  fail "agency-dispatcher is not healthy (run check 02 first)"
[ -f secrets/allowlist.env ] || fail "no operator passwords (run: make init)"
set -a
# shellcheck disable=SC1091
source secrets/allowlist.env
set +a

token=$(rest_login approver "$AGENCY_APPROVER_PASSWORD") || fail "approver login failed"
body=$(mktemp)
printf '{"objective":"acceptance 11: scope probe"}' >"$body"
mission=$(rest_api POST "/api/missions" "$token" "$body" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])') ||
  fail "mission create failed"
rm -f "$body"
if out=$(mcp_text fleet_plan_submit "$(python3 -c '
import json,sys
print(json.dumps({
  "missionId": sys.argv[1],
  "tasks": [{"key": "accept-11-scope", "expert": "docs", "title": "out of scope",
             "objective": "Edit src/ to change server behavior.",
             "acceptance": ["server behavior changed"],
             "paths": ["src/hack.ts"], "deps": []}]}))' "$mission")"); then
  fail "out-of-grant plan was accepted for $mission"
fi
echo "$out" | grep -qi "outside" || fail "refusal never named the grant: $out"
cancelled=$(rest_api POST "/api/missions/$mission/cancel" "$token") ||
  fail "cannot cancel probe mission $mission"
echo "$cancelled" | grep -q '"cancelled"' || fail "probe mission not cancelled: $cancelled"
pass
