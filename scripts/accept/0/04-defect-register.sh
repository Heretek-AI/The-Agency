#!/usr/bin/env bash
# 04-defect-register: docs/audit/defects.md holds rows D-01..D-30, each with
# a disposition, a guard, and a stage; every stage-0 guard resolves to a test
# or check that exists in this tree.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
cd "$root" || fail "cannot cd to $root"
reg="docs/audit/defects.md"
[ -f "$reg" ] || fail "missing $reg"

resolve_name() {
  local name="$1"
  # Acceptance check id, e.g. 0/06-no-donor-code.
  if [[ "$name" =~ ^0/[0-9]+- ]]; then
    [ -f "scripts/accept/${name}.sh" ] && return 0
    return 1
  fi
  # Repo file, e.g. check-no-skips.sh or verify-stage.md.
  if [ -f "scripts/$name" ] || [ -f "docs/prompts/$name" ]; then return 0; fi
  # Unit test name somewhere in the test suites.
  if grep -rF --include='*.test.ts' -q "$name" dispatcher verifier scripts; then return 0; fi
  return 1
}

for n in $(seq -w 1 30); do
  id="D-$n"
  row=$(grep -F "| $id " "$reg" || true)
  [ -n "$row" ] || fail "row $id missing"
  # Six pipe-delimited columns between the leading and trailing pipes.
  cols=$(echo "$row" | awk -F'|' '{print NF}')
  [ "$cols" -eq 8 ] || fail "row $id has $cols fields, want 8"
  for i in 2 3 4 5 6 7; do
    cell=$(echo "$row" | awk -F'|' "{gsub(/^[ \t]+|[ \t]+$/, \"\", \$$i); print \$$i}")
    [ -n "$cell" ] || fail "row $id column $i is empty"
  done
  disposition=$(echo "$row" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $5); print $5}')
  case "$disposition" in
    "fixed in salvage"* | "not carried over"* | "guarded"* | "fixed"*) ;;
    *) fail "row $id has unknown disposition: $disposition" ;;
  esac
  guard=$(echo "$row" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $6); print $6}')
  stage=$(echo "$row" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $7); print $7}')
  [ -n "$stage" ] || fail "row $id has no stage"
  case "$stage" in
    0*) ;;
    *) continue ;;
  esac
  # A "scan:" guard is satisfied by its dedicated guard check.
  case "$guard" in
    "scan:"*)
      [ -f "scripts/accept/0/06-no-donor-code.sh" ] || fail "row $id: 06 guard missing"
      continue
      ;;
  esac
  # Names annotated with a later stage are handled per-name below.
  names=$(echo "$guard" | grep -o '`[^`]*`' | tr -d '`' || true)
  if [ -z "$names" ]; then
    # No backticked names: known keyword guards.
    case "$guard" in
      *"harness self-test"*)
        [ -f "scripts/accept/test/accept.test.ts" ] || fail "row $id: harness self-test missing"
        ;;
      *"verify-stage.md"*)
        [ -f "docs/prompts/verify-stage.md" ] || fail "row $id: verify-stage.md missing"
        ;;
      *"docker run"*)
        [ -f "scripts/accept/0/06-no-donor-code.sh" ] || fail "row $id: 06 guard missing"
        ;;
      *"placeholder"*)
        grep -q "placeholder" Makefile || fail "row $id: placeholder scan missing from Makefile"
        ;;
      *"harness exit 77"*)
        [ -d "scripts/accept/selftest" ] || fail "row $id: selftest stage missing"
        ;;
      *)
        fail "row $id stage-0 guard resolves to nothing: $guard"
        ;;
    esac
    continue
  fi
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    # A name annotated with a later stage, e.g. `name` (1b), belongs there.
    after="${guard#*"\`$name\`"}"
    if [[ "$after" =~ ^[[:space:]]*\(([0-9]+) ]]; then
      case "${BASH_REMATCH[1]}" in
        0) ;;
        *) continue ;;
      esac
    fi
    resolve_name "$name" || fail "row $id guard does not exist: $name"
  done <<<"$names"
done

pass
