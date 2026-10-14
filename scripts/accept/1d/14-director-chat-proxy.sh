#!/usr/bin/env bash
# 14-director-chat-proxy: a chat message relays to the Director session
# and the reply plus SSE events stream back through the control plane.
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

for c in agency-director agency-dispatcher agency-gateway; do
  [ "$(container_health "$c")" = "healthy" ] || fail "$c is not healthy (run check 02 first)"
done
[ -f secrets/allowlist.env ] || fail "no operator passwords (run: make init)"
set -a
# shellcheck disable=SC1091
source secrets/allowlist.env
set +a

token=$(rest_login viewer "$AGENCY_VIEWER_PASSWORD") || fail "viewer login failed"
body=$(mktemp)
printf '{"objective":"acceptance 14: chat probe"}' >"$body"
approver=$(rest_login approver "$AGENCY_APPROVER_PASSWORD") || fail "approver login failed"
mission=$(rest_api POST "/api/missions" "$approver" "$body" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])') ||
  fail "mission create failed"
rm -f "$body"
chat_body=$(mktemp)
printf '{"message":"Reply with the single word banana and nothing else."}' >"$chat_body"
sent=$(rest_api POST "/api/missions/$mission/chat" "$token" "$chat_body") ||
  fail "chat send failed"
rm -f "$chat_body"
echo "$sent" | python3 -c 'import json,sys; assert json.load(sys.stdin)["ok"] is True' ||
  fail "chat send not relayed: $sent"

found=""
for _ in $(seq 1 60); do
  transcript=$(rest_api GET "/api/missions/$mission/chat" "$token") ||
    fail "chat transcript unreadable"
  if echo "$transcript" | grep -qi "banana"; then
    found=1
    break
  fi
  sleep 10
done
[ -n "$found" ] || fail "director reply never contained banana"

events=$(curl -sS --noproxy '*' -m 30 -N -H "authorization: Bearer $token" \
  "$(rest_base)/api/missions/$mission/chat/events" --max-time 25) ||
  fail "chat events stream failed"
echo "$events" | grep -q "data:" || fail "chat events stream carried no data frames"
pass
