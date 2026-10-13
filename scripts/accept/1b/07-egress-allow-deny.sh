#!/usr/bin/env bash
# 07-egress-allow-deny: from inside two different experts, a request to an
# allowlisted host succeeds and a request to a host not on the list fails
# with the proxy's denial; both appear in the proxy log with the right
# expert's name and the right verdict.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
require_cmd docker
probe() {
  # probe <container> <url> -> http code on stdout (curl uses the
  # container's proxy env; no secret is printed)
  docker exec "$1" sh -c 'curl -sS -o /dev/null -w "%{http_code}" --max-time 30 "$0"' "$2"
}
check_expert() {
  local container="$1" code
  code=$(probe "$container" "https://opencode.ai/") || fail "$container: allowlisted request failed"
  case "$code" in 2?? | 3??) ;; *) fail "$container: allowlisted host returned $code, want 2xx/3xx";; esac
  # Plain HTTP here: a denied CONNECT aborts the tunnel (curl 56) instead
  # of returning a status, while a denied GET returns the proxy 403.
  code=$(probe "$container" "http://denied.invalid/") || fail "$container: denied request errored instead of returning the proxy denial"
  [ "$code" = "403" ] || fail "$container: non-listed host returned $code, want the proxy 403"
}
check_expert agency-backend
check_expert agency-scout
log=$(docker logs agency-egress 2>&1) || fail "cannot read the proxy log"
for expert in backend scout; do
  echo "$log" | grep -q "TCP_TUNNEL.*opencode.ai.*$expert" \
    || fail "proxy log lacks the allowed line for $expert"
  echo "$log" | grep -q "TCP_DENIED.*denied.invalid.*$expert" \
    || fail "proxy log lacks the denied line for $expert"
done
pass
