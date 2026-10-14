# Defect register (audit 2026-10-12, Appendix B + cross-cutting)

One row per defect. Disposition is one of `fixed in salvage`,
`not carried over` (with the design rule that replaces it), or `guarded`.
Guard is a unit test name, an acceptance check id, or a `verify-stage.md`
scan. Stage is where the guard first exists. Where a row lists two stages,
its first guard belongs to the first stage.

| Id | Audit location | Defect | Disposition | Guard | Stage |
|---|---|---|---|---|---|
| D-01 | `opencode-fleet/src/cli/main.ts:99-103` | CLI `run` hard-codes a passing outcome | not carried over: no CLI; `done` needs a landed SHA (4.5) | test: `mission is not done without landedSha` | 1c |
| D-02 | `opencode-fleet/src/dispatcher/service.ts:99-100` | Task command from an untyped field, default `true` | not carried over: an expert-run is an OpenCode session | test: `expert-run creates a session and sends the envelope` | 1c |
| D-03 | `opencode-fleet/src/dispatcher/service.ts:111` | Empty gate list passes | fixed in salvage | test: `defect: empty check list is an error` | 0 |
| D-04 | `opencode-fleet/src/dispatcher/service.ts:116-124` | Judge verdicts copied from the gate result | not carried over | test: `verdict step without a judge fails with no-judge` | 2a |
| D-05 | `opencode-fleet/src/dispatcher/service.ts:148-150` | Worktree destroyed; uncommitted work lost; nothing landed | not carried over | tests: `uncommitted changes are committed by the Dispatcher`, `landing sets landedSha` | 1c |
| D-06 | `opencode-fleet/src/lanes/runner.ts:32,47-60,75-86`, `lanes/tiers.ts:50-76` | Sandbox lanes expose host files, environment, network | not carried over: no lanes (section 6) | scan: no `bwrap`, no `docker run` outside `envrunner/`, `lifecycle/`, and the Stage 1a harness (`scripts/spike.sh`, `scripts/accept/**`) that the stage prompt requires to start containers | 0 |
| D-07 | `opencode-fleet/src/lanes/runner.ts:32` | Containers without name, limits, user, `:z` | guarded | check: generated compose has limits, `cap_drop`, `:z` on every bind | 1b |
| D-08 | `opencode-fleet/src/util/exec.ts:56-59` | Timeout kills only the direct child | fixed in salvage | test: `defect: timeout kills the whole process group` | 0 |
| D-09 | `opencode-fleet/src/util/exec.ts:30` | Children inherit the parent environment | fixed in salvage | test: `defect: child sees only the explicit environment` | 0 |
| D-10 | `opencode-fleet/src/lanes/worktree.ts:30-32` | Retry resets the task branch and detaches HEAD | fixed in salvage | test: `defect: retry keeps commits on the task branch` | 0 |
| D-11 | `opencode-fleet/src/scheduler/runner.ts:47-57` | "Fix task" depends on the task it should fix; reason discarded | not carried over: rework re-runs the same task | tests: `retry re-queues the same task`, `rework notes reach the builder session` | 1c, 2a |
| D-12 | `opencode-fleet/src/scheduler/runner.ts:79-104` | `failed` and `cancelled` unreachable; dependents never cancelled | not carried over | tests: `every status is reachable`, `dependents of a failed task are cancelled` | 1c |
| D-13 | `opencode-fleet/src/scheduler/runner.ts:79-104` | No replan, no mission halt | not carried over | test: `three failures force a replan; two more halt the mission` | 2a |
| D-14 | `opencode-fleet/src/state/journal.ts:214` | Journal divergence test uses `&&` | fixed in salvage | test: `defect: a rewritten log of equal length is detected` | 0 |
| D-15 | `opencode-fleet/src/state/journal.ts:126-146` | Journal rewritten in full on every save; no lock | fixed in salvage | tests: `append never changes earlier bytes`, `a second writer is refused` | 0 |
| D-16 | `opencode-fleet/src/host/adapter.ts:75,89,97-103,139` | Second OpenCode client with nonexistent endpoints | not carried over: one module | test: `every operation the client uses exists in openapi.json` | 0, 1c |
| D-17 | `opencode-sdk/src/host/client.ts:181-186` | `createSession` cannot set agent, directory, or permissions | fixed in salvage | test: `createSession sends agent, location, permissions, metadata` | 0 |
| D-18 | `opencode-sdk/src/contracts.ts:119-134`, `opencode-fleet/src/judges/reports.ts` | Two incompatible judge report schemas | fixed in salvage | tests: `a pass with a blocker is invalid` (0), `protocol examples in FLEET_PROTOCOL.md parse` (1b) | 0, 1b |
| D-19 | `opencode-homelab/compose.yaml:31,54,81` | Compose publishes on all interfaces | guarded | check: only the gateway publishes, on `127.0.0.1` | 1b |
| D-20 | `opencode-homelab/compose.yaml:39` | Healthcheck targets a nonexistent endpoint | guarded | check: every expert reaches `healthy` through `/api/info` | 1b |
| D-21 | `opencode-homelab/compose.yaml:79` | Compose runs a command that does not exist | guarded | check: Dispatcher container healthy, `/healthz` answers | 1d |
| D-22 | `opencode-homelab/scripts/test-live-e2e.ts:109,149-152,183-198` | E2E script downgrades failures to warnings | guarded: rule 4.1.2 | harness self-test; `verify-stage.md` scan | 0 |
| D-23 | `opencode-gateway/apps/gateway/src/server.ts:244-262,343` | Gateway returns invented results as success | not carried over: rule 4.1.5 | scan for placeholder returns; the Stage 4c stub is named a fake | 0, 4c |
| D-24 | `opencode-gateway/apps/gateway/src/index.ts:6,40` | Default token; constant readiness | guarded: no credential default | test: `Dispatcher refuses to start without each credential` | 1d |
| D-25 | `opencode-gateway/packages/opencode-guard/src/guard.ts:169-173` | Text-matching shell guard as the only control | guarded: the proxy is the boundary | check: a request to a non-allowlisted host fails and is logged | 1b |
| D-26 | `opencode-packs/packs/*/src/index.ts` | Pack manifests reference missing files | guarded | test: `pack with a missing referenced file is rejected` | 4b |
| D-27 | `opencode-packs/packs/pack-gdevelop/patches/` | Entitlement patches in the distribution | guarded | check `0/06-no-donor-code`; pack layout allowlist | 0, 4b |
| D-28 | CI (`ci-unit.yaml`), root `tsconfig.json` include gap (2.1, 2.10) | CI ran neither lint nor typecheck; files outside typecheck | fixed | check `0/01-make-check`, `0/02-ts-coverage` | 0 |
| D-29 | `opencode-sdk/test/host-live.test.ts` skips, pack-gdevelop seam skips (2.2) | Vacuous skips counted as passes | fixed | `check-no-skips.sh`; harness exit 77 | 0 |
| D-30 | Commit subjects at `14f297a` (6.4) | Commit subjects and reports claimed absent features | guarded: operating rules | `verify-stage.md` compares claims with the tree | 0 |
| D-31 | `dispatcher/src/runner.ts` (Stage 1c live proof) | Final-message scan assumed oldest-first transcripts (the fake order); the real server serves newest-first, so live tasks failed with `no-block` | fixed in stage | test: `defect: newest-first transcripts resolve the final assistant message` | 1c |
