#!/usr/bin/env bash
# 09-opencode-live: the live client test passes against a real server.
# May skip only when no `opencode` binary is installed.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
require_cmd --optional opencode
root="$(git rev-parse --show-toplevel)"
out=$(bun --cwd "$root" test dispatcher/test/live/opencode.live.test.ts 2>&1) || fail "live test failed: $(echo "$out" | tail -5 | tr '\n' ' ')"
pass
