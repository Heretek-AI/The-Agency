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

# --- structured negative-case marker (verify F3; rework R1, H1; frozen) ---
# Every shape-deciding question not recorded NOT PERFORMED must carry a
# line `Negative case: <observation>` that (a) is not a known denial shape
# and (b) states a checkable observed outcome. Mechanism (a): DENIAL_RE
# rejects, case-insensitively, the start-anchored absence words;
# contractions and inability (couldn't, can't, cannot, unable); "not
# <possible|obtainable|...>"; absence-of-case phrases ("no negative
# case/was", "none observed/...", "nothing observed/obtained"); "does/did
# not reproduce|occur|manifest"; "fail(ed|s|ing) to reproduce"; "could not
# get ... fail"; "did(n't) manage"; "did(n't) yield"; "never
# showed|appeared|turned up|manifested|occurred|happened"; and "no <token>
# could be produced|reproduced|observed|obtained". Curly apostrophes are
# normalized to straight ones before matching. Mechanism (b): the marker's
# paragraph (marker line through the next blank line) must carry an
# observed-outcome signal (SIGNAL_RE). This keyword filter plus the
# observed-outcome signal requirement is the final bounded structural
# enforcement for this check (frozen): keywords cannot decide semantics,
# so the genuineness of each cited negative case is established by the
# independent verification reading the logs (verify-stage.md), and the
# filter only rejects known denial shapes and signal-less paragraphs. A
# question recorded NOT PERFORMED cannot carry an observed negative case
# and is failed by the count below.
DENIAL_RE="^(none|no|not|never|nothing)\b"\
"|\b(couldn'?t|can'?t|cannot|unable)\b"\
"|\bnot[[:space:]]+(possible|obtainable|reproducible|reproduce|tested"\
"|testable|attempted|attemptable|exercised|applicable|confirmable)\b"\
"|\bunobtainable\b"\
"|\bcould[[:space:]]+not[[:space:]]+(be|reproduce|occur|manifest)\b"\
"|\bcould[[:space:]]+not[[:space:]]+get\b[^.]*\bfail"\
"|\bfail(ed|s|ing)?[[:space:]]+to[[:space:]]+reproduce\b"\
"|\b(does|did|do)[[:space:]]+not[[:space:]]+manage\b"\
"|\b(doesn'?t|didn'?t|don'?t)[[:space:]]+manage\b"\
"|\b(does|did|do)[[:space:]]+not[[:space:]]+yield\b"\
"|\b(doesn'?t|didn'?t|don'?t)[[:space:]]+yield\b"\
"|\bnever[[:space:]]+(showed|appeared|turned[[:space:]]+up|manifested|occurred|happened)\b"\
"|\bno[[:space:]]+[^[:space:]]+[[:space:]]+could[[:space:]]+be[[:space:]]+(produced|reproduced|observed|obtained)\b"\
"|\bno[[:space:]]+negative[[:space:]]+(case|was)\b"\
"|\bnone[[:space:]]+(else[[:space:]]+)?(observed|obtained|available|attempted|reproducible)\b"\
"|\bnothing[[:space:]]+(else[[:space:]]+|was[[:space:]]+)?(observed|obtained|produced|reproduced)\b"\
"|\b(does|did|do)[[:space:]]+not[[:space:]]+(seem[[:space:]]+to[[:space:]]+)?(reproduce|occur|manifest)\b"\
"|\b(doesn'?t|didn'?t|don'?t)[[:space:]]+(seem[[:space:]]+to[[:space:]]+)?(reproduce|occur|manifest)\b"

# SIGNAL_RE: observed-outcome signals a marker paragraph may carry.
SIGNAL_RE="fail|deny|denied|denies|refus(e|ed|es|al)|reject(ed|ion)?"\
"|error|EROFS|EACCES|EPERM|SQLiteError|ConnectionRefused|timeout"\
"|timed out|unset|non-zero|rc=[1-9]|exit(ed)?[ =][1-9]|4[0-9][0-9]|5[0-9][0-9]"

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

# has_signal <paragraph>: rc 0 = the paragraph carries an observed-outcome
# signal, rc 1 = none. Any filter error fails the check instead of
# rejecting silently.
has_signal() {
  local rc
  printf '%s' "$1" | grep -qiE "$SIGNAL_RE"
  rc=$?
  case "$rc" in
    0 | 1) return "$rc" ;;
    *) fail "negative-case signal filter failed (grep exit $rc)" ;;
  esac
}

for n in 03 04 07 10 14 15; do
  q=$((10#$n))
  if grep -qE "^\| *$q +\| NOT PERFORMED" "$notes"; then
    continue
  fi
  markers_raw=$(grep -n '^Negative case: ' "$ev/q$n.log")
  rc=$?
  case "$rc" in
    0) ;;
    1) fail "q$n.log has no structured 'Negative case: <observation>' line" ;;
    *) fail "cannot read q$n.log (grep exit $rc)" ;;
  esac
  marker_lns=$(printf '%s\n' "$markers_raw" | cut -d: -f1)
  observed=0
  saw_signal_less=0
  while IFS= read -r ln; do
    [ -n "$ln" ] || continue
    m=$(sed -n "${ln}p" "$ev/q$n.log")
    obs=${m#Negative case: }
    [ -n "$obs" ] || continue
    if is_denial "$obs"; then
      continue
    fi
    # The marker's paragraph runs from its line through the following
    # lines up to the next blank line (multi-line observations, e.g. q07).
    para=$(sed -n "${ln},/^\$/p" "$ev/q$n.log")
    rc=$?
    [ "$rc" -eq 0 ] || fail "cannot read q$n.log paragraph at line $ln (sed exit $rc)"
    if ! has_signal "$para"; then
      saw_signal_less=1
      continue
    fi
    observed=1
  done <<<"$marker_lns"
  if [ "$observed" -eq 0 ]; then
    if [ "$saw_signal_less" -eq 1 ]; then
      fail "q$n.log: negative case shows no observed outcome (no signal in its paragraph)"
    fi
    fail "q$n.log: negative case is a denial, not an observation"
  fi
done

notdone=$(grep -cE '^\| *[0-9]+ +\| NOT PERFORMED' "$notes")
[ "$notdone" = "0" ] || fail "$notdone question(s) NOT PERFORMED (no provider key); stage incomplete"
pass
