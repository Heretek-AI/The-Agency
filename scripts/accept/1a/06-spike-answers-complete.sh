#!/usr/bin/env bash
# 06-spike-answers-complete: fifteen non-empty evidence files, fifteen
# recorded answers in docs/build-notes.md, and a negative case in each of
# the six shape-deciding questions (3,4,7,10,14,15). If any question is
# recorded NOT PERFORMED for lack of a key, this check FAILS honestly: a
# skip of 05 means the stage is not complete.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
notes="$root/docs/build-notes.md"
ev="$root/docs/evidence/1a/spike"

for i in $(seq -w 1 15); do
  f="$ev/q$i.log"
  [ -s "$f" ] || fail "evidence q$i.log missing or empty"
done

for n in $(seq 1 15); do
  grep -qE "^\| *$n +\| (yes|no|partly|NOT PERFORMED)" "$notes" \
    || fail "build-notes has no recorded answer row for question $n"
done

# --- structured negative-case marker (verify F3; cycle-2 rework R1) --------
# Every shape-deciding question not recorded NOT PERFORMED must carry a
# line `Negative case: <observation>` and the observation must not match a
# known denial shape. The filter below rejects, case-insensitively: the
# start-anchored absence words; contractions and inability (couldn't,
# can't, cannot, unable); "not <possible|obtainable|...>"; absence-of-case
# phrases ("no negative case/was", "none observed/...", "nothing
# observed/obtained"); and "does/did not reproduce|occur|manifest" with
# and without contractions. Curly apostrophes are normalized to straight
# ones before matching, so a typographic "couldn't" is caught too. This
# filter only rejects known denial shapes; whether the cited observation
# is genuinely a negative case remains the independent verifier's read,
# never the check's. A question recorded NOT PERFORMED cannot carry an
# observed negative case and is failed by the count below.
DENIAL_RE="^(none|no|not|never|nothing)\b"\
"|\b(couldn'?t|can'?t|cannot|unable)\b"\
"|\bnot[[:space:]]+(possible|obtainable|reproducible|reproduce|tested"\
"|testable|attempted|attemptable|exercised|applicable|confirmable)\b"\
"|\bunobtainable\b"\
"|\bcould[[:space:]]+not[[:space:]]+(be|reproduce|occur|manifest)\b"\
"|\bno[[:space:]]+negative[[:space:]]+(case|was)\b"\
"|\bnone[[:space:]]+(else[[:space:]]+)?(observed|obtained|available|attempted|reproducible)\b"\
"|\bnothing[[:space:]]+(else[[:space:]]+)?(observed|obtained)\b"\
"|\b(does|did|do)[[:space:]]+not[[:space:]]+(seem[[:space:]]+to[[:space:]]+)?(reproduce|occur|manifest)\b"\
"|\b(doesn'?t|didn'?t|don'?t)[[:space:]]+(seem[[:space:]]+to[[:space:]]+)?(reproduce|occur|manifest)\b"

# is_denial <text>: rc 0 = a known denial shape, rc 1 = none of the known
# shapes. Any filter error fails the check instead of counting as an
# observation.
is_denial() {
  local s rc
  s=$(printf '%s' "$1" | sed "s/’/'/g; s/‘/'/g")
  rc=$?
  [ "$rc" -eq 0 ] || fail "negative-case filter: apostrophe normalization failed (exit $rc)"
  printf '%s' "$s" | grep -qiE "$DENIAL_RE"
  rc=$?
  case "$rc" in
    0 | 1) return "$rc" ;;
    *) fail "negative-case filter failed (grep exit $rc)" ;;
  esac
}

for n in 03 04 07 10 14 15; do
  q=$((10#$n))
  if grep -qE "^\| *$q +\| NOT PERFORMED" "$notes"; then
    continue
  fi
  markers=$(grep '^Negative case: ' "$ev/q$n.log")
  rc=$?
  case "$rc" in
    0) ;;
    1) fail "q$n.log has no structured 'Negative case: <observation>' line" ;;
    *) fail "cannot read q$n.log (grep exit $rc)" ;;
  esac
  observed=0
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    obs=${m#Negative case: }
    [ -n "$obs" ] || continue
    if is_denial "$obs"; then
      continue
    fi
    observed=1
  done <<<"$markers"
  [ "$observed" -eq 1 ] || fail "q$n.log: negative case is a denial, not an observation"
done

notdone=$(grep -cE '^\| *[0-9]+ +\| NOT PERFORMED' "$notes")
[ "$notdone" = "0" ] || fail "$notdone question(s) NOT PERFORMED (no provider key); stage incomplete"
pass
