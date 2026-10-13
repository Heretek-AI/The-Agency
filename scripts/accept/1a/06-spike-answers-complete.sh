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
  grep -qi 'negative' "$ev/q$n.log" \
    || fail "q$n.log shows no negative case"
done

notdone=$(grep -cE '^\| *[0-9]+ +\| NOT PERFORMED' "$notes")
[ "$notdone" = "0" ] || fail "$notdone question(s) NOT PERFORMED (no provider key); stage incomplete"
pass
