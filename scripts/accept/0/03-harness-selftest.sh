#!/usr/bin/env bash
# 03-harness-selftest: the acceptance harness unit tests pass.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
out=$(cd "$root" && bun test scripts/accept/test/accept.test.ts 2>&1) || fail "harness tests failed: $(echo "$out" | tail -3 | tr '\n' ' ')"
pass
