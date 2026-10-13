#!/usr/bin/env bash
# 01-make-check: the full `make check` pipeline is green.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
out=$(make -C "$root" check 2>&1) || fail "make check failed: $(echo "$out" | tail -3 | tr '\n' ' ')"
pass
