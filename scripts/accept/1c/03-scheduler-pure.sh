#!/usr/bin/env bash
# 03-scheduler-pure: the scheduler tests pass, and scheduler.ts imports
# nothing but the model and the wildcard module and contains no Date,
# timer, or random call.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd bun
out=$(cd "$root" && bun test dispatcher/test/scheduler.test.ts 2>&1) || fail "scheduler tests failed: $(echo "$out" | tail -3 | tr '\n' ' ')"
imports=$(grep -E "^import " "$root/dispatcher/src/scheduler.ts" | grep -v "model.js" | grep -v "wildcard.js" || true)
[ -z "$imports" ] || fail "scheduler.ts imports beyond model/wildcard: $(echo "$imports" | tr '\n' ' ')"
clocked=$(grep -nE "Date|setTimeout|setInterval|setImmediate|Math\.random|Bun\.random|randomUUID|crypto" "$root/dispatcher/src/scheduler.ts" || true)
[ -z "$clocked" ] || fail "scheduler.ts uses clock/timer/random: $(echo "$clocked" | tr '\n' ' ')"
pass
