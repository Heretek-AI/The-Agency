#!/usr/bin/env bash
# Fail when a committed test outside */test/live/ skips, todos, or returns
# early on a missing dependency. Live tests may skip (exit 77); unit tests
# must run or fail.
set -euo pipefail

fail=0
files=$(git ls-files '*.test.ts' ':!:*/test/live/*')
[ -n "$files" ] || {
  echo "check-no-skips: no unit test files tracked"
  exit 0
}

for f in $files; do
  if grep -nE '(test|it|describe)\.(skip|todo)\b|\.skip\(' "$f" >/dev/null; then
    echo "check-no-skips: FAIL $f contains a skip/todo:"
    grep -nE '(test|it|describe)\.(skip|todo)\b|\.skip\(' "$f" | head -5
    fail=1
  fi
  # Early return shortly after a missing-dependency remark.
  if awk '
    /(missing|not found|not installed|unavailable|no .*binary|could not|cannot run)/ { mark = NR }
    mark != "" && NR <= mark + 3 && /^[[:space:]]*return([; ]|$)/ { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$f"; then
    echo "check-no-skips: FAIL $f returns early on a missing dependency"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "check-no-skips: clean ($(echo "$files" | wc -l | tr -d ' ') file(s))"
