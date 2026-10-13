#!/usr/bin/env bash
# 04-images-pinned-and-built: twelve expert images plus the proxy image
# build from Dockerfiles free of floating versions.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
join_lines() {
  sed -e ':a' -e '/\\$/N' -e 's/\\\n/ /' -e 'ta' "$1"
}
bad=""
for df in "$root"/experts/*/Dockerfile "$root"/egress/Dockerfile; do
  joined=$(join_lines "$df")
  echo "$joined" | grep -Eq '^FROM +[^ :]+( |$)' && bad="$bad $df:untagged-FROM"
  echo "$joined" | grep -Eiq ':(latest|stable|master|main)([^a-zA-Z0-9._-]|$)' && bad="$bad $df:symbolic-tag"
  echo "$joined" | grep -Eq 'pip +install' && {
    echo "$joined" | grep -E 'pip +install' | grep -q '==' || bad="$bad $df:unpinned-pip"
  }
  echo "$joined" | grep -Eq 'npm +install +-g' && {
    echo "$joined" | grep -E 'npm +install +-g' | grep -q '@' || bad="$bad $df:unpinned-npm"
  }
  echo "$joined" | grep -Eq 'npx +-y' && {
    echo "$joined" | grep -E 'npx +-y' | grep -q '@' || bad="$bad $df:unpinned-npx"
  }
  echo "$joined" | grep -Eq 'uvx +--from' && {
    echo "$joined" | grep -E 'uvx +--from' | grep -q '==' || bad="$bad $df:unpinned-uvx"
  }
done
[ -z "$bad" ] || fail "floating versions:$bad"
out=$(cd "$root" && docker compose build 2>&1 | tail -5) || fail "docker compose build failed: $(echo "$out" | tr '\n' ' ')"
tag=$(grep '^OPENCODE_VERSION=' "$root/.env" 2>/dev/null | cut -d= -f2)
[ -n "$tag" ] || fail "OPENCODE_VERSION missing from .env"
for name in director scout architect product frontend backend dba platform security qa reviewer docs; do
  docker image inspect "agency-$name:$tag" >/dev/null 2>&1 \
    || fail "image agency-$name:$tag missing after build"
done
docker image inspect agency-egress:1.0.0 >/dev/null 2>&1 || fail "image agency-egress:1.0.0 missing after build"
pass
