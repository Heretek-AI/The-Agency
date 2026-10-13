#!/usr/bin/env bash
# Run every acceptance check for one stage in name order.
# Usage: scripts/accept.sh <stage>
# Env overrides (used by the harness self-test): ACCEPT_ROOT (default
# scripts/accept), EVIDENCE_ROOT (default docs/evidence), ACCEPT_TIMEOUT
# (per-check seconds, default 120).
#
# Exit: 1 if any check failed, 77 if none failed and at least one skipped,
# 0 only if all passed. A stage directory with no scripts is a failure.
set -u

stage="${1:?usage: scripts/accept.sh <stage>}"
root="${ACCEPT_ROOT:-scripts/accept}"
evroot="${EVIDENCE_ROOT:-docs/evidence}"
timeout_s="${ACCEPT_TIMEOUT:-120}"
dir="$root/$stage"

if [ ! -d "$dir" ]; then
  echo "accept: no such stage directory $dir" >&2
  exit 1
fi

mapfile -t scripts < <(find "$dir" -maxdepth 1 -name '*.sh' -type f | LC_ALL=C sort)
if [ "${#scripts[@]}" -eq 0 ]; then
  echo "accept: stage directory $dir holds no check scripts" >&2
  exit 1
fi

command -v timeout >/dev/null 2>&1 || {
  echo "accept: missing required command timeout" >&2
  exit 1
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

pass_n=0
fail_n=0
skip_n=0
table=""
full="accept stage $stage ($(date -u +%Y-%m-%dT%H:%M:%SZ)), timeout ${timeout_s}s per check"

for script in "${scripts[@]}"; do
  name=$(basename "$script" .sh)
  id="$stage/$name"
  out="$work/$name.out"
  export ACCEPT_STAGE="$stage" ACCEPT_CHECK="$script"
  set +e
  timeout "$timeout_s" bash "$script" >"$out" 2>&1
  code=$?
  set -e
  body=$(cat "$out")
  result=""
  detail=""
  if [ "$code" -eq 124 ] || [ "$code" -eq 143 ]; then
    result="FAIL"
    detail="timeout after ${timeout_s}s"
  elif [ "$code" -eq 0 ]; then
    line=$(grep -m1 -E "^CHECK $id: (PASS|FAIL|SKIP)( |$)" "$out" || true)
    if [[ "$line" =~ ^CHECK\ $id:\ PASS( |$) ]]; then
      result="PASS"
    elif [ -n "$line" ]; then
      result="FAIL"
      detail="result/exit mismatch (exit 0 with ${line#*: })"
    else
      result="FAIL"
      detail="no result line (exit 0)"
    fi
  elif [ "$code" -eq 77 ]; then
    line=$(grep -m1 -E "^CHECK $id: SKIP( |$)" "$out" || true)
    if [ -n "$line" ]; then
      result="SKIP"
      detail="${line#*: SKIP }"
    else
      result="FAIL"
      detail="result/exit mismatch (exit 77 without SKIP line)"
    fi
  elif [ "$code" -eq 1 ]; then
    line=$(grep -m1 -E "^CHECK $id: (PASS|FAIL|SKIP)( |$)" "$out" || true)
    if [[ "$line" =~ ^CHECK\ $id:\ PASS( |$) ]]; then
      result="FAIL"
      detail="result/exit mismatch (PASS printed with exit 1)"
    elif [[ "$line" =~ ^CHECK\ $id:\ FAIL( |$) ]]; then
      result="FAIL"
      detail="${line#*: FAIL }"
    else
      result="FAIL"
      detail="exit 1${body:+: $(echo "$body" | head -c 200)}"
    fi
  else
    result="FAIL"
    detail="exit $code"
  fi
  case "$result" in
    PASS) pass_n=$((pass_n + 1)) ;;
    SKIP) skip_n=$((skip_n + 1)) ;;
    *) fail_n=$((fail_n + 1)) ;;
  esac
  table+=$(printf '%-28s %-6s %s' "$id" "$result" "$detail")
  table+=$'\n'
  full+=$'\n'"===== $id (exit $code) ====="$'\n'"$body"
done

summary="stage $stage: $pass_n pass, $skip_n skip, $fail_n fail (${#scripts[@]} checks)"
table_out="CHECKS for stage $stage"$'\n'"$table$summary"
full+=$'\n'"$table_out"

ts=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$evroot/$stage"
log="$evroot/$stage/accept-$ts.log"
printf '%s\n' "$full" >"$log"

printf '%s\n' "$table_out"
echo "log: $log"

if [ "$fail_n" -gt 0 ]; then exit 1; fi
if [ "$skip_n" -gt 0 ]; then exit 77; fi
exit 0
