#!/usr/bin/env bash
# 04-single-opencode-module: the client tests pass, and `/api/` path
# strings appear only in dispatcher/src/opencode.ts and in test support
# (dispatcher/test, verifier/test). Scope note: harness scripts and the
# generated compose healthchecks legitimately mention API paths; the rule
# that matters is Dispatcher source, where every OpenCode call must go
# through the one client module.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd bun
out=$(cd "$root" && bun test dispatcher/test/opencode.test.ts dispatcher/test/opencode-contract.test.ts 2>&1) || fail "client tests failed: $(echo "$out" | tail -3 | tr '\n' ' ')"
stray=$(cd "$root" && grep -rn "/api/" dispatcher/src verifier/src --include='*.ts' | grep -v '\.test\.ts' | grep -v 'src/opencode.ts' || true)
[ -z "$stray" ] || fail "OpenCode paths outside opencode.ts: $(echo "$stray" | head -3 | tr '\n' ' ')"
pass
