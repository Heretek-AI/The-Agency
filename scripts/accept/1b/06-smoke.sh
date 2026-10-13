#!/usr/bin/env bash
# 06-smoke: `make smoke` exits 0.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
out=$(cd "$root" && make smoke 2>&1) || fail "make smoke failed: $(echo "$out" | tail -5 | tr '\n' ' ')"
pass
