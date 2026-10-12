# Build prompts for The Agency

These prompts tell OpenCode how to build the system in four stages. Each stage is proven before the next begins.

| File | Delivers |
|---|---|
| `00-shared-context.md` | Rules, OpenCode v2 facts, the decisions already made, and the contracts all stages share. Every stage prompt includes it. |
| `stage-1-fleet-core.md` | Twelve experts behind an egress proxy, the Dispatcher with durable missions and the es-fleet task model, the verify gate, the Director, the gateway and dashboard. One machine, one repository, chat only. |
| `stage-2-playbooks-qa-env.md` | Playbooks enforced by the Dispatcher, the test author and two QA judges with bounded rework, and a throwaway environment stack per task. |
| `stage-3-triggers-registry-notify.md` | Several registered repositories with approval-based onboarding, REST, GitHub, and schedule triggers, the priority queue and usage window, draft pull requests, and notifications through the dashboard, GitHub, and Discord. |
| `stage-4-lifecycle-evals-packs.md` | On-demand start of extended experts, the eleven extended experts, the expert-pack contract, the eval suite, and the seams for Scraper Swarm and Epistemic Swarm. |

## Running a stage

From the repository root, with a capable model:

```
opencode run --file docs/prompts/00-shared-context.md --file docs/prompts/stage-1-fleet-core.md \
  "Carry out the attached stage prompt. The shared context is part of it."
```

Read the stage's report before starting the next one. A stage that could not test something says so; decide whether that gap matters before building on it.

## What you need to supply

| Stage | Needed |
|---|---|
| 1 | `OPENCODE_API_KEY` (OpenCode Go or Zen), a model id for `AGENCY_MODEL`, Docker or Podman with Compose 2.24 or newer |
| 2 | A host that can run a nested container daemon |
| 3 | A GitHub bot token scoped to the repositories, a Discord bot token and channel, the allowlist of accounts. Without them the stage is built and tested against fake servers. |
| 4 | The candidate models to compare, and permission to spend usage on an eval run |

## Things to know before starting

- **The model decides how busy the fleet can be.** OpenCode Go allows $12 of usage per 5 hours. A feature mission is at least seven sessions. Stage 4's eval comparison is how the model should be chosen; until then, prefer a cheaper Go model.
- **There is no spend ceiling.** That is safe on Go, which is flat-rate. With a pay-as-you-go Zen key, set a workspace monthly limit and turn off auto-reload in the Zen console.
- **OpenCode v2 is still labelled beta.** The prompts pin 2.0.26 and keep every OpenCode call in one module.

Background and reasoning: `../research/01-architecture-analysis.md` (section 3 records the design review) and `../research/02-expert-fleet-catalog.md`.
