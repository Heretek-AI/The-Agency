#!/usr/bin/env bash
# 08-fake-matches-openapi: the fake's route self-check passes.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
out=$(bun --cwd "$root" scripts/check-fake-openapi.ts 2>&1) || fail "$out"
pass
