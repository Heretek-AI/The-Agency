#!/usr/bin/env bash
# 04-credentials-required: the Dispatcher exits non-zero naming the
# variable when each credential is unset in turn.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
cd "$root" || fail "cannot cd to $root"

[ -f .env ] || fail "no .env (run: make init)"
docker image inspect agency-dispatcher:1.0.0 >/dev/null 2>&1 ||
  fail "agency-dispatcher:1.0.0 missing (run check 02 first)"

vars="FLEET_MCP_TOKEN VERIFIER_TOKEN AGENCY_MODEL"
for expert in director scout architect product frontend backend dba platform security qa reviewer docs; do
  upper=$(printf '%s' "$expert" | tr 'a-z-' 'A-Z_')
  vars="$vars PW_$upper"
done

# Load values without printing them.
set -a
# shellcheck disable=SC1091
source .env
set +a

for var in $vars; do
  args=()
  for v in $vars; do
    [ "$v" = "$var" ] || args+=(-e "$v=${!v}")
  done
  out=$(docker run --rm "${args[@]}" agency-dispatcher:1.0.0 2>&1)
  code=$?
  [ "$code" -ne 0 ] || fail "$var: dispatcher started with the credential unset"
  echo "$out" | grep -q "$var" || fail "$var: exit $code without naming the variable"
done
pass
