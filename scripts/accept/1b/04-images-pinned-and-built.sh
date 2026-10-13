#!/usr/bin/env bash
# 04-images-pinned-and-built: twelve expert images plus the proxy image
# build from Dockerfiles free of floating versions.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
# No floating versions anywhere a version can float.
floats=$(cd "$root" && grep -rnE ':(latest|stable|master|main)([^a-zA-Z0-9._-]|$)|@(latest|stable|master|main)([^a-zA-Z0-9._-]|$)|npx +-y +[^ @]+( +|$)|uvx +--from +[^ =@]+( +|$)|npm +install +-g +[^ @]+( +|$)|pip +install +[^ =]+( +|$)' experts/*/Dockerfile egress/Dockerfile || true)
[ -z "$floats" ] || fail "floating versions: $(echo "$floats" | head -3 | tr '\n' ' ')"
untagged=$(cd "$root" && grep -rnE '^FROM +[^ :]+( +|$)' experts/*/Dockerfile egress/Dockerfile || true)
[ -z "$untagged" ] || fail "untagged FROM: $(echo "$untagged" | head -2 | tr '\n' ' ')"
out=$(cd "$root" && docker compose build 2>&1 | tail -5) || fail "docker compose build failed: $(echo "$out" | tr '\n' ' ')"
tag=$(grep '^OPENCODE_VERSION=' "$root/.env" 2>/dev/null | cut -d= -f2)
[ -n "$tag" ] || fail "OPENCODE_VERSION missing from .env"
for name in director scout architect product frontend backend dba platform security qa reviewer docs; do
  docker image inspect "agency-$name:$tag" >/dev/null 2>&1 \
    || fail "image agency-$name:$tag missing after build"
done
docker image inspect agency-egress:1.0.0 >/dev/null 2>&1 || fail "image agency-egress:1.0.0 missing after build"
pass
