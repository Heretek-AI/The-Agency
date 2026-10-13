#!/usr/bin/env bash
# 02-ts-coverage: every tracked .ts/.tsx is inside the typecheck.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
out=$(cd "$root" && bun scripts/check-ts-coverage.ts 2>&1) || fail "$out"
pass
