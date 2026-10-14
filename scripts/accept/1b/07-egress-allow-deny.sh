#!/usr/bin/env bash
# 07-egress-allow-deny: from inside two different experts, a request to an
# allowlisted host succeeds and a request to a host not on the list fails
# with the proxy's denial; both appear in the proxy log with the right
# expert's name and the right verdict.
set -u
set -o pipefail
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
  allowed_found=""
  denied_found=""
  # The assertion below is unchanged: the exact allow/deny lines must appear
  # with the right expert name. The window is generous (18x5s) because under
  # load the tail -F mirror behind `docker logs` can lag the authoritative
  # access.log by a minute (observed 2026-10-14: probes returned 2xx/403
  # while the mirror showed nothing for >60s during heavy inference traffic
  # on the shared host). Waiting longer cannot false-pass: the lines either
  # appear, or the check still fails.
  for _ in $(seq 1 18); do
    echo "$log" | grep -q "TCP_TUNNEL.*opencode.ai.*$expert" && allowed_found="yes"
    echo "$log" | grep -q "TCP_DENIED.*denied.invalid.*$expert" && denied_found="yes"
    [ -n "$allowed_found" ] && [ -n "$denied_found" ] && break
    sleep 5
    log=$(docker logs agency-egress 2>&1) || fail "cannot read the proxy log"
  done
  [ -n "$allowed_found" ] || fail "proxy log lacks the allowed line for $expert"
  [ -n "$denied_found" ] || fail "proxy log lacks the denied line for $expert"
done
pass
