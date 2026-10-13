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

# One fixed-string grep per scanned file, fail-closed: exit 0 is a match,
# exit 1 is no match, and any other exit means the file could not be read,
# so the guard must not pass. Matches accumulate in SCAN_HITS. The function
# runs in the current shell (no command substitution), so fail() stops the
# whole check.
scan() {
  local needle="$1" f rc
  SCAN_HITS=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    [ "$f" = "$self" ] && continue
    grep -lF -- "$needle" "$f" >/dev/null 2>&1
    rc=$?
    case "$rc" in
      0) SCAN_HITS+="$f"$'\n' ;;
      1) ;;
      *) fail "cannot scan $f for '$needle' (grep exit $rc)" ;;
    esac
  done <<<"$code"
}

scan "bwrap"
bwraps="$SCAN_HITS"
[ -z "$bwraps" ] || fail "bwrap in first-party source: $(echo "$bwraps" | head -3 | tr '\n' ' ')"

scan "docker run"
dockers="$SCAN_HITS"
# The Stage 1a prompt requires scripts/spike.sh and the stage-1a acceptance
# checks to start named containers with `docker run` (base image health,
# fail-closed entrypoint, spike session flow). Those two paths are sanctioned
# by that prompt, so the scan exempts exactly them; a `docker run` added to
# any other scanned file still fails.
dockers=$(printf '%s\n' "$dockers" | grep -v '^scripts/spike\.sh$' | grep -v '^scripts/accept/' \
  | grep -v '^envrunner/' | grep -v '^lifecycle/')
[ -z "$dockers" ] || fail "docker run outside envrunner/, lifecycle/, scripts/spike.sh and scripts/accept/**: $(echo "$dockers" | head -3 | tr '\n' ' ')"

pass
