#!/usr/bin/env bash
# 02-base-image-pinned: digest-pinned FROM, no floating versions, image builds.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
df="$root/images/base/Dockerfile"
tag="$(grep '^OPENCODE_VERSION=' "$root/versions.env" | cut -d= -f2)"
[ -n "$tag" ] || fail "OPENCODE_VERSION missing in versions.env"

from=$(grep -E '^FROM ' "$df")
[ -n "$from" ] || fail "no FROM line in Dockerfile"
echo "$from" | grep -q '@sha256:' || fail "FROM is not digest-pinned: $from"
echo "$from" | grep -qi 'latest' && fail "FROM floats on latest"
grep -q '^FROM ubuntu:24.04@sha256:' "$df" || fail "base is not ubuntu:24.04 pinned by digest"
# The FROM line may carry a stage alias (AS base); strip it before comparing.
digest=$(echo "$from" | sed -E 's/^FROM [^ ]*@sha256:([0-9a-fA-F]+).*/\1/')
[ -n "$digest" ] || fail "could not parse FROM digest: $from"
grep -q "UBUNTU_DIGEST=sha256:$digest" "$root/versions.env" || fail "FROM digest not recorded in versions.env"
grep -nE 'FROM [^ ]*:(latest|[0-9]+\.[0-9]+$|[0-9]+$)' "$df" && fail "floating image tag in Dockerfile"
grep -nE 'ARG (NODE_VERSION|YQ_VERSION|UV_VERSION|OPENCODE_VERSION)=' "$df" | grep -q . || fail "toolchain version ARGs missing"

out=$(make -C "$root" build-base 2>&1) || fail "make build-base failed: $(echo "$out" | tail -3 | tr '\n' ' ')"
docker image inspect "agency-base:$tag" >/dev/null 2>&1 || fail "image agency-base:$tag absent after build"
pass
