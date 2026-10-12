#!/usr/bin/env bash
# Fixture check: always skips. Proves the runner reports SKIP and exit 77.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
skip "fixture skip for selftest"
