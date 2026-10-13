#!/usr/bin/env bash
# 11-workspace-demo: `make workspace ARGS="demo --demo"` produces the
# clone; a repository with a submodule is refused; the example control
# files validate.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
rm -rf "$root/workspace/demo"
out=$(cd "$root" && make workspace ARGS="demo --demo" 2>&1) || fail "demo workspace failed: $(echo "$out" | tail -3 | tr '\n' ' ')"
[ -d "$root/workspace/demo/repo/.git" ] || fail "workspace/demo/repo is not a clone"
[ -d "$root/workspace/demo/trees" ] || fail "workspace/demo/trees missing"
[ -d "$root/workspace/demo/landing" ] || fail "workspace/demo/landing missing"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git init -q "$work/inner"
git -C "$work/inner" -c user.name=t -c user.email=t@t commit -q --allow-empty -m seed
git init -q "$work/outer"
git -C "$work/outer" -c user.name=t -c user.email=t@t commit -q --allow-empty -m seed
git -C "$work/outer" -c protocol.file.allow=always -c user.name=t -c user.email=t@t submodule add -q "$work/inner" inner
git -C "$work/outer" -c user.name=t -c user.email=t@t commit -qm sub
if "$root/scripts/workspace-init.sh" subtrap "$work/outer" 2>&1 | grep -qi 'submodule'; then
  :
else
  fail "repository with a submodule was not refused for that reason"
fi
[ -e "$root/workspace/subtrap" ] && fail "refused workspace left a directory behind"
out=$(cd "$root" && bun test dispatcher/test/registry-schema.test.ts 2>&1 | tail -3) \
  || fail "registry control files do not validate: $(echo "$out" | tr '\n' ' ')"
pass
