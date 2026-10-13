#!/usr/bin/env bash
# 09-opencode-live: the live client test passes against a real server.
# May skip only when no `opencode` binary is installed (exit 77 via the
# --optional gate below). No other skip-may-pass path exists: an
# OPENCODE_BIN override must resolve, and any SKIP marker in the test output
# is a failure (fail-closed against vacuous passes, 4.1.4/4.6).
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
require_cmd --optional opencode
if [ -n "${OPENCODE_BIN:-}" ]; then
  require_cmd "$OPENCODE_BIN"
fi
root="$(git rev-parse --show-toplevel)"
out=$(cd "$root" && bun test dispatcher/test/live/opencode.live.test.ts 2>&1) || fail "live test failed: $(echo "$out" | tail -5 | tr '\n' ' ')"
if echo "$out" | grep -qF "[opencode-live] SKIP"; then
  fail "live suite skipped instead of running: $(echo "$out" | grep -F "[opencode-live] SKIP" | head -3 | tr '\n' ' ')"
fi
pass
