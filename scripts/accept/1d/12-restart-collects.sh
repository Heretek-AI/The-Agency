#!/usr/bin/env bash
# 12-restart-collects: killing and restarting the Dispatcher mid-task
# collects the task cleanly instead of stranding it.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
# shellcheck disable=SC1091
source "$(dirname "$0")/rest.inc"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
require_cmd curl
require_cmd python3
require_cmd bun
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
printf '{"objective":"acceptance 12: restart probe"}' >"$body"
mission=$(rest_api POST "/api/missions" "$token" "$body" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])') ||
  fail "mission create failed"
rm -f "$body"
mcp_text fleet_plan_submit "$(python3 -c '
import json,sys
print(json.dumps({
  "missionId": sys.argv[1],
  "tasks": [{"key": "accept-12-long", "expert": "scout", "title": "thorough recon",
             "objective": "Walk the whole demo repository file by file and write a thorough report: every file, its exports, and who calls them. Be exhaustive.",
             "acceptance": ["every file covered"],
             "paths": [], "deps": []}]}))' "$mission")" >/dev/null ||
  fail "plan submit failed for $mission"

running=""
for _ in $(seq 1 20); do
  state=$(rest_api GET "/api/missions/$mission" "$token" | python3 -c '
import json,sys
tasks = json.load(sys.stdin)["tasks"]
print(" ".join(f"{t[\"id\"]}:{t[\"status\"]}" for t in tasks))') || fail "cannot read $mission"
  case "$state" in
    *":running"*)
      running=1
      break
      ;;
  esac
  sleep 15
done
[ -n "$running" ] || fail "scout task never reached running in $mission (state: $state)"

docker restart agency-dispatcher >/dev/null || fail "cannot restart agency-dispatcher"
unhealthy=""
for _ in $(seq 1 60); do
  [ "$(container_health agency-dispatcher)" = "healthy" ] && break
  unhealthy=1
  sleep 10
done
[ -z "$unhealthy" ] || fail "dispatcher never recovered after restart"

# Sessions die with the restart; log in again.
token=$(rest_login approver "$AGENCY_APPROVER_PASSWORD") || fail "re-login failed after restart"
final=$(wait_for_mission "$mission" "$token" 1200) || fail "mission $mission never settled after restart"
case "$final" in
  done | failed | cancelled) ;;
  *) fail "mission $mission ended $final" ;;
esac
state=$(rest_api GET "/api/missions/$mission" "$token" | python3 -c '
import json,sys
tasks = json.load(sys.stdin)["tasks"]
print(" ".join(f"{t[\"id\"]}:{t[\"status\"]}" for t in tasks))') || fail "cannot read $mission"
case "$state" in
  *":running"* | *":ready"* | *":pending"*)
    fail "task stranded after restart in $mission (tasks: $state)"
    ;;
esac
out=$(bun scripts/accept-helpers/audit-chain.ts state/audit 2>&1) ||
  fail "audit chain broken after restart: $out"
pass
