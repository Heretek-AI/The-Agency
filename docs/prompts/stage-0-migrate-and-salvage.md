# Stage 0 — Migrate and salvage

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt. Then read sections 1, 2.3 to 2.6, 6, and Appendix B of `docs/audit/2026-10-12-heretek-opencode-audit.md`.

## Goal of this stage

Turn this documentation-only repository into one that can be built in, and bring over the few modules from `heretek-opencode` that are worth keeping, each with the audit's defects fixed and a test that proves the fix.

At the end of this stage `make check` is green, `make accept STAGE=0` exits 0, and the repository contains: scaffolding and CI, the acceptance harness every later stage uses, a defect register, eight salvaged modules with tests, and a scripted fake OpenCode server.

Nothing in this stage talks to a model or starts a fleet container.

## Not in this stage

Images, experts, `fleet.yaml`, the renderer, the proxy, compose (stages 1a and 1b). The scheduler, the store, the expert runner, landing, and any HTTP or MCP service (stages 1c and 1d). Do not write a CLI. Do not recreate anything on the "not salvaged" list in shared context 2.3.

The modules you bring over are libraries with no caller yet. That is intended here and only here. List each one under "Not built: not wired" in the report so later stages account for it.

## Ask the user

- The path to the `heretek-opencode` checkout, only if the default in shared context 2.2 does not exist and cloning fails.

## Step 0 — Preflight and branch

1. Confirm the working tree holds only the prompt series, `docs/research/`, `docs/audit/`, and the untracked `review/`. Create branch `stage-0-salvage`.
2. Resolve `SALVAGE_SRC` (shared context 2.2). Check `git -C "$SALVAGE_SRC" rev-parse --short HEAD` prints `14f297a`. An untracked `docs/` directory there is expected. Any other difference: stop and tell the user.
3. Record in `docs/build-notes.md`: the date, Bun, git, and Docker versions, the SELinux mode, and the salvage commit.

**Accept:** the branch exists; `docs/build-notes.md` has a "Preflight" section with those facts.

## Step 1 — Scaffolding and `make check`

Create:

| File | Content |
|---|---|
| `.gitignore` | As in shared context section 8. |
| `LICENSE` | Apache-2.0, full text, copyright Heretek-AI. |
| `README.md` | What The Agency is, in ten lines; that it is under construction; pointers to `docs/prompts/README.md`, `docs/reports/`, and the audit. No claim of a working feature. |
| `versions.env` | `BUN_VERSION`, `OPENCODE_VERSION=2.0.26`, and an exact version for every dev dependency. |
| `.env.example` | Variable names from shared context 9.13 with empty values and one-line comments. |
| `package.json`, `bun.lock` | Private root workspace. Workspaces: `dispatcher`, `verifier`. Every dependency at an exact version, no ranges. Dev dependencies: TypeScript, oxlint, Prettier, `@types/bun`. `dispatcher` depends on `zod`. |
| `tsconfig.json` | `strict`, `noUncheckedIndexedAccess`, `moduleResolution: "Bundler"`, `noEmit`. Include every first-party `.ts` and `.tsx`. Exclude `review/`, `node_modules/`, `workspace/`, `state/`, `fixtures/`. |
| `.oxlintrc.json` | Correctness rules on; unused variables, imports, and parameters are errors. |
| `.prettierrc`, `.prettierignore` | Ignore `review/`, `docs/prompts/v1/`, `docs/audit/`, generated files. |
| `Makefile` | `check` and its sub-targets in the order given in shared context 9.13, `accept`, and stubs that print "not built until stage X" and exit 1 for every other target listed there. |
| `scripts/check-ts-coverage.ts` | As in shared context 9.13. |
| `scripts/check-no-skips.sh` | Fails if any committed test outside `*/test/live/` contains `test.skip`, `it.skip`, `describe.skip`, `test.todo`, or returns early on a missing dependency. |
| `.github/workflows/ci.yml` | On push and pull request: check out, install Bun at `BUN_VERSION`, `bun install --frozen-lockfile`, `make check`. Nothing else. |
| `docs/build-notes.md`, `docs/reports/.gitkeep`, `docs/evidence/.gitkeep` | Build notes start with sections "Preflight", "Salvage", "Spike", "Fallbacks in force", "Proposed corrections". |

`make check` must fail when any one of its parts fails. A stub target that silently succeeds is a defect.

**Accept:** `make check` is green with one trivial unit test in place. Introducing, one at a time, a formatting error, an unused import, a type error, a `.ts` file under an excluded path, and a `test.skip` each turns `make check` red; record the five red runs.

## Step 2 — Acceptance harness

Build what shared context 4.3 describes.

- `scripts/accept/lib.sh`: `pass`, `fail <reason>`, `skip <reason>` (print the result line and exit 0, 1, 77), `require_cmd <name>` (fails, does not skip, unless called as `require_cmd --optional`).
- `scripts/accept.sh <stage>`: runs `scripts/accept/<stage>/*.sh` in name order with a per-check timeout, captures output, prints a table, writes the log, and returns the exit code defined in 4.3.
- The exit code of a check is the authority. A script that prints `PASS` and exits 1 is a failure. A script that exits 0 without printing a result line is a failure ("no result line"). A script that times out is a failure.
- A stage directory with no scripts is a failure, not an empty success.

Test the harness itself in `scripts/accept/test/accept.test.ts` with fixture checks: all pass gives 0; one fail gives 1; pass and skip gives 77; fail and skip gives 1; the mismatch and no-result-line cases; the empty directory; the timeout.

**Accept:** those unit tests pass; `make accept STAGE=selftest` runs a fixture stage and exits 77 with a correct table.

## Step 3 — Defect register

Create `docs/audit/defects.md`: one row per defect in the audit's Appendix B, plus the cross-cutting ones below. Columns: id, audit location, defect, disposition, guard, stage.

- **Disposition** is one of: `fixed in salvage`, `not carried over` (name the design rule that replaces it), or `guarded` (the design never had it; a check keeps it out).
- **Guard** is a unit test name, an acceptance check id, or a `verify-stage.md` scan. Every row has one.
- **Stage** is where the guard first exists.

The register must contain at least these rows, with these dispositions:

| Id | Defect | Disposition | Guard | Stage |
|---|---|---|---|---|
| D-01 | CLI `run` hard-codes a passing outcome | not carried over: no CLI; `done` needs a landed SHA (4.5) | test: `mission is not done without landedSha` | 1c |
| D-02 | Task command from an untyped field, default `true` | not carried over: an expert-run is an OpenCode session | test: `expert-run creates a session and sends the envelope` | 1c |
| D-03 | Empty gate list passes | fixed in salvage | test: `defect: empty check list is an error` | 0 |
| D-04 | Judge verdicts copied from the gate result | not carried over | test: `verdict step without a judge fails with no-judge` | 2a |
| D-05 | Worktree destroyed; uncommitted work lost; nothing landed | not carried over | tests: `uncommitted changes are committed by the Dispatcher`, `landing sets landedSha` | 1c |
| D-06 | Sandbox lanes expose host files, environment, network | not carried over: no lanes (section 6) | scan: no `bwrap`, no `docker run` outside `envrunner/` and `lifecycle/` | 0 |
| D-07 | Containers without name, limits, user, `:z` | guarded | check: generated compose has limits, `cap_drop`, `:z` on every bind | 1b |
| D-08 | Timeout kills only the direct child | fixed in salvage | test: `defect: timeout kills the whole process group` | 0 |
| D-09 | Children inherit the parent environment | fixed in salvage | test: `defect: child sees only the explicit environment` | 0 |
| D-10 | Retry resets the task branch and detaches HEAD | fixed in salvage | test: `defect: retry keeps commits on the task branch` | 0 |
| D-11 | "Fix task" depends on the task it should fix; reason discarded | not carried over: rework re-runs the same task | tests: `retry re-queues the same task`, `rework notes reach the builder session` | 1c, 2a |
| D-12 | `failed` and `cancelled` unreachable; dependents never cancelled | not carried over | tests: `every status is reachable`, `dependents of a failed task are cancelled` | 1c |
| D-13 | No replan, no mission halt | not carried over | test: `three failures force a replan; two more halt the mission` | 2a |
| D-14 | Journal divergence test uses `&&` | fixed in salvage | test: `defect: a rewritten log of equal length is detected` | 0 |
| D-15 | Journal rewritten in full on every save; no lock | fixed in salvage | tests: `append never changes earlier bytes`, `a second writer is refused` | 0 |
| D-16 | Second OpenCode client with nonexistent endpoints | not carried over: one module | test: `every operation the client uses exists in openapi.json` | 0, 1c |
| D-17 | `createSession` cannot set agent, directory, or permissions | fixed in salvage | test: `createSession sends agent, location, permissions, metadata` | 0 |
| D-18 | Two incompatible judge report schemas | fixed in salvage | tests: `a pass with a blocker is invalid` (0), `protocol examples in FLEET_PROTOCOL.md parse` (1b) | 0, 1b |
| D-19 | Compose publishes on all interfaces | guarded | check: only the gateway publishes, on `127.0.0.1` | 1b |
| D-20 | Healthcheck targets a nonexistent endpoint | guarded | check: every expert reaches `healthy` through `/api/info` | 1b |
| D-21 | Compose runs a command that does not exist | guarded | check: Dispatcher container healthy, `/healthz` answers | 1d |
| D-22 | E2E script downgrades failures to warnings | guarded: rule 4.1.2 | harness self-test; `verify-stage.md` scan | 0 |
| D-23 | Gateway returns invented results as success | not carried over: rule 4.1.5 | scan for placeholder returns; the Stage 4c stub is named a fake | 0, 4c |
| D-24 | Default token; constant readiness | guarded: no credential default | test: `Dispatcher refuses to start without each credential` | 1d |
| D-25 | Text-matching shell guard as the only control | guarded: the proxy is the boundary | check: a request to a non-allowlisted host fails and is logged | 1b |
| D-26 | Pack manifests reference missing files | guarded | test: `pack with a missing referenced file is rejected` | 4b |
| D-27 | Entitlement patches in the distribution | guarded | check `0/06-no-donor-code`; pack layout allowlist | 0, 4b |
| D-28 | CI ran neither lint nor typecheck; files outside typecheck | fixed | check `0/01-make-check`, `0/02-ts-coverage` | 0 |
| D-29 | Vacuous skips counted as passes | fixed | `check-no-skips.sh`; harness exit 77 | 0 |
| D-30 | Commit subjects and reports claimed absent features | guarded: operating rules | `verify-stage.md` compares claims with the tree | 0 |

Where a row lists two stages, its first guard belongs to the first stage and must exist when that stage ends.

**Accept:** the register exists; every row has a disposition, a guard, and a stage; every guard marked stage 0 names a test or check that exists in the repository at the end of this stage.

## Step 4 — Salvage: utilities

Copy each file per the salvage map (shared context 2.3), apply the changes, and write the tests. For each defect-named test, first run it against the unchanged salvaged code and save the failing output under `docs/evidence/0/red/`, then make the fix.

**`dispatcher/src/util/hash.ts`, `redact.ts`.** Port with their behaviour unchanged. Tests: canonical JSON is key-order independent; redaction covers key names and token shapes; redaction is idempotent.

**`dispatcher/src/util/exec.ts`.**

- `execCmd(argv, { cwd, env, timeoutMs, maxOutputBytes })`. `env` is required. There is no default that reads `process.env`.
- Spawn the child as the leader of a new process group. On timeout, kill the group, wait for it, and return `{ exit: 124, timedOut: true }`. After a normal exit, kill any members of the group that remain.
- Provide `baseEnv()` returning only `PATH` and `LANG`, for callers to extend deliberately.
- Add a lint or grep rule to `make check`: in `dispatcher/src` and `verifier/src`, `process.env` may be read only in `config.ts`.

Tests: `defect: child sees only the explicit environment` (set a canary in the parent; the child's `env` output must not contain it); `defect: timeout kills the whole process group` (the command starts a background `sleep`, writes its PID to a file, and waits; after the timeout the PID is gone); exit code passthrough; missing binary gives 127; output cap holds.

**Accept:** the tests pass; both defect tests have red evidence from the unfixed code.

## Step 5 — Salvage: audit log

Build `dispatcher/src/audit.ts` to shared context 9.12, starting from the salvaged journal.

- `AuditLog.open(dir)` takes the lock, verifies the chain, and returns a handle. A second `open` on the same directory from another process fails with a message naming the lock holder.
- `append(event, data, actor)` writes one line with `O_APPEND` and `fsync`.
- `verify()` returns the first bad line and the reason.
- `anchor()` returns `{ seq, hash }`. `checkAnchor(anchor)` is true only if the log has that hash at that sequence number. This is what detects a wholesale rewrite; a chain that merely verifies does not.
- A torn final line (a partial write after a crash) makes `open` fail closed with the byte offset. Provide `scripts/audit-repair.ts`, for a human to run, which moves the fragment aside and appends an `audit.repaired` event.

Tests: append and verify; an edit to a middle line is reported with its line number; `defect: a rewritten log of equal length is detected` (take an anchor, replace the file with a different valid chain of the same length, `checkAnchor` is false); `append never changes earlier bytes` (the file's previous content is a byte-for-byte prefix after more appends); `a second writer is refused` (spawn a second process); secrets under sensitive keys are redacted before hashing; a torn tail refuses to open.

**Accept:** the tests pass, with red evidence for the two defect tests.

## Step 6 — Salvage: model and graph

- `dispatcher/src/model.ts`: Zod schemas and types for `Task` and `Mission` exactly as in shared context 9.3. No other module defines these shapes.
- `dispatcher/src/graph.ts`: from the salvaged DAG module. Validation (duplicate ids, unknown dependencies, self-dependencies, cycles with the cycle path in the error), and a deterministic topological order. Remove `readySet`, `allDone`, and `settled`; scheduling is Stage 1c.

Tests: port the salvaged `dag.test.ts` cases to the new model; add a case per dependency trigger value being accepted by the schema.

**Accept:** the tests pass; no file outside `model.ts` declares a task or mission status list (grep).

## Step 7 — Salvage: worktrees

Build `dispatcher/src/worktrees.ts` from the salvaged module.

- `allocate({ repoDir, treesDir, taskId, mode: "branch" | "detached", base })`. In `branch` mode: if `fleet/<taskId>` exists, add the worktree **on that branch at its current tip**; otherwise create the branch from `base`. In `detached` mode, check out `base` detached.
- `release({ repoDir, worktree })` removes the worktree and keeps the branch.
- `salvage({ repoDir, taskId })` writes `refs/fleet-salvage/<taskId>` at the branch tip, then deletes the branch.
- `inspect` reports HEAD, branch, dirty state, and commits ahead of `base`.
- Task and mission ids are validated as slugs before they reach git.
- No function checks out, resets, or merges into the repository's own checked-out branch.

The allocation register (so a crash never leaves an untracked worktree) needs the store and comes in Stage 1c. Leave a typed hook for it.

Tests, each against a temporary repository: a new task gets `fleet/<id>` from the base; a detached allocation has no branch; `defect: retry keeps commits on the task branch` (allocate, commit, release, allocate again: HEAD is on `fleet/<id>`, at the same commit, with the file present); salvage creates the ref and removes the branch; after every operation the repository's own HEAD and base branch tip are unchanged; an id with `/` or `..` is rejected.

**Accept:** the tests pass, with red evidence for the defect test.

## Step 8 — Salvage: check runner

Build `verifier/src/run-checks.ts` from the salvaged gate runner.

- Input: `{ dir, setup: string[], checks: [{ id, run, timeoutSec }], artifactsDir, env }`.
- Missing or empty `checks` throws `NoChecksError`; callers map it to the reason `no-checks`.
- Run `setup` commands in order; the first failure ends the run with reason `setup`. Then run every check, even after one fails, so the result lists them all.
- Each command runs through `execCmd` with the explicit `env`.
- Full output goes to `<artifactsDir>/verify/<id>.log`. The result carries, per check: `id`, `exit`, `durationMs`, `timedOut`, `logPath`, `outputHash`, and a redacted excerpt.
- There is no default check list and no budget gate.

Tests: all green; one red among three still reports all three; a timeout reports 124 and `timedOut`; `defect: empty check list is an error`; a setup failure; logs exist and hold the full output; the environment is the explicit one.

**Accept:** the tests pass, with red evidence for the defect test.

## Step 9 — Salvage: protocol blocks

Build `dispatcher/src/protocol.ts` to shared context 9.8, reusing the consistency rules from the salvaged `judges/reports.ts`.

- `ResultBlock` and `VerdictBlock` Zod schemas.
- `extractBlock(text, "RESULT" | "VERDICT")` returns `{ ok: true, value, raw }` or `{ ok: false, reason, raw }`.

Tests: a valid result; a valid verdict; a block after earlier code fences in a long message; two headings, the last wins; `a pass with a blocker is invalid`; fail with only minor findings is invalid; `blocked` without a question is invalid; missing heading; malformed JSON; the raw text is always returned.

**Accept:** the tests pass. There is exactly one definition of each schema in the repository.

## Step 10 — OpenCode client and the fake server

**Client.** `dispatcher/src/opencode.ts` from the salvaged `HostClient`, renamed `OpenCodeClient`.

- Keep: Basic auth, `{ data }` unwrapping, `prompt`, `wait` with the polling fallback on 404 or 501 only, `diff`, `interrupt`, `listMessages`, `getSession`, `deleteSession`.
- Rename `health` to `info`.
- `createSession(body)` sends `{ title, agent, location: { directory }, permissions, metadata }`.
- Every non-2xx response throws with the method, path, and status. Nothing is swallowed.

**Fake server.** `dispatcher/test/support/fake-opencode.ts`. Every later Dispatcher test depends on it, so build it carefully.

- Serves the operations the Dispatcher will use: `GET /api/info`, `GET /openapi.json` (the real file from `review/opencode/packages/protocol/openapi.json`), session create, get, delete, prompt, wait, interrupt, message list, diff, permission list and reply, `PUT` environment, and `GET /api/event` as SSE.
- Requires Basic auth; without it, 401. Wraps JSON in `{ data }`.
- Sessions follow a **script**: a list of rules, each with a prompt matcher and steps. Step types: `write` a file, `commit`, `message`, `permission` (raise a request and wait for the reply), `error` (with a kind such as `rate_limit` and an optional reset time), `delay`, `hang`.
- `write` and `commit` really happen in the session's `location.directory`, so worktree, diff, policy, and landing code can be tested against real git state.
- `wait` blocks until the session's script has finished. `diff` returns the real git diff. Events are emitted on the SSE stream as steps run.
- It records every request for assertions.
- A startup self-check compares its route table with `openapi.json`: every method and path it serves must exist in the spec.

Tests: client against the fake for each method; 401 without a password; a 500 from the fake surfaces as a thrown error; `createSession sends agent, location, permissions, metadata`; `every operation the client uses exists in openapi.json`; `every route the fake serves exists in openapi.json`; a scripted session that writes and commits leaves that commit in the directory.

**Live test.** Move the salvaged live test to `dispatcher/test/live/opencode.live.test.ts`. It is run only by an acceptance script, which exits 77 if no `opencode` binary is on `PATH` and must pass if one is.

**Accept:** the unit tests pass; the live check passes or skips for the stated reason only.

## Step 11 — Guards and handoff note

- `scripts/accept/0/06-no-donor-code.sh` fails if this repository contains a `*.patch` file, a path containing `unlock`, a `launcher/` directory, `bwrap` in any first-party source file, or `docker run` outside `envrunner/` and `lifecycle/`.
- Write `docs/handoff/heretek-opencode-archive.md` for the user: the README text to place in `heretek-opencode` pointing here and to the audit, and the commands to archive it. Mark it as steps for a human. Do not run them and do not modify that repository.
- Complete the "Salvage" section of `docs/build-notes.md`: source path, destination, salvage commit, and the changes made, one row per file.

**Accept:** the guard passes on the real tree and fails when a `.patch` file is added (red proof); the handoff note exists; the salvage table lists every file from the salvage map that this stage handled.

## Acceptance checks for this stage

Create these under `scripts/accept/0/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` exits 0. |
| `02-ts-coverage` | The coverage script passes on the tree. |
| `03-harness-selftest` | The harness unit tests pass. |
| `04-defect-register` | Every register row is complete, and every stage 0 guard resolves to an existing test or check. |
| `05-salvage-provenance` | Every destination in the salvage table exists, and every source exists at `14f297a`. |
| `06-no-donor-code` | As in step 11. |
| `07-no-skips` | `check-no-skips.sh` passes. |
| `08-fake-matches-openapi` | The fake's route self-check passes. |
| `09-opencode-live` | The live client test passes. May skip only if no `opencode` binary is installed. |
| `10-ci-runs-make-check` | The workflow file invokes `make check` and nothing overrides its exit code. |

## Report

Write `docs/reports/stage-0.md` in the format of shared context 4.4. Under "Not built", list every salvaged module as not yet wired, with the stage that will wire it. Then stop.
