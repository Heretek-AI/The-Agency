#!/usr/bin/env bash
# 07-no-skips: no vacuous skips in committed unit tests.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
out=$(bash "$root/scripts/check-no-skips.sh" 2>&1) || fail "$out"
pass
