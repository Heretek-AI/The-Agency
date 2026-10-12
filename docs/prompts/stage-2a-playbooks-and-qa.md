# Stage 2a — Playbooks, QA seats, and bounded rework

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** `docs/reports/stage-1d.md` and its verification report exist with a PASS verdict, and the Stage 1 end-to-end run was performed, not skipped. Read `docs/build-notes.md` for the spike answers and fallbacks in force. Work on branch `stage-2a-playbooks`.

## Goal of this stage

Replace the Director's free-form planning with playbooks the Dispatcher enforces, and add the test author and the two QA judges with bounded rework.

At the end of this stage a feature mission on the demo repository runs the whole pipeline: failing tests first, implementation, verify, two independent QA verdicts, review, landing. A mission that cannot be made to pass halts for a human instead of looping.

## Not in this stage

Environment stacks (Stage 2b). A step marked `env: true` on a repository that defines an environment fails with reason `no-env-runner` until then; on a repository that defines none, such as the demo repository, it runs without one. Multiple repositories, onboarding, GitHub, schedules, Discord (stage 3). Extended experts, evals, packs (stage 4).

## Ask the user

Nothing new.

## Step 1 — Playbook engine

Replace `plan.ts`'s `expandPlan` with `dispatcher/src/playbooks.ts`, an engine that reads `playbooks/*.yaml`. Playbooks are validated at startup; an invalid one stops the Dispatcher with the file and the reason. The directory is mounted read-only into the Dispatcher and no tool can change it.

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

Validation rejects: an unknown step kind; an expert or judge that is not in `fleet.yaml`; a judge whose access is not `ro`; a `verdicts` step with two judges and no `tiebreak`; a playbook that lands without a `verify` step before it; a `rework` block with a zero or missing value.

**Step kinds.**

| Kind | Behavior |
|---|---|
| `expert-run` | As in Stage 1. With `expect: red`, after the task the engine runs the repository's test check (named by `testCheck` in `repo.yaml`) through the verifier and requires it to fail; if everything passes, the tests do not test the change, and the task fails with reason `not-red`. The red result, with its commit SHA and log path, is stored as proof. |
| `verify` | The verify gate on the work item's branch. |
| `verdicts` | Runs each judge as its own read-only task against the work item's current head, each in its own container, session, and detached worktree, in parallel. All pass: the step passes. All fail: the step fails. A split with a `tiebreak` creates one more task for that expert, who sees both verdicts and the diff and returns the deciding verdict. |
| `land` | The landing transaction. |

**Rules the engine enforces.**

- **Judges are independent.** A judge's envelope never contains another judge's verdict or findings, even when the other finished first. Only the tiebreak task sees both.
- **No judge, no pass.** If a required judge is disabled, unreachable, or returns no valid `VERDICT` after the follow-up, the step fails with reason `no-judge`. Nothing substitutes for a verdict.
- **A verdict is bound to a commit.** Every gate result records the head SHA it judged. Landing requires a pass from every required gate for the branch's current head. Any new commit on the branch invalidates earlier results, and the gates run again from `verify`.
- **Rework is bounded.** The first build is attempt 1. When a gate fails, the engine wakes the Director with the findings. The Director sends rework notes to the builder (`fleet_decide` with `rework`), which starts the next attempt in the same session and on the same branch. After the third failed attempt the engine refuses further `rework` for that work item and requires a replan (a revised brief or a split into smaller items). After a replan there are two attempts. When those fail, the mission becomes `halted` and waits for a human. A `needs-split` status from an expert goes straight to replan. The engine enforces these counts whatever the Director asks for.
- **Red needs a named check.** Add `testCheck` to `repo.yaml` and its schema: the id of the check in `checks.yaml` that runs the tests. A step with `expect: red` on a repository without it fails with reason `no-test-check`.
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

Add `POST /api/missions/:id/resume` with a required human note for halted missions; the note is appended to the decision log and given to the Director as quoted data.

**Tests.** Drive the engine with the scripted fake OpenCode server. Required, by name:

- `clean pass through feature`: every step runs in order and the item lands;
- `not-red`: tests that pass before the build fail the task;
- `split verdict is resolved by the tiebreak`;
- `judges do not see each other's verdict`: assert on the recorded envelope of the second judge;
- `verdict step without a judge fails with no-judge`: a disabled judge, an unreachable judge, a judge that returns no block;
- `three failures force a replan; two more halt the mission`;
- `rework beyond the allowance is refused`;
- `rework notes reach the builder session`: the recorded prompt quotes the findings, in the same session id;
- `needs-split goes to replan`;
- `a rework commit invalidates earlier verdicts`;
- `a stale stacked item is re-run`;
- `the docs-only guard rejects a source change`;
- `a sensitive path adds the security verdict`;
- each playbook validation rejection;
- `env: true on a repository with an environment fails with no-env-runner`.

**Accept:** the tests pass; `plan.ts`'s `expandPlan` is gone and nothing else changed to accommodate the swap except the tools listed above.

## Step 2 — QA seats and personas

- Enable `qa-functional` and `qa-adversarial` in `fleet.yaml` and write their Dockerfiles, personas, and skills. Both are `ro`. Their only output is the `VERDICT` block and files under `/artifacts/<taskId>/`.
  - **Functional judge:** checks each acceptance criterion against the running application and the tests, one by one, and cites evidence for each. It fails the change if any criterion is unmet or cannot be demonstrated.
  - **Adversarial judge:** tries to break the change with edge cases, invalid and hostile input, concurrency, error paths, and regressions in neighbouring behavior. Every failure comes with reproduction steps. It does not fail a change for style or for missing features outside the brief.
- Rewrite `qa` as the test author: it writes tests from the brief and the acceptance criteria only, before any implementation exists, and must not look for or depend on an implementation.
- Give the architect a `qa-tiebreak` skill: read both verdicts, reproduce the disputed findings, decide, and state the reason.
- Update `reviewer` and `security` to end with the `VERDICT` block.
- Rewrite the Director persona for playbooks: choose with `fleet_playbooks`, plan in work items, never try to skip a step, write rework notes that quote the findings, replan when told to, and report halts plainly.

The two judges must differ in substance, not in a paragraph. Each persona explains what its seat is for and why the other seat exists, so neither drifts into doing the other's job.

**Accept:** `make smoke` passes for all fourteen core experts.

## Step 3 — Dashboard

Add: a pipeline view per work item (each step's state, attempts used out of the allowance, the red proof, verdicts side by side with their findings and the SHA they apply to); a resume form for halted missions; flags for changes to shared files.

**Accept:** the views render from API data for a mission produced by the scripted tests.

## Step 4 — Live run

`scripts/e2e-stage2a.sh` on the demo repository: start a `feature` mission through the Director ("add a `/time` endpoint that returns the current server time in ISO 8601, with a test"). Assert, from the mission record and git:

- a recorded red result before the build, with its SHA;
- a green verify;
- a verdict from each of the two judges, from two different containers and sessions, each bound to the landed head SHA;
- a reviewer verdict;
- the commits on `fleet/integration/<missionId>`;
- the repository's tests passing on that branch, run by the verifier.

**Accept:** the script exits 0 with a real key.

## Acceptance checks for this stage

Under `scripts/accept/2a/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` exits 0. |
| `02-engine-tests` | Every test named in step 1 exists and passed. |
| `03-playbooks-valid` | The six playbooks load; a copy with a judge missing its tiebreak is rejected at startup. |
| `04-playbooks-read-only` | The Dispatcher's playbook mount is read-only and no MCP tool or REST route writes to it. |
| `05-smoke-14` | `make smoke` passes for fourteen experts. |
| `06-e2e-feature` | Step 4. Skips only without a provider key. |
| `07-judges-separate` | In the mission from `06`, the two QA verdict tasks have different experts, containers, and session ids, and neither envelope contains the other's findings. |
| `08-register-guards` | Every guard in the defect register with a stage of 2a or earlier exists and passed. |

Red proofs worth the effort: disable `qa-adversarial` during `06` and expect `no-judge`; make the scripted builder ignore the tests so `not-red` fires; raise `attempts` to a value the scripted failures never reach and watch the halt test go red.

A skip of `06` means the stage is not complete.

## Report

Write `docs/reports/stage-2a.md` in the format of shared context 4.4. Then stop.
