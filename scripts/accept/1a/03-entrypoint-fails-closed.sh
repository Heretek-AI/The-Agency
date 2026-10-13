#!/usr/bin/env bash
# 03-entrypoint-fails-closed: no password, then no API key: each makes the
# container exit non-zero quickly and name the variable in its log.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
tag="$(grep '^OPENCODE_VERSION=' "$root/versions.env" | cut -d= -f2)"
image="agency-base:$tag"
name="agency-spike-accept03"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
require_cmd docker

docker image inspect "$image" >/dev/null 2>&1 || fail "image $image absent (run: make build-base)"

# Case 1: password empty, key present (dummy value, never written to a file).
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" -e OPENCODE_PASSWORD= -e OPENCODE_API_KEY=accept03-dummy \
  "$image" >/dev/null || fail "docker run failed (no-password case)"
sleep 5
code=$(docker inspect -f '{{.State.ExitCode}}' "$name" 2>/dev/null || echo "?")
running=$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo "?")
[ "$running" = "false" ] || fail "no-password container still running"
[ "$code" != "0" ] || fail "no-password container exited 0"
docker logs "$name" 2>&1 | grep -q 'OPENCODE_PASSWORD' || fail "no-password log does not name OPENCODE_PASSWORD"

# Case 2: password present, key empty.
docker rm -f "$name" >/dev/null 2>&1 || true
pw="accept03-pw-$RANDOM"
docker run -d --name "$name" -e "OPENCODE_PASSWORD=$pw" -e OPENCODE_API_KEY= \
  "$image" >/dev/null || fail "docker run failed (no-key case)"
sleep 5
code=$(docker inspect -f '{{.State.ExitCode}}' "$name" 2>/dev/null || echo "?")
running=$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo "?")
[ "$running" = "false" ] || fail "no-key container still running"
[ "$code" != "0" ] || fail "no-key container exited 0"
docker logs "$name" 2>&1 | grep -q 'OPENCODE_API_KEY' || fail "no-key log does not name OPENCODE_API_KEY"
pass
