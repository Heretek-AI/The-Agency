#!/usr/bin/env bash
# 12-no-published-ports: no container in the project has a host port binding.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
ids=$(cd "$root" && docker compose ps -q 2>/dev/null) || fail "docker compose ps failed"
[ -n "$ids" ] || fail "project has no containers to inspect"
bound=$(docker inspect --format '{{.Name}} {{json .HostConfig.PortBindings}}' $ids \
  | grep -v '"PortBindings":{}' | grep -v ':null' || true)
[ -z "$bound" ] || fail "host port bindings exist: $(echo "$bound" | tr '\n' ' ')"
pass
