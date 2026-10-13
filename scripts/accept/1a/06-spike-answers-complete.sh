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

for n in 03 04 07 10 14 15; do
  # The six shape-deciding questions must each carry a structured marker:
  # a line `Negative case: <observation>` whose observation is not a denial
  # that none could be obtained. The former `grep -qi 'negative'` accepted
  # any sentence containing the word, including q10's "none obtainable
  # without a key" (verify F3). A question recorded NOT PERFORMED cannot
  # carry an observed negative case and is failed by the count below.
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
    # A denial ("none obtainable", "not obtainable", "could not be tested")
    # says no negative case exists; only an actual observation counts.
    if printf '%s' "$obs" | grep -qiE '^(none|no|not|never|nothing)\b|not[[:space:]]+obtainable|unobtainable|could[[:space:]]+not[[:space:]]+be'; then
      continue
    fi
    observed=1
  done <<<"$markers"
  [ "$observed" -eq 1 ] || fail "q$n.log: negative case is a denial, not an observation"
done

notdone=$(grep -cE '^\| *[0-9]+ +\| NOT PERFORMED' "$notes")
[ "$notdone" = "0" ] || fail "$notdone question(s) NOT PERFORMED (no provider key); stage incomplete"
pass
