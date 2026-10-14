#!/usr/bin/env bash
# workspace-init for The Agency (Stage 1b, Step 8).
# Usage: scripts/workspace-init.sh <repoId> <git-url | path | --demo>
# Clones into workspace/<repoId>/repo and creates trees/ and landing/.
# --demo copies fixtures/demo-repo and runs git init. Refuses repositories
# with submodules or LFS for now and says why: the fleet mounts the whole
# of /work at the same path everywhere and has no LFS credentials, so
# submodule pointers and LFS objects would arrive broken inside experts.
set -u
set -e

ROOT="$(git rev-parse --show-toplevel)"
repo_id="${1:?usage: scripts/workspace-init.sh <repoId> <git-url | path | --demo}"
src="${2:?usage: scripts/workspace-init.sh <repoId> <git-url | path | --demo}"

case "$repo_id" in
  *[!a-z0-9-]* | "")
    echo "workspace-init: refusing repo id '$repo_id': use lowercase letters, digits, and dashes" >&2
    exit 1
    ;;
esac

dest="$ROOT/workspace/$repo_id/repo"
trees="$ROOT/workspace/$repo_id/trees"
landing="$ROOT/workspace/$repo_id/landing"
if [ -e "$ROOT/workspace/$repo_id" ]; then
  echo "workspace-init: refusing: $ROOT/workspace/$repo_id exists (delete it to re-init)" >&2
  exit 1
fi

if [ "$src" = "--demo" ]; then
  mkdir -p "$dest" "$trees" "$landing"
  cp -r "$ROOT/fixtures/demo-repo/." "$dest/" || {
    echo "workspace-init: refusing: cannot copy fixtures/demo-repo" >&2
    rm -rf "$ROOT/workspace/$repo_id"
    exit 1
  }
  git -C "$dest" init -q
  git -C "$dest" -c user.name=agency -c user.email=agency@agency.invalid add -A
  git -C "$dest" -c user.name=agency -c user.email=agency@agency.invalid commit -qm seed
  echo "workspace-init: demo workspace ready at workspace/$repo_id"
  exit 0
fi

mkdir -p "$ROOT/workspace/$repo_id"
if ! git clone -q "$src" "$dest" 2>&1; then
  echo "workspace-init: refusing: git clone of '$src' failed" >&2
  rm -rf "$ROOT/workspace/$repo_id"
  exit 1
fi
mkdir -p "$trees" "$landing"

if [ -f "$dest/.gitmodules" ] || git -C "$dest" ls-files --stage | grep -q '^160000'; then
  echo "workspace-init: refusing: '$src' contains git submodules, which the fleet does not support yet (submodule checkouts assume host credentials and break the fleet's same-path /work mounts)" >&2
  rm -rf "$ROOT/workspace/$repo_id"
  exit 1
fi
if [ -f "$dest/.gitattributes" ] && grep -q 'filter=lfs\|filter = lfs' "$dest/.gitattributes"; then
  echo "workspace-init: refusing: '$src' uses Git LFS, which the fleet does not support yet (experts hold no LFS credentials, so LFS objects would arrive as pointers)" >&2
  rm -rf "$ROOT/workspace/$repo_id"
  exit 1
fi

echo "workspace-init: workspace ready at workspace/$repo_id"
