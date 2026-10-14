#!/usr/bin/env bash
# 09-unique-passwords: every expert rejects every other expert's password.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
set -a
# shellcheck disable=SC1091
source "$root/.env"
set +a
names="director scout architect product frontend backend dba platform security qa reviewer docs"
for name in $names; do
  upper=$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
  pw_var="PW_$upper"
  pw="${!pw_var:-}"
  [ -n "$pw" ] || fail "$name: $pw_var is empty"
  code=$(docker exec "agency-$name" curl -sS --noproxy '*' --max-time 30 -u "opencode:$pw" -o /dev/null \
    -w '%{http_code}' http://127.0.0.1:4096/api/info) || fail "$name: own password probe failed"
  [ "$code" = "200" ] || fail "$name: own password rejected"
  for other in $names; do
    [ "$other" = "$name" ] && continue
    other_upper=$(printf '%s' "$other" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
    other_var="PW_$other_upper"
    code=$(docker exec "agency-$name" curl -sS --noproxy '*' --max-time 30 -u "opencode:${!other_var}" -o /dev/null \
      -w '%{http_code}' http://127.0.0.1:4096/api/info) || fail "$name: cross-password probe failed"
    [ "$code" = "401" ] || fail "$name accepted $other's password (status $code)"
  done
done
pass
