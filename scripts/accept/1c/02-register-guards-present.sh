#!/usr/bin/env bash
# 02-register-guards-present: every guard in docs/audit/defects.md with a
# stage of 1c or earlier names a test that exists and passed in this run
# (or a check/scan artifact that exists). Unit-test guards are run one by
# one with `bun test -t`; each must report at least one pass and zero
# failures. Check/scan guards resolve to files that must exist.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd bun
cd "$root" || fail "cannot cd to $root"

# Exact unit-test names guarding 1c-or-earlier defects, as named in
# docs/audit/defects.md (multi-stage rows contribute only the guard whose
# annotated stage is 1c or earlier).
mapfile -t tests <<'EOF'
mission is not done without landedSha
expert-run creates a session and sends the envelope
defect: empty check list is an error
uncommitted changes are committed by the Dispatcher
retry re-queues the same task
every status is reachable
dependents of a failed task are cancelled
defect: timeout kills the whole process group
defect: child sees only the explicit environment
defect: retry keeps commits on the task branch
defect: a rewritten log of equal length is detected
append never changes earlier bytes
a second writer is refused
every operation the client uses exists in openapi.json
createSession sends agent, location, permissions, metadata
a pass with a blocker is invalid
protocol examples in FLEET_PROTOCOL.md parse
EOF

# D-05's second guard names the landing green path by its outcome; the test
# is the green-path landing test.
tests+=("green path: landedSha, --no-ff, four trailers, kept branch, base untouched")
# D-31: transcript-order defect found by the Stage 1c live proof.
tests+=("defect: newest-first transcripts resolve the final assistant message")

for name in "${tests[@]}"; do
  [ -n "$name" ] || continue
  grep -rF --include='*.test.ts' -q "$name" dispatcher verifier \
    || fail "guard test does not exist: $name"
  out=$(bun test -t "$name" dispatcher/test verifier/test 2>&1) \
    || fail "guard test failed: $name: $(echo "$out" | tail -3 | tr '\n' ' ')"
  echo "$out" | grep -q "0 fail" || fail "guard test reports a failure: $name"
  passes=$(echo "$out" | grep -oE "[0-9]+ pass" | head -1 | grep -oE "[0-9]+" || true)
  [ -n "$passes" ] && [ "$passes" -ge 1 ] \
    || fail "guard test reports no pass: $name"
done

# Check and scan guards due by 1c resolve to these artifacts.
for f in \
  scripts/accept/0/06-no-donor-code.sh \
  scripts/accept/0/01-make-check.sh \
  scripts/accept/0/02-ts-coverage.sh \
  scripts/accept/1b/03-compose-hardening.sh \
  scripts/accept/1b/05-up-healthy.sh \
  scripts/accept/1b/07-egress-allow-deny.sh \
  scripts/accept/1b/12-no-published-ports.sh \
  scripts/accept/test/accept.test.ts \
  scripts/check-no-skips.sh \
  docs/prompts/verify-stage.md \
; do
  [ -e "$f" ] || fail "guard artifact missing: $f"
done
grep -q "placeholder" Makefile || fail "placeholder scan missing from Makefile"

pass
