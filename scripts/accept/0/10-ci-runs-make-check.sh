#!/usr/bin/env bash
# 10-ci-runs-make-check: CI invokes `make check` and nothing overrides its
# exit code.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
wf="$root/.github/workflows/ci.yml"
[ -f "$wf" ] || fail "missing $wf"
grep -q "make check" "$wf" || fail "workflow never invokes make check"
if grep -nE '\|\| true|\|\| :|continue-on-error|set \+e' "$wf"; then
  fail "workflow overrides a step exit code"
fi
pass
