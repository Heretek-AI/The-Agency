# Stage 2b — Per-task environments

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** `docs/reports/stage-2a.md` and its verification report exist with a PASS verdict. Read the preflight notes on user namespaces and the answer to spike question 15 in `docs/build-notes.md`. Work on branch `stage-2b-environments`.

## Goal of this stage

Give every task that needs one a throwaway environment stack: its own application, database, and services, alive exactly as long as the task.

At the end of this stage a feature mission on a database-backed fixture repository runs the whole Stage 2a pipeline with a fresh stack for the test author, the builder, each judge, and each verify run. This completes Stage 2 of the original design (issue #2).

## Not in this stage

Multiple repositories, onboarding, GitHub, schedules, Discord (stage 3). Extended experts, on-demand start, evals, packs (stage 4).

## Ask the user

Nothing new. If the host cannot run a nested container daemon at all, stop and report what you tried.

## Step 1 — Environment runner

`envrunner/`: one service that owns a nested container daemon and nothing else.

- **Daemon.** Try rootless Docker-in-Docker and Podman-in-container on this host and use whichever works with the least privilege. This is the one container allowed elevated privileges; record exactly which flags it needs and why in `docs/build-notes.md` and `docs/operations.md`. It attaches to `fleet` and reaches image registries only through the egress proxy, under its own proxy identity.
- **Callers.** Only the Dispatcher, with a shared secret (`ENVRUNNER_TOKEN`). Experts must not be able to call its API or reach its daemon socket; prove this in the acceptance checks.
- **API.**

| Call | Effect |
|---|---|
| `POST /stacks` `{ taskId, repoId, dir }` | Brings up the repository's environment definition as project `t-<taskId>` with `dir` (a worktree under `/work`) as its build context and mount, injects the repository's secrets, waits for health, and returns the endpoints and variables for the task. |
| `GET /stacks/:taskId` | State, endpoints, and recent logs. |
| `POST /stacks/:taskId/exec` `{ service, cmd, timeoutSec }` | Runs a command in a service and returns the exit code, with output written to `/artifacts/<taskId>/`. |
| `DELETE /stacks/:taskId` | Tears the stack down with its volumes. |

- **Environment definition.** `state/registry/<repoId>/env.compose.yml` is an ordinary compose file plus one extension block:

```yaml
services:
  app:
    build: .
    depends_on: { db: { condition: service_healthy } }
    environment: { DATABASE_URL: "postgres://app:{gen:DB_PASSWORD}@db:5432/app" }
  db:
    image: postgres:17
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: "{gen:DB_PASSWORD}", POSTGRES_DB: app }
    healthcheck: { test: ["CMD", "pg_isready", "-U", "app"], interval: 3s, retries: 20 }
x-agency:
  expose:   { app: 3000, db: 5432 }         # service ports the task may reach
  generate: [DB_PASSWORD]                   # a fresh random value per stack
  env:                                      # given to the expert's session and to checks
    APP_URL:      "http://{host}:{app}"
    DATABASE_URL: "postgres://app:{gen:DB_PASSWORD}@{host}:{db}/app"
  verifyService: app                        # where checks marked needsEnv run
```

  The runner allocates ports per task, generates each value under `generate`, substitutes `{host}`, the port names, and `{gen:NAME}`, and returns the result. Because every stack has its own generated credentials, a task that guesses another stack's port still cannot read its data.

  Secrets come from `state/registry/<repoId>/secrets.env` and go into the stack only; they are never returned to the Dispatcher's callers or shown to experts.

  The runner refuses a definition that mounts a host path outside the worktree, sets `privileged`, uses host networking, or mounts a daemon socket.

- **Lifecycle.** A stack lives exactly as long as its task. Each judge and each verify run gets a fresh stack, so one cannot inherit state from another. Stacks have CPU, memory, and lifetime caps. On Dispatcher startup, stacks without a running task are removed.

Tests for the runner's pure parts (substitution, port allocation, definition validation and each refusal) run under `bun test`. The daemon itself is proven by the acceptance checks.

**Accept:** checks `02` to `07` below.

## Step 2 — Dispatcher side

- `dispatcher/src/env.ts`: the `EnvProvider` interface, with the Stage 2a behaviour (`no-env-runner`) replaced by `RunnerEnvProvider`. Before a task that needs an environment starts, create the stack, pass the variables to the session (`setEnvironment`, or the fallback for spike question 15), and list the endpoints in the envelope. Delete the stack when the task reaches a terminal state, including on failure, timeout, and Dispatcher restart.
- A stack that fails to come up healthy fails the task with reason `env-failed` and the runner's log path. The task does not run without it.
- Add the second `Verifier` implementation: checks marked `needsEnv: true` in `checks.yaml` run through `exec` in `verifyService`; the rest keep using the Stage 1 verifier. A `needsEnv` check with no environment available fails with `no-env`; it is never skipped.
- Dashboard: environment stack status and logs per task.

Tests with a fake runner under `test/support/`: a stack is created before the session and deleted after it, on success, failure, and timeout; `env-failed`; `needsEnv` routing; `no-env`; orphaned stacks are removed on startup; the secret value never appears in a task event, result, or envelope.

**Accept:** the tests pass.

## Step 3 — Fixture

Add `fixtures/demo-db-repo`: a small service with a Postgres database, migrations, tests that need the database, and example control files under `registry.example/demo-db/` including `env.compose.yml`, a `checks.yaml` with at least one `needsEnv` check, and a `secrets.env` holding a recognizable canary value.

**Accept:** the control files validate; the fixture's tests pass inside a stack and fail outside one.

## Step 4 — End to end

`scripts/e2e-stage2.sh` on `fixtures/demo-db-repo`: start a `feature` mission through the Director ("add an endpoint that lists users, newest first, with pagination"). Assert:

- a recorded red result before the build;
- a green verify, with the `needsEnv` checks run inside a stack;
- a verdict from each judge bound to the landed SHA, each judge having had its own stack;
- a reviewer verdict;
- the commits on `fleet/integration/<missionId>`;
- the repository's tests passing on that branch in a fresh stack;
- no stack left afterwards.

**Accept:** `make e2e` passes with a real key.

## Acceptance checks for this stage

Under `scripts/accept/2b/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` exits 0. |
| `02-runner-healthy` | The runner and its nested daemon are healthy; build notes record the daemon choice and its exact privileges. |
| `03-two-stacks-isolated` | Two tasks running at once get different databases and credentials; a row written through one stack is absent from the other; one stack's credentials are refused by the other's database. |
| `04-expert-reaches-own-db` | An expert session can query its own database through the injected `DATABASE_URL`. Skips only without a provider key. |
| `05-stack-gone` | After its task ends, and after a task that timed out, the stack and its volumes no longer exist. |
| `06-runner-not-reachable-by-experts` | From an expert container, a request to the runner's API without the token is refused, and no daemon socket is reachable from any expert. |
| `07-secret-confined` | The canary from `secrets.env` is present inside the stack and absent from task events, results, envelopes, artifacts, the audit log, and Dispatcher logs. |
| `08-definition-refusals` | Definitions with a host mount, `privileged`, host networking, or a socket mount are each refused with the reason. |
| `09-needs-env-routing` | A `needsEnv` check runs in `verifyService`; with the runner stopped it fails with `no-env`. |
| `10-e2e` | Step 4. Skips only without a provider key. |
| `11-orphans-removed` | A stack created outside any task is removed when the Dispatcher starts. |

Red proofs worth the effort: give two stacks the same generated password for `03`; publish the runner's socket into an expert for `06`; write the canary into an envelope for `07`.

A skip of `04` or `10` means the stage is not complete.

## Report

Write `docs/reports/stage-2b.md` in the format of shared context 4.4, and add the daemon choice and the exact privileges it needs. Then stop.
