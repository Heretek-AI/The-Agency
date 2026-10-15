#!/usr/bin/env bash
# 02-web-build: the web bundle builds and the Dispatcher serves it at `/`.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
# shellcheck disable=SC1091
source "$(dirname "$0")/_server.inc"
root="$(git rev-parse --show-toplevel)"
require_cmd bun
require_cmd curl

bun run --cwd "$root/dispatcher/web" build >/tmp/accept-1e-build.log 2>&1 \
  || fail "web build failed: $(tail -3 /tmp/accept-1e-build.log | tr '\n' ' ')"
[ -f "$root/dispatcher/dist/web/index.html" ] || fail "dist index.html is missing after build"
grep -q "The Agency" "$root/dispatcher/dist/web/index.html" || fail "dist index.html is not the app shell"

start_1e_server || fail "seeded server failed to start"
trap 'stop_1e_server' EXIT

body=$(curl -fs "$ACCEPT_1E_URL/") || fail "GET / did not return 2xx"
echo "$body" | grep -q "The Agency" || fail "GET / did not serve the app shell"
ctype=$(curl -fs -o /dev/null -w "%{content_type}" "$ACCEPT_1E_URL/")
[ "$ctype" = "text/html; charset=utf-8" ] || fail "GET / content-type is $ctype"
spa=$(curl -fs "$ACCEPT_1E_URL/missions/m-chat") || fail "SPA fallback route did not return 2xx"
echo "$spa" | grep -q "The Agency" || fail "SPA fallback did not serve the app shell"
code=$(curl -s -o /dev/null -w "%{http_code}" "$ACCEPT_1E_URL/api/auth/me")
[ "$code" = "401" ] || fail "anonymous /api/auth/me returned $code instead of 401"
pass
