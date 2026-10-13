#!/usr/bin/env bash
# 08-no-containers-left: no container with the spike's name prefix exists
# (spike.sh and every accept check tear down by name, including on failure).
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
require_cmd docker
ps_out=$(docker ps -a --format '{{.Names}}') || fail "docker ps -a failed; cannot prove no container is left behind"
left=$(printf '%s' "$ps_out" | grep '^agency-spike')
[ -z "$left" ] || fail "leftover container(s): $(echo "$left" | tr '\n' ' ')"
pass
