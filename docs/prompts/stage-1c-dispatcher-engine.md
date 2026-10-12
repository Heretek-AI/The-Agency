# Stage 1c — Dispatcher engine and verifier

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** `docs/reports/stage-1b.md` and its verification report exist with a PASS verdict. Read "Fallbacks in force" in `docs/build-notes.md`. Work on branch `stage-1c-engine`.

## Goal of this stage

The Dispatcher's deterministic core: given a mission and a plan, it allocates worktrees, runs expert tasks as OpenCode sessions, checks the diff against the ownership map, verifies, and lands on the integration branch, with every transition durable and audited.

At the end of this stage that whole path is proven twice: by tests that drive the engine against the fake OpenCode server and real temporary git repositories, and by two live runs against the Stage 1b fleet in which a `scout` task produces a report and a `docs` task lands a verified commit.

This is the stage the monorepo never built. Its Dispatcher ran `sh -c true` and called it done. Here an expert-run is an OpenCode session or it is nothing.

## Not in this stage

HTTP, REST, SSE, the `fleet_*` MCP tools, the Director's behaviour, the gateway, the dashboard (Stage 1d). Playbooks, judges (Stage 2a). Environment stacks (Stage 2b). There is no CLI. The engine exposes a programmatic API; tests and one live script are its only callers until Stage 1d.

## Ask the user

Nothing new. The live checks need the key already in `.env.provider`.

## Step 1 — Configuration and the OpenCode module

**`dispatcher/src/config.ts`.** Loads `fleet.yaml`, the registry (`state/registry/<repoId>/`), and the environment. It is the only module that reads `process.env`. A missing password, token, or key throws an error naming the variable; there are no defaults for credentials.

**`dispatcher/src/opencode.ts`.** Complete the client from Stage 0. It is the only file in the repository that contains an OpenCode API path.

| Method | Operation |
|---|---|
| `info` | `GET /api/info` |
| `createSession` | `POST /api/session` with `title`, `agent`, `location.directory`, `permissions`, `metadata` |
| `prompt` | `POST /api/session/{id}/prompt` with `text` and optional `delivery` |
| `waitIdle` | the experimental wait endpoint; polling fallback only on 404 or 501 |
| `interrupt`, `messages`, `diff`, `sessionInfo` | as named |
| `pendingPermissions`, `replyPermission` | list and reply |
| `setEnvironment` | `PUT /api/session/{id}/environment`, or the spike's fallback for question 15 |
| `subscribeEvents` | `GET /api/event` as SSE, with reconnect and a resume point |
| `assertContract` | fetch `/openapi.json` and check that every operation above exists with that method |

On startup the engine calls `assertContract` for every enabled expert and refuses to start if any operation is missing, listing them.

Tests against the fake server: each method; `assertContract` fails against a spec with one operation removed; the SSE subscription reconnects after the fake drops it; `every operation the client uses exists in openapi.json`.

**Accept:** the tests pass; a grep finds `/api/` path strings only in `opencode.ts` and in test support.

## Step 2 — Wildcard, store, audit wiring

**`dispatcher/src/wildcard.ts`.** Port `Wildcard.match` from `review/opencode/packages/core/src/util/wildcard.ts` and port its upstream test cases with it.

**`dispatcher/src/store.ts`.** SQLite through `bun:sqlite` (or the spike's fallback for question 14), WAL mode, versioned migrations. Tables for missions, tasks, decisions, events, worktree allocations, and audit anchors.

- Every state change goes through one function, `transition`, which appends the audit event (shared context 9.12) and commits the row change together with the audit `{ seq, hash }` anchor.
- If the process dies between the audit append and the commit, the log is one event ahead. On startup, detect that, append `dispatcher.recovered` naming the orphaned sequence numbers, and continue from the database.
- No module writes task or mission status except through `transition`.

Tests: a transition writes both a row and an audit event; reopening the store returns the same state; the orphan case; the audit anchor in the database matches the log.

**Accept:** the tests pass.

## Step 3 — Scheduler

**`dispatcher/src/scheduler.ts`.** A pure function of the task graph, the caps, and the set of running tasks. No clock, no randomness, no I/O. It returns which tasks to start and which to cancel, and a second pure function maps a finished task's outcome to its next status.

Rules, from shared context 9.3:

- readiness under `all_success` and `one_success`;
- cancellation of tasks that can never run;
- starts ordered by id, bounded by the fleet-wide cap and each expert's `maxConcurrent`;
- `fail` is terminal and cancels dependents; `retry` re-queues the same task while `attempts <= maxAttempts`, then fails it; `replan` parks it as `waiting-human`;
- one extra rule: two `expert-run` tasks whose declared `paths` overlap never run at the same time. Decide overlap conservatively: if either pattern's literal prefix (the text before its first wildcard) is a prefix of the other's, they overlap. Serializing two tasks that could have run together is acceptable; running two that collide is not.

Tests: each rule; `every status is reachable` (one scenario per status in the model); `dependents of a failed task are cancelled`; `retry re-queues the same task`; under `one_success` a task is cancelled only when all dependencies have failed; the overlap rule; the same input always yields the same output.

**Accept:** the tests pass; `scheduler.ts` imports nothing but the model and the wildcard module, and contains no `Date`, timer, or random call.

## Step 4 — Worktrees, policy, plan

**`dispatcher/src/worktrees.ts`.** Add to the Stage 0 module:

- the allocation register: record the allocation in the store before the git work and confirm it after, so a crash never leaves an untracked worktree; on startup, remove unconfirmed allocations;
- landing worktrees under `/work/<repoId>/landing/<id>`, created and removed by the landing transaction only;
- the base for a new task is the task's `base` if given, otherwise the mission's integration branch.

**`dispatcher/src/git.ts`.** The only module that runs a subprocess. It runs `git` and nothing else, through `execCmd` with an explicit environment. The Dispatcher never executes a repository's own commands; those run in the verifier.

**`dispatcher/src/policy.ts`.** Compares the task's changed paths (`git diff --name-status <base>...HEAD`, both sides of a rename) with its grant:

- a path matching the expert's ownership entry: allowed;
- a path matching `shared`: allowed, recorded as a flag;
- a path matching `protected`: scope failure;
- any other path: scope failure;
- a new or changed symlink: scope failure;
- for a `ro` expert, any change at all: failure with reason `ro-violation`.

**`dispatcher/src/plan.ts`.** `expandPlan(mission, directorTasks)` turns the Director's tasks into the full graph. In this stage it appends a `verify` task and a `land` task behind every `scoped` expert-run. Validation: every expert exists and is enabled; every path falls inside that expert's grant; the graph is acyclic. A plan with more expert-run tasks than `planApprovalAbove` parks the mission as `waiting-human`. Stage 2a replaces this one function with the playbook engine, so nothing else may know how the graph was built.

Tests: allocation survives a simulated crash between register and confirm; each policy outcome, including rename out of scope and the symlink; plan expansion, each validation failure, and the approval threshold.

**Accept:** the tests pass; `execCmd` is imported only by `git.ts`.

## Step 5 — Verifier

**The service (`verifier/`).** A non-LLM service built on the base image with the common toolchains (Bun, Node, `pnpm`, `uv`), no provider key, `/work` read-write, `/artifacts`, and egress through the proxy under its own identity for dependency installs.

- `GET /healthz`, open.
- `POST /run`, bearer `VERIFIER_TOKEN`: `{ taskId, dir, setup, checks }`. It resolves `dir` and refuses anything not under `/work/`. It runs `run-checks.ts` from Stage 0 with an explicit environment (path, home, proxy variables, `CI=1`) and returns each check's exit code, duration, and log path. Full logs go to `/artifacts/<taskId>/verify/`.
- An empty check list returns the `no-checks` failure; it never returns success.
- Each run is its own process group, killed whole on timeout. A cap on concurrent runs.
- Package-manager stores are shared through a cache volume so each worktree does not download everything again.
- It listens only on the `fleet` network. Add it to the renderer's compose output, with limits and hardening as in shared context section 10.

**The interface (`dispatcher/src/verify.ts`).** `Verifier.run(dir, checks, ctx)`, with `HttpVerifier` as the Stage 1 implementation. Stage 2b adds a second implementation. For engine tests, `dispatcher/test/support/local-verifier.fake.ts` runs `run-checks.ts` in the temporary repository.

**Accept:** checks `05` and `06` below.

## Step 6 — Runner

**`dispatcher/src/envelope.ts`** builds the text in shared context 9.7.

**`dispatcher/src/runner.ts`** runs one `expert-run` task:

1. Allocate the worktree: branch `fleet/<taskId>` for `scoped` experts, detached for `ro` experts.
2. Build the session permissions: for a `scoped` expert, an `edit` allow for each granted path (the expert's entry in the ownership map, plus `shared`), then an `edit` deny for each `protected` path. Apply the spike's answer to question 7.
3. `createSession({ title, agent, location: { directory: worktree }, permissions, metadata: { taskId, missionId } })`, then `prompt` with the envelope.
4. While it runs: relay the session's SSE events to the task's event log. Every few seconds, reject any pending permission request with the message `Headless fleet: this action is outside your permissions. Continue without it or report it as blocked.` and record it.
5. Wait for idle, or interrupt at `taskTimeoutSec` and fail with reason `timeout`.
6. Collect the final message, `session.diff`, the commit list and `git diff <base>...HEAD`, and the files under `/artifacts/<taskId>/`. Commit any uncommitted changes as the Dispatcher and record that it did.
7. Parse the `RESULT` block; on failure send one follow-up asking for it; on a second failure fail with `no-block`.
8. Run the policy check. Changes outside the granted paths fail the task with reason `scope`; changes to `shared` paths are recorded as flags.
9. Record `headSha`, mark the task `done`, and call the wake-up hook (an interface here; Stage 1d connects it to the Director).

An expert that cannot be reached fails the task with reason `unreachable`. Timers come from an injected clock so tests do not sleep.

Tests, each against the fake server and a temporary repository:

- `expert-run creates a session and sends the envelope`: assert the recorded request has the agent, the worktree as `location.directory`, an `edit` allow per grant, an `edit` deny per protected path, and the metadata; assert the prompt text is the envelope.
- A scripted permission request is rejected with the exact message and recorded.
- A scripted `hang` is interrupted at the timeout and fails with `timeout`.
- `uncommitted changes are committed by the Dispatcher`.
- No block, then a block after the follow-up: done. No block twice: `no-block`.
- A scripted write outside the grant: `scope`. A write to a shared file: done with a flag.
- A `ro` expert whose script writes to the worktree: `ro-violation`.
- The fake stopped: `unreachable`.

**Accept:** the tests pass.

## Step 7 — Landing

**`dispatcher/src/landing.ts`** implements shared context 9.4 exactly, including the trailers, under a per-mission lock so two landings never interleave. Each outcome is audited (`landing.merged` or `landing.reset`).

Tests, with the local verifier fake and real git:

- green path: `landing sets landedSha`; the merge commit is `--no-ff`, carries all four trailers, and its `Agency-Audit-Tip` equals the log's tip at that moment;
- a red check on the task branch merges nothing;
- an empty check list fails with `no-checks`;
- a conflict aborts and names the files, and the integration branch is unchanged;
- a red check on the merged tree resets the integration branch to the recorded tip;
- two tasks that are each green but break the tests together: the second landing is caught by the post-merge verify and reset;
- the repository's base branch and its own HEAD never move.

**Accept:** the tests pass.

## Step 8 — Limits, recovery, engine

**`dispatcher/src/limits.ts`.** Classifies provider errors using the shape the spike recorded for question 8. A refusal that looks transient is retried with backoff by re-prompting `Continue.` in the same session. A usage-limit refusal pauses every running mission: tasks are left as they are, the mission becomes `paused` with `pausedUntil` set to the reset time if the error gives one, otherwise the Dispatcher probes on a timer. On resume it re-prompts the interrupted sessions.

**`dispatcher/src/recovery.ts`.** On startup, for every task recorded as `running`: if the expert still has the session and it is busy, re-attach; if it is idle, collect; if the session is gone, fail the task with reason `lost` so its failure policy applies. Clean stale worktree allocations.

**`dispatcher/src/engine.ts`.** Ties the modules together behind one API that Stage 1d will expose: `createMission`, `submitPlan`, `approve`, `reject`, `cancel`, `getMission`, `taskResult`, `taskDiff`, `decide`, `wait`, `closeMission`, `gc`. A `tick()` advances the loop once for tests; `start()` runs it on the injected clock.

`decide(taskId, decision, notes)`:

- `accept` releases the task's verify and land steps;
- `rework` sends the notes into the same session, increments `attempts`, and re-runs the task on its existing branch;
- `abandon` salvages the branch.

Every decision is appended to the mission's decision log.

Tests:

- limits: a scripted transient error is retried with `Continue.`; a scripted usage limit pauses all running missions with `pausedUntil`; advancing the clock resumes and re-prompts;
- recovery: the three cases, and the stale allocation;
- `mission is not done without landedSha`: a mission whose land task has not landed cannot be closed as done;
- an end-to-end engine test: a mission with one `scout` task and one `docs` task runs, through `tick()`, to a report under the artifacts directory and a landed commit on `fleet/integration/<missionId>`, and the audit log holds the full chain of events for it.

**Accept:** the tests pass.

## Step 9 — Live proof

Add a Dispatcher image (`dispatcher/Dockerfile`: base image plus Bun; runs as the same uid as the experts; mounts `/work`, `/artifacts`, the registry, and `/data`; has `git`; attaches to `fleet`). It has no server entrypoint yet.

`dispatcher/test/live/engine.live.test.ts`, run inside that image on the `fleet` network by `make engine-live`, against the Stage 1b fleet, the real verifier, and the demo repository:

1. A `scout` task ("list the languages and the test command this repository uses") completes with a parsed `RESULT` and a report under `/artifacts/<taskId>/` that the scout's session wrote.
2. A `docs` task ("add a 'Running the tests' section to the README") is accepted, verified by the verifier, and landed. Assert: the commit is on `fleet/integration/<missionId>`, the README on that branch contains new text that the test did not write, the verify results are recorded and green, and the trailers are present.

The test writes nothing into the workspace itself. If the expert produces nothing, the test fails.

**Accept:** checks `07` and `08` below.

## Acceptance checks for this stage

Under `scripts/accept/1c/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` exits 0. |
| `02-register-guards-present` | Every guard in `docs/audit/defects.md` with a stage of 1c or earlier names a test that exists and passed in this run. |
| `03-scheduler-pure` | Step 3's Accept line. |
| `04-single-opencode-module` | Step 1's Accept line. |
| `05-verifier-live` | The verifier is healthy; a wrong token gets 401; a `dir` outside `/work` is refused; the demo repository's checks run green; a worktree with a deliberate lint error runs red with the failing check named; an empty check list returns `no-checks`; a check that backgrounds a process and times out leaves no process behind. |
| `06-verifier-isolated` | The verifier's environment has no provider key; an expert container calling it without the token is refused. |
| `07-engine-live-scout` | Step 9, run 1. Skips only without a provider key. |
| `08-engine-live-docs-lands` | Step 9, run 2. Skips only without a provider key. |
| `09-no-task-exec-in-dispatcher` | `execCmd` is imported only by `git.ts`, and `git.ts` runs only `git`. |
| `10-audit-chain-intact` | After the live runs, the audit log verifies and the landed commit's `Agency-Audit-Tip` is found in it. |

Red proofs worth the effort: stop the `docs` expert for `08`; break the demo repository's linter on the task branch for `08`; remove an operation from a copied spec for the contract test; revert the retry fix for the worktree test.

A skip of `07` or `08` means the stage is not complete.

## Report

Write `docs/reports/stage-1c.md` in the format of shared context 4.4. State plainly that the engine has no service in front of it yet and list its API under "Not built: not wired". Then stop.
