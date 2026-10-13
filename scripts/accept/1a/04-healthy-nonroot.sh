#!/usr/bin/env bash
# 04-healthy-nonroot: with credentials the container is healthy, runs as
# AGENT_UID, and opencode --version prints the pinned version.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
tag="$(grep '^OPENCODE_VERSION=' "$root/versions.env" | cut -d= -f2)"
image="agency-base:$tag"
name="agency-spike-accept04"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
require_cmd docker

docker image inspect "$image" >/dev/null 2>&1 || fail "image $image absent (run: make build-base)"
pw="accept04-pw-$RANDOM"
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" -e "OPENCODE_PASSWORD=$pw" -e OPENCODE_API_KEY=accept04-dummy \
  "$image" >/dev/null || fail "docker run failed"

healthy=""
for _ in $(seq 1 24); do
  healthy=$(docker inspect -f '{{.State.Health.Status}}' "$name" 2>/dev/null || echo "unknown")
  [ "$healthy" = "healthy" ] && break
  sleep 5
done
[ "$healthy" = "healthy" ] || fail "container never healthy (status=$healthy)"

want_uid="$(id -u)"
got_uid=$(docker exec "$name" id -u 2>/dev/null || echo "?")
[ "$got_uid" = "$want_uid" ] || fail "runs as uid $got_uid, want AGENT_UID $want_uid"
who=$(docker exec "$name" whoami 2>/dev/null || echo "?")
[ "$who" = "agent" ] || fail "runs as user $who, want agent"
ver=$(docker exec "$name" opencode --version 2>/dev/null || echo "?")
echo "$ver" | grep -q "$tag" || fail "opencode --version '$ver' lacks pinned $tag"
pass
