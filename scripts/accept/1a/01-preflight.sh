#!/usr/bin/env bash
# 01-preflight: `scripts/preflight.sh` exits 0. Strict: no skip — without a
# provider key this check fails honestly (the stage is then incomplete).
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
out=$("$root/scripts/preflight.sh" 2>&1) || fail "preflight exited non-zero: $(echo "$out" | tail -2 | tr '\n' ' ')"
pass
