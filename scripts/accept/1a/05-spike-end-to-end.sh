#!/usr/bin/env bash
# 05-spike-end-to-end: scripts/spike.sh exits 0. Skips ONLY when
# .env.provider has no usable key. A present-but-bad key runs the script
# and fails (fail-closed, never a pass).
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker

key=$(sed -n 's/^OPENCODE_API_KEY=//p' "$root/.env.provider" 2>/dev/null | head -1 | sed 's/[[:space:]]*#.*//;s/^[[:space:]]*//;s/[[:space:]]*$//')
[ -n "$key" ] || skip ".env.provider has no usable OPENCODE_API_KEY"

out=$(bash "$root/scripts/spike.sh" 2>&1) || fail "spike.sh failed: $(echo "$out" | tail -3 | tr '\n' ' ')"
echo "$out" | grep -q '^SPIKE PASS' || fail "spike.sh exited 0 without SPIKE PASS"
ps_out=$(docker ps -a --format '{{.Names}}') || fail "docker ps -a failed; cannot prove no container is left behind"
left=$(printf '%s' "$ps_out" | grep '^agency-spike')
[ -z "$left" ] || fail "spike left container(s) behind: $(echo "$left" | tr '\n' ' ')"
pass
