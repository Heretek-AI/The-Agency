#!/usr/bin/env bash
# 05-up-healthy: after `make up`, twelve experts and the proxy are healthy.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
out=$(cd "$root" && make up 2>&1 | tail -3) || fail "make up failed: $(echo "$out" | tr '\n' ' ')"
for _ in $(seq 1 60); do
  unhealthy=""
  for c in agency-director agency-scout agency-architect agency-product agency-frontend agency-backend agency-dba agency-platform agency-security agency-qa agency-reviewer agency-docs agency-egress; do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" = "healthy" ] || unhealthy="$unhealthy $c"
  done
  [ -z "$unhealthy" ] && pass
  sleep 10
done
fail "never healthy:$unhealthy"
