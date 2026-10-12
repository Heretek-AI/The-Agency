# Stage 2 — Playbooks, dual QA, and per-task environments

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** the stage 1 report shows its acceptance checks passed. Read `docs/build-notes.md` for the spike answers and any fallbacks in force. Work on branch `stage-2-playbooks`.

## Goal of this stage

Replace the Director's free-form planning with playbooks the Dispatcher enforces, add the test author and the two QA judges with bounded rework, and give every task that needs one a throwaway environment stack.

At the end of this stage a feature mission on a database-backed fixture repository runs the whole pipeline: failing tests first, implementation, verify, two independent QA verdicts, review, landing. A mission that cannot be made to pass halts for a human instead of looping.

## Not in this stage

Multiple repositories, onboarding, GitHub, schedules, Discord (stage 3). Extended experts, on-demand start, evals, packs (stage 4).

## Ask the user

Nothing new. If the host cannot run a nested container daemon at all, stop and report what you tried.

## Step 1 — Environment runner

`envrunner/`: one service that owns a nested container daemon and nothing else.

- **Daemon.** Try rootless Docker-in-Docker and Podman-in-container on this host and use whichever works with the least privilege. This is the one container allowed elevated privileges; record exactly which flags it needs and why in `docs/build-notes.md` and `docs/operations.md`. It attaches to `fleet` and reaches image registries only through the egress proxy.
- **Callers.** Only the Dispatcher, with a shared secret. Experts must not be able to call its API or reach its daemon socket; prove this in the acceptance checks.
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
  db:
    image: postgres:17
    healthcheck: { test: ["CMD", "pg_isready", "-U", "app"], interval: 3s, retries: 20 }
x-agency:
  expose:   { app: 3000, db: 5432 }         # service ports the task may reach
  env:                                      # given to the expert's session and to checks
    APP_URL:      "http://{host}:{app}"
    DATABASE_URL: "postgres://app:app@{host}:{db}/app"
  verifyService: app                        # where checks marked needsEnv run
```

  The runner allocates host ports per task, substitutes `{host}` and the port names, and returns the result. Secrets come from `state/registry/<repoId>/secrets.env` and go into the stack only; they are never returned to the Dispatcher's callers or shown to experts.

- **Lifecycle.** A stack lives exactly as long as its task. Each judge and each verify run gets a fresh stack, so one cannot inherit state from another. Stacks have CPU, memory, and lifetime caps. On Dispatcher startup, stacks without a running task are removed.
- **Dispatcher side.** Before a task that needs an environment starts, create the stack, pass the variables to the session with `PUT /api/session/{id}/environment`, and list the endpoints in the envelope. Add the second `Verifier` implementation: checks marked `needsEnv: true` in `checks.yaml` run through `exec` in `verifyService`; the rest keep using the stage 1 verifier.

Add `fixtures/demo-db-repo`: a small service with a Postgres database, migrations, tests that need the database, and example control files under `registry.example/demo-db/`.

**Accept:** two tasks running at once get different databases and cannot see each other's data; an expert can query its own database through the injected `DATABASE_URL`; a stack is gone after its task ends; a request from an expert container to the runner's API is refused, and no daemon socket is reachable from any expert; the secret value in `secrets.env` appears in the stack and nowhere in task events, results, or artifacts.

## Step 2 — Playbook engine

Replace `plan.ts`'s `expandPlan` with an engine that reads `playbooks/*.yaml`. Playbooks are validated at startup and the Director cannot alter them.

**Unit of planning.** The Director no longer submits tasks. It submits **work items**: one coherent change with an owner expert, an objective, context, constraints, acceptance criteria, paths, and dependencies on other work items. The engine expands each work item into the playbook's steps.

**Schema.**

```yaml
id: feature
description: A behavior change with new or changed acceptance criteria.
steps:                              # expanded once per work item, in order
  - { id: tests,    kind: expert-run, role: test-author, expert: qa, env: true, expect: red }
  - { id: build,    kind: expert-run, role: build, expert: $owner, base: tests, env: true }
  - { id: verify,   kind: verify }
  - { id: qa,       kind: verdicts, judges: [qa-functional, qa-adversarial], tiebreak: architect, env: true }
  - { id: review,   kind: verdicts, judges: [reviewer] }
  - { id: security, kind: verdicts, judges: [security], when: sensitive }
  - { id: land,     kind: land }
rework: { attempts: 3, replans: 1, attemptsAfterReplan: 2 }
```

**Step kinds.**

| Kind | Behavior |
|---|---|
| `expert-run` | As in stage 1. With `expect: red`, after the task the engine runs the repository's test check and requires it to fail on the new tests; if everything passes, the tests do not test the change, and the task fails with reason `not-red`. The red result is stored as proof. |
| `verify` | The verify gate on the work item's branch. |
| `verdicts` | Runs each judge as its own read-only task against the work item's current head, each in a fresh environment when `env: true`, in parallel. All pass: the step passes. All fail: the step fails. A split with a `tiebreak` creates one more task for that expert, who sees both verdicts and the diff and returns the deciding verdict. Judges never see each other's verdict before giving their own. |
| `land` | The landing transaction. |

**Rules the engine enforces.**

- **A verdict is bound to a commit.** Every gate result records the head SHA it judged. Landing requires a pass from every required gate for the branch's current head. Any new commit on the branch invalidates earlier results, and the gates run again from `verify`.
- **Rework is bounded.** When a gate fails, the engine wakes the Director with the findings. The Director sends rework notes to the builder (`fleet_decide` with `rework`), which counts as an attempt. After the third failed attempt the Director must replan the work item (a revised brief or a split into smaller items). After two more failed attempts the mission becomes `halted` and waits for a human. A `needs-split` status from an expert goes straight to replan.
- **`when: sensitive`** is true when the work item's diff touches a path in the repository's `sensitivePaths` (add this list to `repo.yaml`; default: authentication code, dependency manifests and lockfiles, CI and deployment files, anything matching `*secret*` or `*crypt*`).
- **Stacked work.** A work item that depends on another is based on that item's branch. If the earlier item gets new commits, the later one is marked stale, its results are discarded, and it is re-run from its first step.
- **Guards.** A playbook may restrict what the diff can touch. `docs-only` requires every changed path to match the repository's `docsPaths`; otherwise the work item fails with reason `playbook-scope`. This stops a cheap playbook from being used to skip QA.

**Playbooks to ship.**

| Id | Steps |
|---|---|
| `feature` | tests (red), build, verify, dual QA, review, security when sensitive, land |
| `bugfix` | The same; the test author's brief is to reproduce the defect as a failing test |
| `security-fix` | The same, with the security verdict always required |
| `dependency-update` | build, verify, dual QA, review, security always, land |
| `docs-only` | build by `docs`, verify, review, land; guarded by `docsPaths` |
| `research` | read-only expert runs only; the result is a report under `/artifacts`; no branch and no landing |

**Tool changes.**

| Tool | Change |
|---|---|
| `fleet_playbooks` | New. Lists playbooks with descriptions and steps. |
| `fleet_mission_create` | `playbook` is now required. |
| `fleet_plan_submit` | Takes `workItems[]` (`key`, `owner`, `title`, `objective`, `context`, `constraints`, `acceptance[]`, `paths[]`, `deps[]`) instead of tasks. |
| `fleet_mission_get` | Shows each work item's pipeline: step states, attempts used, and gate results with the SHA each applies to. |
| `fleet_decide` | Decisions are `rework` (notes to the builder), `replan` (revised or split work items), and `abandon`. There is no `accept`; gates decide what lands. |
| `fleet_gate_results` | New. Verdicts and findings for a work item, bounded. |

Add `POST /api/missions/:id/resume` with a required human note for halted missions; the note is appended to the decision log and given to the Director.

**Accept:** unit tests drive the engine with a scripted fake OpenCode server and cover: a clean pass through `feature`; `not-red`; a split verdict resolved by the tiebreak; three failures forcing a replan; two more halting the mission; a rework commit invalidating earlier verdicts; a stale stacked item being re-run; and the `docs-only` guard.

## Step 3 — QA seats and personas

- Enable `qa-functional` and `qa-adversarial` in `fleet.yaml` and write their Dockerfiles, personas, and skills. Both are `ro`. Their only output is the VERDICT block and files under `/artifacts/<taskId>/`.
  - **Functional judge:** checks each acceptance criterion against the running application and the tests, one by one, and cites evidence for each. It fails the change if any criterion is unmet or cannot be demonstrated.
  - **Adversarial judge:** tries to break the change with edge cases, invalid and hostile input, concurrency, error paths, and regressions in neighbouring behavior. Every failure comes with reproduction steps. It does not fail a change for style or for missing features outside the brief.
- Rewrite `qa` as the test author: it writes tests from the brief and the acceptance criteria only, before any implementation exists, and must not look for or depend on an implementation.
- Give the architect a `qa-tiebreak` skill: read both verdicts, reproduce the disputed findings, decide, and state the reason.
- Update `reviewer` and `security` to end with the VERDICT block.
- Rewrite the Director persona for playbooks: choose with `fleet_playbooks`, plan in work items, never try to skip a step, write rework notes that quote the findings, replan when told to, and report halts plainly.

**Accept:** `scripts/smoke.sh` passes for all fourteen core experts.

## Step 4 — Dashboard

Add: a pipeline view per work item (each step's state, attempts used out of the allowance, the red proof, verdicts side by side with their findings and the SHA they apply to); environment stack status and logs per task; a resume form for halted missions; flags for changes to shared files.

## Step 5 — End to end

`scripts/e2e-stage2.sh` on `fixtures/demo-db-repo`: start a `feature` mission through the Director ("add an endpoint that lists users, newest first, with pagination"). Assert: a recorded red result before the build; a green verify; a verdict from each judge bound to the landed SHA; a reviewer verdict; the commits on `fleet/integration/<missionId>`; and the repository's tests passing on that branch in a fresh stack.

**Accept:** `make e2e` passes with a real key. Without one, all scripted-server tests pass and the report says the live run was not performed.

## Report

Reply with: what was built per step and its commit; every acceptance check with the command and result; the daemon choice and the exact privileges it needs; deviations and why; anything not tested, stated as not tested.
