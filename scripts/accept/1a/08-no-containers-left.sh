#!/usr/bin/env bash
# 08-no-containers-left: no container with the spike's name prefix exists
# (spike.sh and every accept check tear down by name, including on failure).
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
require_cmd docker
left=$(docker ps -a --format '{{.Names}}' | grep '^agency-spike')
[ -z "$left" ] || fail "leftover container(s): $(echo "$left" | tr '\n' ' ')"
pass
