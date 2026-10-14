#!/usr/bin/env bash
# 16-stage-1-register: every guard in docs/audit/defects.md with stage 1d
# or earlier passes. Unit-test guards run by exact test name; static
# guards re-run their probes; container guards re-probe the live stack.
# Guards owned by other stages' live runs (1b egress allow-deny, 1c
# engine-live) are covered by checks 02/03 and 07-14 of their stages;
# this check proves the fast guards and the wiring they protect.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
# shellcheck disable=SC1091
source "$(dirname "$0")/rest.inc"
root="$(git rev-parse --show-toplevel)"
require_cmd bun
require_cmd docker
cd "$root" || fail "cannot cd to $root"

run_guard() {
  local file="$1" name="$2" out
  out=$(bun test "$file" -t "$name" 2>&1) || fail "guard test failed [$name]: $(echo "$out" | tail -2 | tr '\n' ' ')"
  echo "$out" | grep -q "0 fail" || fail "guard test not green [$name]: $(echo "$out" | tail -2 | tr '\n' ' ')"
}

run_guard dispatcher/test/engine.test.ts "mission is not done without landedSha"
run_guard dispatcher/test/runner.test.ts "expert-run creates a session and sends the envelope"
run_guard verifier/test/run-checks.test.ts "defect: empty check list is an error"
run_guard dispatcher/test/runner.test.ts "uncommitted changes are committed by the Dispatcher"
run_guard dispatcher/test/landing.test.ts "green path: landedSha, --no-ff, four trailers, kept branch, base untouched"
run_guard dispatcher/test/util/exec.test.ts "defect: timeout kills the whole process group"
run_guard dispatcher/test/util/exec.test.ts "defect: child sees only the explicit environment"
run_guard dispatcher/test/worktrees.test.ts "defect: retry keeps commits on the task branch"
run_guard dispatcher/test/scheduler.test.ts "retry re-queues the same task"
run_guard dispatcher/test/engine.test.ts "accept releases verify and land; rework re-runs the same session and branch"
run_guard dispatcher/test/scheduler.test.ts "dependents of a failed task are cancelled"
run_guard dispatcher/test/scheduler.test.ts "every status is reachable"
run_guard dispatcher/test/audit.test.ts "defect: a rewritten log of equal length is detected"
run_guard dispatcher/test/audit.test.ts "append never changes earlier bytes"
run_guard dispatcher/test/audit.test.ts "a second writer is refused"
run_guard dispatcher/test/opencode.test.ts "every operation the client uses exists in openapi.json"
run_guard dispatcher/test/opencode.test.ts "createSession sends agent, location, permissions, metadata"
run_guard dispatcher/test/protocol.test.ts "a pass with a blocker is invalid"
run_guard dispatcher/test/protocol-examples.test.ts "RESULT and VERDICT examples extract and validate"
run_guard dispatcher/test/main.test.ts "Dispatcher refuses to start without each credential"
run_guard dispatcher/test/runner.test.ts "defect: newest-first transcripts resolve the final assistant message"
run_guard dispatcher/test/registry-schema.test.ts "checks.yaml rejects an empty check list"
run_guard verifier/test/server.test.ts "an empty check list returns no-checks, never success"
run_guard dispatcher/test/runner.test.ts "a scripted permission request is rejected with the exact message and recorded"

# D-06: no sandbox lanes, no bubblewrap anywhere in first-party code.
[ ! -e dispatcher/src/lanes ] || fail "lanes directory exists"
[ ! -e dispatcher/src/scheduler/runner.ts ] || fail "old scheduler runner exists"
bwrap=$(grep -rln "bwrap" dispatcher/src verifier/src scripts envrunner lifecycle 2>/dev/null || true)
[ -z "$bwrap" ] || fail "bubblewrap referenced: $bwrap"

# Static stage guards that run in seconds, with their own result lines
# captured so they cannot end this check early.
static_check() {
  local script="$1" id="$2" out code
  out=$(ACCEPT_STAGE="1d-static" ACCEPT_CHECK="$script" bash "$script" 2>&1)
  code=$?
  [ "$code" -eq 0 ] || fail "$id regressed: $(echo "$out" | tail -2 | tr '\n' ' ')"
}
static_check "$root/scripts/accept/1c/03-scheduler-pure.sh" "1c/03"
static_check "$root/scripts/accept/1c/04-single-opencode-module.sh" "1c/04"
static_check "$root/scripts/accept/1c/09-no-task-exec-in-dispatcher.sh" "1c/09"
static_check "$root/scripts/accept/0/07-no-skips.sh" "0/07"

# D-07: generated services carry limits, dropped capabilities, and :z.
bun -e '
import { $ } from "bun";
import { parse } from "yaml";
const out = await $`docker compose config`.text();
const doc = parse(out);
for (const svc of ["dispatcher", "gateway", "director", "scout", "verifier"]) {
  const s = doc.services[svc];
  if (!s) throw new Error(`${svc} service missing`);
  if (JSON.stringify(s.cap_drop) !== JSON.stringify(["ALL"])) throw new Error(`${svc} cap_drop`);
  if (!s.mem_limit) throw new Error(`${svc} mem_limit`);
  if (!s.pids_limit) throw new Error(`${svc} pids_limit`);
  for (const vol of s.volumes ?? []) {
    if (typeof vol === "string" && vol.startsWith("./") && !/:(ro|rw),z$/.test(vol))
      throw new Error(`${svc} volume ${vol} lacks :z`);
  }
}
' || fail "compose hardening regressed (D-07)"

# D-19/D-20/D-21: only the gateway publishes; every service is healthy.
ids=$(docker compose ps -q 2>/dev/null) || fail "docker compose ps failed"
[ -n "$ids" ] || fail "project has no containers (run check 02 first)"
# shellcheck disable=SC2086
bindings=$(docker inspect --format '{{.Name}} {{json .HostConfig.PortBindings}}' $ids)
bound=$(echo "$bindings" | grep -vE ' (\{\}|null)$' | grep -v 'agency-gateway' || true)
[ -z "$bound" ] || fail "non-gateway port bindings: $bound"
echo "$bindings" | grep -q 'agency-gateway.*127.0.0.1' ||
  fail "gateway has no loopback binding"
unhealthy=""
for c in agency-director agency-scout agency-architect agency-product agency-frontend agency-backend agency-dba agency-platform agency-security agency-qa agency-reviewer agency-docs agency-egress agency-verifier agency-dispatcher agency-gateway; do
  [ "$(container_health "$c")" = "healthy" ] || unhealthy="$unhealthy $c"
done
[ -z "$unhealthy" ] || fail "not healthy:$unhealthy"
pass
