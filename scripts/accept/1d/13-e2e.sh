#!/usr/bin/env bash
# 13-e2e: Step 6 passes through `make e2e`.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd bun
require_cmd docker
out=$(cd "$root" && make e2e 2>&1)
code=$?
echo "$out" | tail -5
# GNU make reports the recipe's 77 as its own failure (exit 2); the SKIP
# line inside the output is the authority, not make's exit code.
if echo "$out" | grep -q "e2e: SKIP"; then
  skip "make e2e skipped (no provider key)"
fi
[ "$code" -eq 0 ] || fail "make e2e failed: $(echo "$out" | tail -3 | tr '\n' ' ')"
echo "$out" | grep -q "e2e: PASS" || fail "make e2e exited 0 without the PASS line"
pass
