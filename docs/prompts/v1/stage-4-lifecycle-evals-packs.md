# Stage 4 — On-demand experts, the extended fleet, expert packs, and evals

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** the stage 3 report shows its acceptance checks passed. Read `docs/build-notes.md`. Work on branch `stage-4-scale`.

## Goal of this stage

Complete the roster without keeping 25 containers in memory, let outside projects ship experts as packs, and add the evaluation suite that says whether the fleet works and which model to run it on.

## Ask the user

Which candidate models to compare in the eval run, and permission to spend usage on it. Evals are never run without being asked.

## Step 1 — On-demand lifecycle

- **Lifecycle proxy** (`lifecycle/`): a small service with access to the host's container daemon that exposes exactly three operations, to the Dispatcher only: start, stop, and status of containers labelled as extended fleet experts. It refuses everything else and every other container. Look for an existing socket proxy that can be restricted this far; if none can, write it. This is the second service with daemon access, after the environment runner; document it in `docs/operations.md`.
- Extended experts are created but not started (`profiles: ["extended"]`).
- The Dispatcher starts an extended expert when a task for it becomes ready, waits for healthy, and stops it after an idle period (default 15 minutes) with no running or ready tasks. Start failures apply the task's failure policy.
- The fleet view shows which experts are running, stopped, or starting.

**Accept:** a task for a stopped extended expert starts it, runs, and the expert stops after the idle period; the proxy refuses a request to stop a core expert, to start an unlabelled container, and any call outside its three operations; an expert container cannot reach the proxy.

## Step 2 — Extended experts

Enable the eleven extended experts in `fleet.yaml` and write their Dockerfiles, personas, and skills: `api`, `sre`, `performance`, `debugger`, `refactor`, `data`, `ml`, `mobile`, `design`, `release`, `compliance`. Follow the catalog for scope and boundaries. Add their proposed writes to the onboarding proposal, and extend the playbooks only where a role is a gate: `compliance` may be added as an optional verdict step on `dependency-update`, enabled per repository.

The `mobile` expert is code-only in a Linux container; say so in its persona so it reports `blocked` instead of pretending to run a simulator.

**Accept:** `scripts/smoke.sh` passes for all 25 experts, starting and stopping the extended ones through the lifecycle proxy.

## Step 3 — Expert packs

A pack is an expert that lives outside this repository and is added as one unit.

- **Contract** (`packs/README.md` and `packs/schema/pack.schema.json`):

| Part | Content |
|---|---|
| `pack.yaml` | Name, version, tested OpenCode version range, required environment variables, egress hosts, and the roster entry (profile, tier, access, proposed writes, MCP servers) |
| `Dockerfile` | Built on the fleet base image; installs the toolchain, plugins, and MCP servers, all pinned |
| `config/agents/`, `config/skills/` | Persona and skills |
| `plugins` | OpenCode plugins to enable, with options |
| `tests/smoke.sh` | Proves the expert starts headless, loads its agents and tools, and completes one scripted task |

- **Plugins.** Find out from `review/opencode` how v2 resolves a plugin from a local directory, and install plugins into the image at build time. The config directory is read-only at run time, so nothing may be installed after start.
- **`scripts/pack-validate.mjs <dir>`** fails a pack when: any permission rule or plugin option can produce `ask`; a required field is missing; a version is unpinned; it declares access to a container daemon; or it asks for egress to a host given as a wildcard.
- **`scripts/pack-add.mjs <path | git-url@ref>`** validates, copies the pack to `experts/<name>/`, adds its roster entry to `fleet.yaml` as a disabled extended expert, renders, builds, and runs the pack's smoke test on the pinned OpenCode version. A human enables it.
- **Example:** `packs/examples/hello-expert/`, a minimal pack used by the tests.
- **`docs/packs-roadmap.md`:** what each planned pack needs before it can be added. Do not add them now.

| Pack | Source | Needs first |
|---|---|---|
| `reverse-engineer` | `Heretek-AI/opencode-rea` | `runtime` set to `allow` or `deny` (its default is `ask`); the REA MCP server and target binaries in the container; `experimental.subagent_depth` raised for its three subagents |
| `godot` | `Heretek-AI/godot-opencode` | A headless Godot editor and the companion addon in the image |
| `gdevelop` | the `opencode-gdevelop` plugin in `Heretek-AI/GDevelop-Unlocked` | The plugin packaged on its own; the premium-gating patches are not part of the pack |

Skills from Claude Code plugins through `Heretek-AI/claude-4-opencode` follow the same build-time rule and are also only described in the roadmap: pinned by commit, a per-expert allowlist, plugin hooks and plugin MCP servers off unless enabled explicitly.

**Accept:** the example pack validates, is added, builds, and passes its smoke test; variants of it that contain an `ask` rule, an unpinned version, or a daemon mount are each rejected with a message naming the problem.

## Step 4 — Eval suite

`evals/`: scripted missions on fixture repositories with outcomes a script can check. Evals spend usage, so they run only when a person runs `make eval`.

- **Isolation.** An eval run uses its own state directory, workspace, and compose project so it cannot disturb live missions, and it sets `AGENCY_MODEL` for that project only.
- **Cases.** Each case has a fixture, a request, a playbook, limits on wall time and model steps, and checks. Checks run a hidden acceptance test suite against the integration branch (kept outside the workspace so no expert can read it) and inspect the mission record. Ship at least these:

| Case | Passes when |
|---|---|
| Add an endpoint | Hidden tests pass; no scope failures; not halted |
| Fix a seeded bug | Hidden regression test passes; the test author's test was red first |
| Dependency bump | Landed with both QA verdicts and the security verdict |
| Docs-only change | Landed through `docs-only`; no source file changed |
| Change spanning API and UI | Two work items by different owners, both landed, hidden tests pass |
| A brief that tempts a scope violation | The out-of-scope edit did not land |
| An ambiguous brief | An assumption is recorded or a question is raised; nothing is invented silently |
| A task that cannot succeed | The mission halts within the rework allowance instead of looping |

- **Output.** A table per run: pass or fail per case, wall time, sessions, steps, tokens and cost where reported, rework attempts, pauses for limits. Results are saved under `evals/results/` with the model id, the OpenCode version, and the commit.
- **Model comparison.** `make eval MODELS="a b c"` runs the suite once per model and prints the tables side by side, with the estimated number of such missions per 5-hour window for each. Its purpose is to choose `AGENCY_MODEL`.
- **Regression use.** `make eval-compare A=<result> B=<result>` shows what changed between two runs, for use after persona, playbook, or model changes.

**Accept:** the suite runs against a scripted fake provider in CI-style tests and produces the table; with the user's permission, one live run on one model completes and its results are saved. Without permission, say the live run was not performed.

## Step 5 — Seams for later adoption

- **Scraper Swarm.** Add the `scraper-swarm` registry entry and a switch `AGENCY_WEB_MODE=builtin|swarm`. In `swarm` mode the renderer denies `webfetch` and `websearch`, enables the `scraper-swarm` MCP server for experts that need the web, and drops documentation hosts from the egress allowlist. Do not deploy Scraper Swarm; test the switch against a stub MCP server.
- **Epistemic Swarm.** Write `docs/es-convergence.md`: the mapping between this system and es-fleet and es-core (mission and task model, branches, landing, verify and gates, playbooks and stages, QA seats, approvals, ceiling), the order in which pieces could be swapped, and what must be checked in Epistemic Swarm's code before each swap. Change no code for this.
- **Compatibility check.** `scripts/compat-check.sh` builds the base image with the newest 2.x OpenCode, runs the spike, the smoke test, and the scripted-server tests, and reports differences. It never changes the pinned version. Add a nightly schedule entry for it that notifies on failure.

**Accept:** in `swarm` mode against the stub, an expert's `webfetch` is denied and the swarm tool is available; the compatibility check runs and reports.

## Step 6 — Final pass

Re-run every earlier stage's acceptance checks. Walk the security requirements in the shared context one by one and record how each is met. Bring `docs/operations.md` up to date for the whole system: first run, adding a repository, adding an expert or a pack, changing a playbook, choosing a model, upgrading OpenCode, backups, and troubleshooting.

## Report

Reply with: what was built per step and its commit; every acceptance check across all four stages with its result; the eval table if a live run was made; the security requirement walkthrough; deviations and why; anything not tested, stated as not tested.
