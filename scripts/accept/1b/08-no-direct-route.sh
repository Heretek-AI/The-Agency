#!/usr/bin/env bash
# 08-no-direct-route: from inside an expert, a request that bypasses the
# proxy to an external address fails, and a request through the proxy to a
# private/metadata address is denied with the proxy 403.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
require_cmd docker
if docker exec agency-backend curl -sS -o /dev/null --noproxy '*' --max-time 20 https://opencode.ai/ 2>/dev/null; then
  fail "direct route out exists (bypassed the proxy successfully)"
fi
code=$(docker exec agency-backend sh -c 'curl -sS -o /dev/null -w "%{http_code}" --max-time 20 http://169.254.169.254/') \
  || fail "metadata probe errored instead of returning the proxy denial"
[ "$code" = "403" ] || fail "metadata address through the proxy returned $code, want the proxy 403"
pass
