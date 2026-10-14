#!/usr/bin/env bash
# Garbage-collect finished missions' worktrees through the Dispatcher
# (`make gc`). Logs in as admin through the gateway and calls POST
# /api/gc. Fails closed when the service is down or the login fails.
set -u
set -o pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root" || exit 1

[ -f .env ] || { echo "gc: no .env (run: make init)" >&2; exit 1; }
[ -f secrets/allowlist.env ] || { echo "gc: no operator passwords (run: make init)" >&2; exit 1; }
port="$(grep '^AGENCY_HTTP_PORT=' .env | cut -d= -f2)"
port="${port:-8081}"
set -a
# shellcheck disable=SC1091
source secrets/allowlist.env
set +a

token=$(curl -fsS --noproxy '*' -m 20 -X POST "http://127.0.0.1:$port/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$AGENCY_ADMIN_PASSWORD\"}" 2>/dev/null |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])') || {
  echo "gc: admin login failed" >&2
  exit 1
}
curl -fsS --noproxy '*' -m 60 -X POST "http://127.0.0.1:$port/api/gc" \
  -H "authorization: Bearer $token" || {
  echo "gc: POST /api/gc failed" >&2
  exit 1
}
echo ""
