#!/usr/bin/env bash
# 07-engine-live-scout: the dispatcher engine drives a live scout task to
# a parsed RESULT and a session-written report. Skips only without a
# provider key. Needs ACCEPT_TIMEOUT raised (model round trips take
# minutes): ACCEPT_TIMEOUT=1200 make accept STAGE=1c.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
out=$(cd "$root" && bash scripts/accept/1c/engine-live.inc scout 2>&1)
code=$?
[ "$code" -eq 77 ] && skip "no provider key in .env.provider"
[ "$code" -eq 0 ] || fail "live scout proof failed (exit $code): $(echo "$out" | tail -5 | tr '\n' ' ')"
echo "$out" | grep -qE "[1-9][0-9]* pass" || fail "live scout proof shows no passing test"
pass
