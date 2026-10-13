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

# Every tracked-path list below comes from `git ls-files`. If that command
# fails, the guard has no list to judge, and an empty list is not evidence of
# a clean tree, so a non-zero exit fails the check (it previously failed
# open: the shim case left every list empty and the check passed). ls_files
# runs in the current shell (no command substitution at the call site), so
# fail() stops the whole check.
LS_FILES_OUT=""
ls_files() {
  local rc
  LS_FILES_OUT=$(git ls-files "$@")
  rc=$?
  [ "$rc" -eq 0 ] || fail "git ls-files $* failed (exit $rc); cannot enumerate tracked files"
}

# grep over a captured list: 0 is a match, 1 is no match, any other exit
# means the list could not be filtered, so the guard must not pass.
grep_list() {
  local rc
  GREP_LIST_OUT=$(printf '%s\n' "$1" | grep "${@:2}")
  rc=$?
  case "$rc" in
    0 | 1) ;;
    *) fail "cannot filter the tracked file list (grep exit $rc)" ;;
  esac
}

ls_files '*.patch'
patches="$LS_FILES_OUT"
[ -z "$patches" ] || fail "tracked *.patch files: $(echo "$patches" | head -3 | tr '\n' ' ')"

ls_files
all_files="$LS_FILES_OUT"

grep_list "$all_files" -i "unlock"
unlocks="$GREP_LIST_OUT"
[ -z "$unlocks" ] || fail "paths containing unlock: $(echo "$unlocks" | head -3 | tr '\n' ' ')"

grep_list "$all_files" "^launcher/"
launchers="$GREP_LIST_OUT"
[ -z "$launchers" ] || fail "launcher/ directory present"

ls_files 'dispatcher/**' 'verifier/**' 'scripts/**' 'Makefile'
code="$LS_FILES_OUT"
[ -n "$code" ] || fail "git ls-files returned no dispatcher/verifier/scripts/Makefile files; cannot scan"

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
