#!/usr/bin/env bash
# 03-compose-hardening: parsed from the generated file, every expert has
# cap_drop ALL, no-new-privileges, pids_limit, cpus, mem_limit, only the
# fleet network, and no ports; every bind has :z; config mounts are
# read-only; ro experts mount /work read-only; nothing mounts a daemon
# socket or sets privileged.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
out=$(cd "$root" && bun scripts/accept-helpers/compose-hardening.ts 2>&1) || fail "$out"
[ "$out" = "hardening ok" ] || fail "$out"
pass
