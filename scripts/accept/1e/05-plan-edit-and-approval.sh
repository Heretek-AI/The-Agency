#!/usr/bin/env bash
# 05-plan-edit-and-approval: Playwright plan-edit.spec.ts against a fresh seeded server.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
# shellcheck disable=SC1091
source "$(dirname "$0")/_server.inc"
root="$(git rev-parse --show-toplevel)"
require_cmd bun

start_1e_server || fail "seeded server failed to start"
trap 'stop_1e_server' EXIT

out=$(cd "$root/dispatcher/web" && ACCEPT_1E_URL="$ACCEPT_1E_URL" bunx playwright test test/e2e/plan-edit.spec.ts 2>&1) \
  || fail "playwright plan-edit.spec.ts failed: $(echo "$out" | grep -E 'failed|Error' | head -2 | tr '\n' ' ')"
pass
