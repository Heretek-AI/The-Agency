#!/usr/bin/env bash
# 01-render-check: `make render-check` exits 0 (no generated file stale).
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
out=$(cd "$root" && make render-check 2>&1) || fail "make render-check failed: $(echo "$out" | tail -3 | tr '\n' ' ')"
pass
