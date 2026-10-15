#!/usr/bin/env bash
# 01-make-check: `make check` (including web typecheck, oxlint, prettier) exits 0.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd bun
out=$(cd "$root" && make check 2>&1) || fail "make check failed: $(echo "$out" | tail -3 | tr '\n' ' ')"
pass
