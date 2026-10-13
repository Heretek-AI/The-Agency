#!/usr/bin/env bash
# Fixture check: always passes. Proves the runner reports PASS and exit 0.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
pass
