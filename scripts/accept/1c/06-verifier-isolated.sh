#!/usr/bin/env bash
# 06-verifier-isolated: the deployed verifier's environment has no provider
# key, and an expert container calling it without the token is refused.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
cd "$root" || fail "cannot cd to $root"

env_out=$(docker compose exec -T verifier env 2>&1) \
  || fail "cannot read the verifier environment"
echo "$env_out" | grep -q "OPENCODE_API_KEY" \
  && fail "the verifier environment carries a provider key"
echo "$env_out" | grep -q "^VERIFIER_TOKEN=.\+" \
  || fail "the verifier has no VERIFIER_TOKEN to guard with"

code=$(docker compose exec -T scout curl -s -o /dev/null -w '%{http_code}' \
  --noproxy '*' -X POST http://verifier:8080/run \
  -H 'content-type: application/json' \
  -d '{"taskId":"c06-notoken","dir":"/work/demo/repo","checks":[]}' 2>&1) \
  || fail "the expert could not reach the verifier at all"
[ "$code" = "401" ] || fail "tokenless expert call got HTTP $code, want 401"

pass
