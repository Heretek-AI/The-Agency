#!/usr/bin/env bash
# 10-protocol-examples-parse: the step 3 test passes.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
out=$(cd "$root" && bun test dispatcher/test/protocol-examples.test.ts 2>&1 | tail -4) \
  || fail "protocol examples test failed: $(echo "$out" | tr '\n' ' ')"
pass
