#!/usr/bin/env bash
# Helpers for acceptance checks. Each check script sources this file and calls
# exactly one of pass / fail / skip, which prints the single result line
# `CHECK <stage>/<name>: <RESULT> <reason>` and exits 0 / 1 / 77.
# shellcheck disable=SC2317
set -u

_accept_check_id() {
  local base
  base=$(basename "${ACCEPT_CHECK:-$0}" .sh)
  printf '%s/%s' "${ACCEPT_STAGE:-?}" "$base"
}

pass() {
  echo "CHECK $(_accept_check_id): PASS"
  exit 0
}

fail() {
  echo "CHECK $(_accept_check_id): FAIL $*"
  exit 1
}

skip() {
  echo "CHECK $(_accept_check_id): SKIP $*"
  exit 77
}

# require_cmd <name> fails when the command is missing. With --optional it
# skips (exit 77) instead. No other fallback: a missing hard requirement is a
# failure, never a silent pass.
require_cmd() {
  if [ "${1:-}" = "--optional" ]; then
    shift
    command -v "${1:?usage: require_cmd --optional <name>}" >/dev/null 2>&1 \
      || skip "missing optional command $1"
  else
    command -v "${1:?usage: require_cmd <name>}" >/dev/null 2>&1 \
      || fail "missing required command $1"
  fi
}
