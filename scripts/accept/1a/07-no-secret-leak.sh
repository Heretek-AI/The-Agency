#!/usr/bin/env bash
# 07-no-secret-leak: the provider key value appears nowhere in tracked files,
# evidence, captured logs, or image metadata/history. Never prints a value:
# findings name files only. With no key on file, it verifies no tracked file
# carries a non-empty OPENCODE_API_KEY assignment instead.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
tag="$(grep '^OPENCODE_VERSION=' "$root/versions.env" | cut -d= -f2)"
image="agency-base:$tag"

key=$(sed -n 's/^OPENCODE_API_KEY=//p' "$root/.env.provider" 2>/dev/null | head -1 | sed 's/[[:space:]]*#.*//;s/^[[:space:]]*//;s/[[:space:]]*$//')

if [ -n "$key" ]; then
  hits=$(git -C "$root" grep -F -l -- "$key" -- . 2>/dev/null)
  [ -z "$hits" ] || fail "key value found in tracked files: $(echo "$hits" | tr '\n' ' ')"
  if grep -rF -q -- "$key" "$root/docs/evidence/1a" 2>/dev/null; then
    fail "key value found under docs/evidence/1a"
  fi
  if docker image inspect "$image" >/dev/null 2>&1; then
    docker inspect "$image" | grep -F -q -- "$key" \
      && fail "key value found in image inspect output"
    docker history --no-trunc "$image" 2>/dev/null | grep -F -q -- "$key" \
      && fail "key value found in image history"
  fi
  pass
fi

# No usable key on file: fail if any tracked file assigns a non-empty key
# (value starting with alnum, optionally quoted; pattern literals such as
# grep/sed expressions for reading .env.provider do not match).
hits=$(git -C "$root" grep -nE -- '^[^#]*OPENCODE_API_KEY=["'"'"']?[A-Za-z0-9]' -- . 2>/dev/null)
[ -z "$hits" ] || fail "non-empty OPENCODE_API_KEY assignment in tracked files: $(echo "$hits" | tr '\n' ' ')"
pass
