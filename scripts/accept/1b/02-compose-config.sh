#!/usr/bin/env bash
# 02-compose-config: `docker compose config -q` exits 0.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
out=$(cd "$root" && docker compose config -q 2>&1) || fail "docker compose config -q failed: $(echo "$out" | tail -3 | tr '\n' ' ')"
pass
