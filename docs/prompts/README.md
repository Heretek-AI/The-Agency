# Build prompts for The Agency (edition 2)

These prompts tell OpenCode how to build the system in twelve stages. Each stage is built by one session, then checked by a second, independent session, before the next begins.

Edition 1 is in `v1/`, unchanged, for history. It was never executed. Do not feed it to an agent.

## Why there is a second edition

A different blueprint was built first, by a swarm of parallel agents, into a monorepo (`Heretek-OpenCode/heretek-opencode`). An audit on 2026-10-12 found that it built and tested cleanly and did not work: no agent was ever dispatched, tasks reported success with nothing behind them, and the end-to-end script passed with no server running. The audit is in `../audit/2026-10-12-heretek-opencode-audit.md`.

Edition 2 keeps the original design and changes how it is cut and checked:

| Change | Reason |
|---|---|
| The fleet is built here, in `Heretek-AI/The-Agency`. A few modules are salvaged from the monorepo, which is then archived. | Most of the monorepo was copies of projects that have their own repositories. |
| A Stage 0 for scaffolding, CI, the acceptance harness, and salvage. | Later stages need a harness that can say no. |
| Four stages became eleven smaller prompts. | The first stage was too large to prove in one pass, and its spike was skipped. |
| Verification rules in the shared context, and a separate verification prompt run after every stage. | Checks that could not fail were the root failure. |
| Fail-closed defaults: no checks, no judge, or no credential is an error. | The monorepo passed when nothing was configured. |
| One builder per stage. No agent swarms. | Parallel agents each made their own checks green. |
| Expert packs stay in their own repositories and are added at a pinned commit. | Vendored copies drifted and brought in material this project had excluded. |

## The series

| File | Delivers | Issue |
|---|---|---|
| `00-shared-context.md` | Where the project stands, rules, verification, OpenCode v2 facts, decisions, shared contracts. Every stage prompt includes it. | — |
| `stage-0-migrate-and-salvage.md` | Scaffolding, CI, acceptance harness, defect register, salvaged modules with fixes, a fake OpenCode server | — |
| `stage-1a-spike-and-base-image.md` | Preflight, fifteen spike answers, the base image | #1 |
| `stage-1b-roster-network-egress.md` | `fleet.yaml`, renderer, twelve experts, egress proxy, workspace | #1 |
| `stage-1c-dispatcher-engine.md` | The Dispatcher's engine and the verifier, proven against a fake server and two live runs | #1 |
| `stage-1d-service-director-dashboard.md` | MCP tools, REST, the Director, gateway, dashboard, live end to end | #1 |
| `stage-2a-playbooks-and-qa.md` | Playbook engine, QA judges, bounded rework | #2 |
| `stage-2b-environments.md` | Environment runner, per-task stacks | #2 |
| `stage-3a-registry-and-triggers.md` | Registry, onboarding, REST, webhooks, schedules, GitHub, draft pull requests | #3 |
| `stage-3b-queue-notify-ops.md` | Queue, usage window, notifications, Discord, liveness, backups | #3 |
| `stage-4a-lifecycle-and-extended.md` | On-demand start, eleven extended experts | #4 |
| `stage-4b-expert-packs.md` | Pack contract, validator, intake | #4 |
| `stage-4c-evals-seams-final.md` | Eval suite, Scraper Swarm switch, final pass | #4 |
| `verify-stage.md` | The independent verification pass, run after every stage | — |
| `donor-pack-conversion.md` | Run inside a donor repository to make it an expert pack; includes extracting the GDevelop plugin | — |
| `donor-scraper-swarm.md` | Run inside `scraper-swarm` to bring home the contract client and guard plugin | — |

## Before Stage 0

Commit this directory and `docs/audit/` to `main`. Stage 0 expects a clean tree and every stage branches from `main`.

## The loop for each stage

**1. Build.** From the repository root, on `main`, with a capable model:

```
opencode run --file docs/prompts/00-shared-context.md --file docs/prompts/stage-0-migrate-and-salvage.md \
  "Carry out the attached stage prompt. The shared context is part of it."
```

The session creates its own branch, works through the steps, writes `docs/reports/<stage>.md`, and stops.

**2. Verify.** In a fresh session, on that branch. Use a different model from the builder if you can; Claude Code works well here.

```
opencode run --file docs/prompts/00-shared-context.md --file docs/prompts/verify-stage.md \
  "Verify stage 0."
```

It changes no code. It writes `docs/reports/<stage>-verification.md` ending in `VERDICT: PASS` or `VERDICT: FAIL`.

**3. Decide.** Read both reports, using the checklist below.

- On PASS, and if you agree: merge the stage branch into `main`. Push if you want to. The next stage branches from `main`.
- On FAIL: start a new builder session on the same branch with the stage prompt and the verification report attached, and the message "Fix the findings in the verification report. Do not weaken any check." Then verify again.

Do not start a stage whose predecessor has no PASS.

## Reading a stage report

The reports are short on purpose. Before merging, check these yourself:

- **"Not performed" and "Not built" are not empty by accident.** A stage that needed a provider key and did not have one must say so.
- **Every acceptance check has a red proof**, and the sabotage described would really break the thing the check claims.
- **The verifier's sabotage sample all went red.** One check that stayed green under sabotage is enough to stop.
- **The commit subjects describe their diffs.** Run `git log --stat main..HEAD` and read five at random.
- **Skips are the ones the prompt allows.** `make accept STAGE=<id>` exiting 77 is acceptable only then.
- **Run one thing yourself.** `make check && make accept STAGE=<id>` takes minutes and settles most doubts.

## What you need to supply

| Stage | Needed |
|---|---|
| 0 | The `heretek-opencode` checkout at commit `14f297a`, by default at `../Heretek-AI-opencode/rebuild_staging` |
| 1a | `OPENCODE_API_KEY` (OpenCode Go or Zen) in `.env.provider`, a model id for `AGENCY_MODEL`, Docker or Podman with Compose 2.24 or newer |
| 1b to 2a | Nothing new |
| 2b | A host that can run a nested container daemon |
| 3a | A GitHub bot token scoped to the repositories, the allowlist of accounts. Without them the stage is built and tested against a fake server. |
| 3b | A Discord bot token and channel, Discord user ids for the allowlist. Without them, a fake gateway. |
| 4a | Nothing new |
| 4b | Optionally, a donor repository commit that already passes the pack validator |
| 4c | The candidate models to compare, and permission to spend usage on an eval run |

## After Stage 0: retire the monorepo

Stage 0 writes `docs/handoff/heretek-opencode-archive.md` with the README text and commands. Doing it is yours: nothing in these prompts pushes to or archives any repository.

Before you archive it, run the two donor prompts if you want to keep the work they rescue:

- `donor-scraper-swarm.md`, inside `scraper-swarm`: the contract client package and the guard plugin rewritten for OpenCode v2 exist only in the monorepo.
- `donor-pack-conversion.md`, inside `godot-opencode`: the monorepo's Godot pack has changes the donor does not.

## GDevelop

`GDevelop-Unlocked` holds two unrelated things: a modified editor, and an OpenCode plugin that works on stock GDevelop project files. Only the plugin belongs near the fleet. `donor-pack-conversion.md` has a section that extracts it into its own repository, `opencode-gdevelop`, as an expert pack. The editor's patch stack stays in `GDevelop-Unlocked` and never enters this repository; the pack validator in Stage 4b rejects any pack that carries patch files.

## Things to know before starting

- **The model decides how busy the fleet can be.** OpenCode Go allows $12 of usage per 5 hours. A feature mission is at least seven sessions. Stage 4c's eval comparison is how the model should be chosen; until then, prefer a cheaper Go model.
- **There is no spend ceiling.** That is safe on Go, which is flat-rate. With a pay-as-you-go Zen key, set a workspace monthly limit and turn off auto-reload in the Zen console.
- **OpenCode v2 is still labelled beta.** The prompts pin 2.0.26 and keep every OpenCode call in one module.
- **Port 8080 is taken on the development host.** Stage 1a picks a free port for `AGENCY_HTTP_PORT`.
- **Live checks cost usage.** Stages 1a, 1c, 1d, 2a, and 2b each make real model calls in their acceptance runs. They are small, and they are the only proof that the fleet does anything.

Background and reasoning: `../research/01-architecture-analysis.md` (section 3 records the design review), `../research/02-expert-fleet-catalog.md`, and the audit.
