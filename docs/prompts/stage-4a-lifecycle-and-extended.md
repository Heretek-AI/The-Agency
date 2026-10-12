# Stage 4a — On-demand experts and the extended fleet

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** `docs/reports/stage-3b.md` and its verification report exist with a PASS verdict. Read `docs/build-notes.md`. Work on branch `stage-4a-lifecycle`.

## Goal of this stage

Complete the roster to 25 experts without keeping 25 containers in memory: the eleven extended experts exist as stopped containers, start when a task needs them, and stop when idle.

## Not in this stage

Expert packs (Stage 4b). Evals, the Scraper Swarm switch, the final pass (Stage 4c).

## Ask the user

Nothing new.

## Step 1 — Lifecycle proxy

`lifecycle/`: a small service with access to the host's container daemon that exposes exactly three operations, to the Dispatcher only, with a shared secret (`LIFECYCLE_TOKEN`): start, stop, and status of containers labelled as extended fleet experts of this compose project.

- It refuses every other operation and every other container. A core expert, the Dispatcher, the proxy, the verifier, the environment runner, and any unlabelled container are all outside its reach.
- It takes an expert name, validates it against the roster, and maps it to a container itself. It never accepts a container id, an image name, or free-form arguments from the caller.
- Look for an existing socket proxy that can be restricted this far; if none can, write it. Record the choice in `docs/build-notes.md`.
- This is the second service with daemon access, after the environment runner. Document it in `docs/operations.md`, with the exact mount and why it is needed.
- It listens only on the `fleet` network, has limits and hardening, and runs as a non-root user if the daemon socket's group allows it; if it cannot, record why.

Tests for its request validation run under `bun test`: each of the three operations on a labelled extended expert; refusals for a core expert, an unlabelled container, an unknown name, a name with path or shell characters, and any fourth operation.

**Accept:** the tests pass; checks `03` and `04` below.

## Step 2 — On-demand start in the Dispatcher

- The renderer creates extended experts but does not start them (`profiles: ["extended"]`), each labelled for the lifecycle proxy.
- `dispatcher/src/lifecycle.ts`: when a task for a stopped extended expert becomes ready, start the expert, wait for healthy, run the contract assertion against it, then run the task. Stop an extended expert after an idle period (default 15 minutes) with no running or ready tasks for it. Timing comes from the injected clock.
- A start failure, or an expert that never becomes healthy, fails the task with reason `expert-start-failed`, subject to its failure policy. The task never runs against an expert that is not healthy.
- The fleet view shows which experts are running, stopped, or starting.

Tests with a fake lifecycle service under `test/support/`: a ready task starts its expert before the session is created; the expert stops after the idle period and not before; two tasks for the same stopped expert cause one start; a start failure fails the task with the reason; a core expert is never sent to the lifecycle service.

**Accept:** the tests pass.

## Step 3 — Extended experts

Enable the eleven extended experts in `fleet.yaml` and write their Dockerfiles, personas, and skills, to the same standard as Stage 1b step 5: `api`, `sre`, `performance`, `debugger`, `refactor`, `data`, `ml`, `mobile`, `design`, `release`, `compliance`. Follow `docs/research/02-expert-fleet-catalog.md` section 4 for scope and boundaries.

- Add their proposed writes to the onboarding proposal.
- Extend the playbooks only where a role is a gate: `compliance` may be added as an optional verdict step on `dependency-update`, enabled per repository.
- The `mobile` expert is code-only in a Linux container; say so in its persona so it reports `blocked` instead of pretending to run a simulator.
- MCP servers whose requirements are unmet (`grafana`, `sentry`, `huggingface`, `kubernetes`) end up disabled at container start, as the entrypoint already does. Smoke treats disabled as correct and failed as an error.

**Accept:** all eleven images build with pinned versions; every skill named has a `SKILL.md` with a procedure.

## Acceptance checks for this stage

Under `scripts/accept/4a/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` exits 0. |
| `02-lifecycle-tests` | The tests of steps 1 and 2 exist and passed. |
| `03-proxy-refusals-live` | Against the running lifecycle service: stopping a core expert is refused; starting an unlabelled container is refused; a call outside its three operations is refused; a call without the token is refused. After each refusal, confirm the target's state did not change. |
| `04-proxy-not-reachable-by-experts` | From an expert container, the lifecycle service refuses a request without the token, and no daemon socket is reachable. |
| `05-on-demand-live` | A task for a stopped extended expert starts it, runs, and the expert stops after a short idle period configured for the check. Skips only without a provider key. |
| `06-smoke-25` | `make smoke` passes for all 25 experts, starting and stopping the extended ones through the lifecycle proxy. |
| `07-extended-not-running-at-rest` | After `make up` and the idle period, only the fourteen core experts and the fleet services are running. |
| `08-daemon-access-inventory` | Exactly two services in the generated compose file mount a daemon socket or run a daemon: the environment runner and the lifecycle proxy. |

Red proofs worth the effort: remove the label check and watch `03` fail; set the idle period to zero for `05`; mount the socket into an expert for `08`.

## Report

Write `docs/reports/stage-4a.md` in the format of shared context 4.4, including the lifecycle proxy choice and its exact daemon access. Then stop.
