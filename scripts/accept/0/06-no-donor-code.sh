#!/usr/bin/env bash
# 06-no-donor-code: no donor patch stacks, unlock code, launchers, lane
# runtimes, or stray container commands. See shared context section 6 and
# audit section 6.5.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
cd "$root" || fail "cannot cd to $root"
self="scripts/accept/0/06-no-donor-code.sh"

patches=$(git ls-files '*.patch')
[ -z "$patches" ] || fail "tracked *.patch files: $(echo "$patches" | head -3 | tr '\n' ' ')"

unlocks=$(git ls-files | grep -i "unlock" || true)
[ -z "$unlocks" ] || fail "paths containing unlock: $(echo "$unlocks" | head -3 | tr '\n' ' ')"

launchers=$(git ls-files | grep "^launcher/" || true)
[ -z "$launchers" ] || fail "launcher/ directory present"

code=$(git ls-files 'dispatcher/**' 'verifier/**' 'scripts/**' 'Makefile')
bwraps=$(echo "$code" | grep -v "^$self$" | xargs grep -ln "bwrap" 2>/dev/null || true)
[ -z "$bwraps" ] || fail "bwrap in first-party source: $(echo "$bwraps" | head -3 | tr '\n' ' ')"

dockers=$(echo "$code" | grep -v "^$self$" | xargs grep -ln "docker run" 2>/dev/null || true)
dockers=$(echo "$dockers" | grep -v "^envrunner/" | grep -v "^lifecycle/" || true)
[ -z "$dockers" ] || fail "docker run outside envrunner/ and lifecycle/: $(echo "$dockers" | head -3 | tr '\n' ' ')"

pass
