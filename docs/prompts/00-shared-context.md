# The Agency — shared context for all build stages (edition 2)

This file is part of every stage prompt in this directory. Read it fully before starting a stage. It holds what does not change between stages: where the project stands, the rules you work under, how work is verified, the facts about OpenCode v2, the decisions already made, and the contracts every component shares.

You are working in the repository root of **The Agency** (`https://github.com/Heretek-AI/The-Agency`).

Edition 1 of these prompts is kept unchanged in `docs/prompts/v1/` for history. Do not follow it. Where edition 1 and this file differ, this file holds.

## 1. What is being built

An always-on, containerized fleet of specialized OpenCode **v2** instances. Each instance is a domain expert with its own persona, permissions, MCP servers, skills, and toolchain image. A **Director** instance leads each mission. A **Dispatcher** service owns everything deterministic: missions, playbooks, scheduling, worktrees, verification, landing, triggers, and notifications.

The finished system does this:

1. A mission starts from the Director's chat, a REST call, a GitHub issue or PR comment, or a schedule, against one of several registered repositories.
2. The Director picks a playbook and submits a plan. Larger plans and all GitHub-triggered plans wait for a human to approve.
3. The Dispatcher runs the playbook: experts work in per-task git worktrees with a throwaway environment stack; a test author writes the tests; a non-LLM verify step runs the repository's declared checks; two independent QA judges, a reviewer, and where relevant a security expert give verdicts.
4. Work that passes lands on the mission's integration branch, is verified again there, and is pushed as a draft pull request by a bot identity. A human merges.
5. People follow and steer through a dashboard, GitHub comments, and Discord.

The build is split into twelve stage prompts. Each must pass its acceptance checks and an independent verification pass (`verify-stage.md`) before the next begins.

| Prompt | Delivers | Issue |
|---|---|---|
| `stage-0-migrate-and-salvage.md` | Repository scaffolding, CI, the acceptance harness, salvaged modules with the audit's fixes, a fake OpenCode server | — |
| `stage-1a-spike-and-base-image.md` | Preflight, the spike answers, the base image | #1 |
| `stage-1b-roster-network-egress.md` | `fleet.yaml`, the renderer, twelve experts, the egress proxy, the workspace and a minimal registry | #1 |
| `stage-1c-dispatcher-engine.md` | The Dispatcher's deterministic engine and the verifier, proven against a fake OpenCode server | #1 |
| `stage-1d-service-director-dashboard.md` | MCP tools, REST, the Director, gateway, dashboard, live acceptance | #1 |
| `stage-2a-playbooks-and-qa.md` | Playbook engine, QA seats, bounded rework | #2 |
| `stage-2b-environments.md` | Environment runner and per-task stacks | #2 |
| `stage-3a-registry-and-triggers.md` | Repository registry, onboarding, triggers, draft pull requests | #3 |
| `stage-3b-queue-notify-ops.md` | Queue, usage window, notifications, audit, operations | #3 |
| `stage-4a-lifecycle-and-extended.md` | On-demand start, eleven extended experts | #4 |
| `stage-4b-expert-packs.md` | Pack contract, validator, intake tooling | #4 |
| `stage-4c-evals-seams-final.md` | Eval suite, seams, final pass | #4 |

## 2. Where the project stands

### 2.1 How we got here

1. Edition 1 of these prompts was written and never executed.
2. A second document, an ecosystem blueprint, specified a different fleet and a federation of repositories. A swarm of parallel agents built from it and collapsed the result into one monorepo, `Heretek-OpenCode/heretek-opencode`.
3. An audit on 2026-10-12 compared that monorepo with this design. It is in `docs/audit/2026-10-12-heretek-opencode-audit.md`. Read its sections 1, 2.3 to 2.6, and 6 before Stage 0.
4. Its main findings: the Dispatcher never called OpenCode; tasks reported `done` with no checks and no merge; the end-to-end scripts passed with no server running; the sandbox lanes exposed the host; most of the code was copies of other projects.
5. The decision: build The Agency here, to this design, and take from the monorepo only the modules listed in 2.3.

The audit matters to you for one reason above all. Its failures were not bad code. They were work reported as finished and verified when it was neither. Section 4 exists to make that impossible to do by accident.

### 2.2 Repositories

| Repository | Role | What you may do with it |
|---|---|---|
| `Heretek-AI/The-Agency` (this one) | The fleet. The only place you write code, except in the two donor prompts. | Everything, on a stage branch. Never push. |
| `Heretek-OpenCode/heretek-opencode` | Salvage source, frozen at commit `14f297a`. Archived by a human after Stage 0. | Read only. Path in `SALVAGE_SRC`. |
| `Heretek-AI/scraper-swarm` | The web gateway. A separate service with its own MCP contract. | Read only, except when running `donor-scraper-swarm.md` inside it. |
| `Heretek-AI/godot-opencode`, `Heretek-AI/opencode-rea` | Future expert packs. | Read only, except when running `donor-pack-conversion.md` inside them. |
| `Heretek-AI/GDevelop-Unlocked` | A modified GDevelop editor, plus an OpenCode plugin that will be extracted into its own repository, `opencode-gdevelop`. | Read only here. Its patch stack never enters this repository in any form. |
| `Heretek-AI/IUMBTEMS` (Epistemic Swarm) | A sibling system. The Agency mirrors its task model so the two can converge later. | Read its docs. Do not import its code. |
| `review/opencode` | Reference clone of OpenCode v2 at 2.0.26 (`4617210822`). | Read only. Never commit it. |

`SALVAGE_SRC` defaults to `../Heretek-AI-opencode/rebuild_staging`. If that path is missing, clone `https://github.com/Heretek-OpenCode/heretek-opencode` into `review/heretek-opencode`, check out `14f297a`, and use that.

### 2.3 Salvage map

Paths in the first column are relative to `$SALVAGE_SRC/packages/`. Nothing is copied unchanged: each file lands with the listed changes and with tests that prove them. Stage 0 does the copying; the stage in the last column is where the module is finished.

| Source | Destination | Required changes | Finished in |
|---|---|---|---|
| `opencode-fleet/src/util/hash.ts` | `dispatcher/src/util/hash.ts` | None beyond lint | 0 |
| `opencode-fleet/src/util/redact.ts` | `dispatcher/src/util/redact.ts` | None beyond lint | 0 |
| `opencode-fleet/src/util/exec.ts` | `dispatcher/src/util/exec.ts` | Spawn in a new process group and kill the group on timeout. Take an explicit environment; never inherit the parent's by default. | 0 |
| `opencode-fleet/src/state/journal.ts` | `dispatcher/src/audit.ts` | Becomes the audit log (9.12). Append with `O_APPEND` and `fsync`; never rewrite the file. One writer, guarded by a lock file. Divergence means tip differs **or** length differs. | 0 |
| `opencode-fleet/src/dag/graph.ts` | `dispatcher/src/graph.ts` | Adapt to the task model in 9.3: `status` not `state`, `waiting-human`, both dependency triggers. | 0, 1c |
| `opencode-fleet/src/lanes/worktree.ts` | `dispatcher/src/worktrees.ts` | A retry checks out the existing task branch; it never resets it. Base new work on the integration branch. Add the allocation register and landing worktrees. | 0, 1c |
| `opencode-fleet/src/gates/runner.ts` | `verifier/src/run-checks.ts` | Remove `DEFAULT_GATES` and the budget gate. An empty check list is an error. Full logs go to the artifacts directory. | 0, 1c |
| `opencode-fleet/src/judges/reports.ts` | `dispatcher/src/protocol.ts` | Rewrite to the JSON blocks in 9.8. Keep the consistency rules (a pass with a blocker is invalid). One schema, used everywhere. | 0, 2a |
| `opencode-sdk/src/host/client.ts` | `dispatcher/src/opencode.ts` | Extend to the full operation list in Stage 1c. This becomes the only module that knows the OpenCode API. | 0, 1c |
| `opencode-sdk/test/host-live.test.ts` | `dispatcher/test/live/opencode.live.test.ts` | A missing binary is a skip with exit 77, reported as a skip, never a pass. | 0 |
| `opencode-sdk/src/testkit/index.ts` | `dispatcher/test/support/` | Keep the temporary git repository helpers. Replace the canned-route mock with the scripted fake server from Stage 0. | 0 |
| `opencode-fleet/src/experts/catalog.ts` | input for `fleet.yaml` | Used once as data. `fleet.yaml` is the source of truth afterwards; the TypeScript catalog is not kept. | 1b |
| `opencode-distro/Dockerfile` | `images/base/Dockerfile` | Add the entrypoint, digest pin, `AGENT_UID`/`AGENT_GID` build arguments, the directories and tools Stage 1a lists. | 1a |
| `opencode-gateway/deploy/smokescreen/Dockerfile` | `egress/` (candidate) | Use only if Stage 1b chooses Smokescreen. It needs an ACL; as salvaged it has none. | 1b |
| `opencode-homelab/scripts/studio` (`init`) | `scripts/init-env.sh` | Generate every password and token; mode `0600`; never overwrite. | 1b |
| `opencode-homelab/src/autonomy.ts` | `dispatcher/src/autonomy.ts` | Wire it to plan approval. | 3b |

Not salvaged, and not to be recreated: `lanes/runner.ts`, `lanes/tiers.ts`, `dispatcher/service.ts`, `cli/main.ts`, `host/adapter.ts`, `pipeline/*`, `director/session.ts`, `scheduler/runner.ts` (rewrite the scheduler from 9.3), the homelab compose file, `test-live-e2e.ts`, `test-e2e-mission.ts`, the TypeScript gateway application, and every pack.

All salvaged code is Heretek-AI's own and is relicensed here under Apache-2.0. Record each salvaged file with its source commit in `docs/build-notes.md`.

## 3. Operating rules

- **Work in the order the stage gives, and prove each step.** Run the acceptance checks and fix failures before moving on. Do not write everything first and debug afterwards.
- **One builder, one stage, one branch.** A stage prompt is carried out by a single session on its own branch (`stage-0-salvage`, `stage-1a-spike`, and so on). Do not start coordinator or sub-orchestrator agents, and do not create worktrees of this repository for parallel builders. You may use a read-only exploration subagent to search code.
- **Branch from `main`.** A person merges each stage into `main` after its verification passes. If `main` does not contain the previous stage's report and a verification report with a PASS verdict, stop and tell the user. If you were started to fix findings from a failed verification, stay on the existing stage branch.
- **Stay inside the stage.** Each prompt has a "Not in this stage" list. Build the seams it names and nothing behind them.
- **Verify; do not assume.** Your training data mostly describes OpenCode v1. v2 is different (section 5). When you need a fact about OpenCode, read the source file cited here in `review/opencode`. If this document and the source disagree, the source wins; record the discrepancy in `docs/build-notes.md` under "Proposed corrections" and adapt.
- **Never weaken a check to make it pass.** If a check, a test, or a rule in this file is wrong, say so in the report and in build notes, fix it openly, and keep it able to fail.
- **Touch no other repository.** `SALVAGE_SRC`, the donors, and `review/` are read-only. Never push, tag, archive, or open a pull request anywhere. Commit locally with conventional commit messages.
- **Commit messages describe the diff.** State what the commit contains. Do not write "live", "verified", or "complete" in a subject line unless that is literally true of this commit.
- **Never write secrets to tracked files.** Secrets live in `.env`, `.env.provider`, `secrets/`, and `state/`, all ignored.
- **Pin every version** you install and record it in `versions.env`. No `latest`, no floating major tags, base images by digest.
- **Check each third-party package or endpoint exists before depending on it.** If one cannot be verified, leave it out or disabled, say so in `docs/build-notes.md`, and continue.
- **Stop and ask the user** only for what a stage lists under "Ask the user". Optional integrations ship disabled and must not block you.
- **Stop at the end of the stage.** Write the report (4.4) and stop. Do not begin the next stage.

## 4. Verification rules

These rules carry the same weight as the functional requirements. A stage that meets every functional requirement and breaks one of these has not passed.

### 4.1 Rules

1. **A check that cannot fail is not a check.** Every acceptance check has a recorded run in which you broke the condition on purpose and the check went red (4.3).
2. **Nothing tolerates the failure it is there to detect.** A check script, a test, or a harness does not catch an error from the thing under test and continue. No `|| true`, no catch-and-warn, no fallback value, no retry-until-quiet around the behaviour being verified.
3. **Assert on what the system produced.** A test never writes the artifact it then checks. If the claim is "the expert created a file", the file must come from the expert's session.
4. **A skip is not a pass.** When a check needs something absent (a provider key, a GitHub token), it exits 77 with the reason, the summary counts it as skipped, and the report lists it under "Not performed". Skips are allowed only where the stage prompt says so.
5. **No placeholder successes.** Code that is not implemented throws or returns an error naming what is missing. It never returns invented data, a constant "ready", or a default "pass".
6. **Names match behaviour.** A file called `live`, `e2e`, or `smoke` exercises the real thing. A fake belongs under `test/support/` or `test/fakes/` and has "fake" in its name.
7. **Everything is under the tools.** Every source file is covered by typecheck and lint. `make check` runs format, lint, typecheck, a coverage check that fails when a TypeScript file is outside the typecheck, render-check, and unit tests. CI runs `make check` on every push.
8. **Reports quote evidence.** A claim that a check passed is followed by the command and its trimmed output, or a path under `docs/evidence/`.
9. **Unused code is not progress.** A module that nothing imports, outside its own test, is reported as "not wired" and does not count toward any acceptance check.

### 4.2 Fail-closed defaults

Build these in from the first line; the audit found each one failing open.

| Situation | Required behaviour |
|---|---|
| A repository's check list is empty or missing | Verify fails with reason `no-checks`. Nothing lands. |
| A step needs a judge and no judge can run | The step fails with reason `no-judge`. |
| The provider key, a password, or a token is empty | The service refuses to start and names the variable. |
| An expert, the verifier, or the proxy is unreachable | The task fails with reason `unreachable`, subject to its failure policy. |
| A task ends with no parseable `RESULT` or `VERDICT` after one follow-up | The task fails with reason `no-block`. |
| A task or mission is marked `done` | Requires the evidence in 4.5. A code change is `done` only with a landed commit SHA. |
| A command is run on behalf of a task | Only inside the verifier, an environment stack, or an expert container. Never in the Dispatcher's own process environment. |
| A timeout fires | The whole process group, or the named container, is killed and confirmed gone. |
| A permission request reaches the Dispatcher | Rejected. No rule may resolve to `ask`. |

### 4.3 Acceptance harness and exit codes

Stage 0 builds this; every later stage uses it.

- Each acceptance check is one script: `scripts/accept/<stage>/<nn>-<name>.sh`. It prints one line, `CHECK <stage>/<nn>-<name>: PASS`, `FAIL <reason>`, or `SKIP <reason>`, and exits **0**, **1**, or **77**.
- `scripts/accept.sh <stage>` runs them in order, prints a table, and writes the full output to `docs/evidence/<stage>/accept-<UTC timestamp>.log`. It exits 1 if any check failed, 77 if none failed and at least one skipped, 0 only if all passed.
- `make accept STAGE=<stage>` calls it.
- **Red proof.** For each check, record one run where you sabotaged the condition and the check exited 1: `docs/evidence/<stage>/red/<nn>-<name>.log`. The first line of the file says what you broke ("Sabotage: stopped the egress container"). Restore afterwards and confirm green. Checks that only assert a file exists need no red proof; say which ones in the report.
- Unit tests live beside the code and run with `bun test`. A unit test written for an audit defect is named after it (`defect: retry keeps commits on the task branch`) and is shown failing against the unfixed code before the fix, by commit order or by a log under `docs/evidence/<stage>/red/`.

### 4.4 Evidence and reports

Each stage ends with `docs/reports/<stage>.md`, committed, with exactly these sections:

1. **Built.** Per step: what exists now, and the commit.
2. **Acceptance.** A table: check id, result, evidence path. Paste the final `accept.sh` table.
3. **Red proofs.** Check id and what was sabotaged.
4. **Not performed.** Every skipped check and why. Every "Accept" item you could not run.
5. **Not built.** Anything the stage asked for that does not exist or is not wired.
6. **Deviations.** Each place you departed from the prompt or this file, and why.
7. **Proposed corrections.** Places where the prompts were wrong.
8. **Next.** What the following stage will need from the user.

A report with an empty "Not performed" and "Not built" is acceptable only if both are true.

### 4.5 Definition of done

- A **step** is done when its Accept line holds and its check scripts exist, pass, and have red proofs.
- A **stage** is done when `make check` is green, `make accept STAGE=<stage>` exits 0 (or 77 with only skips the prompt allows), the report is written, and a `verify-stage.md` pass run in a fresh session has returned `VERDICT: PASS`. You do not run that pass yourself.
- A **task** in the running system is done when its `RESULT` or `VERDICT` block parsed, its policy check passed, and, for a `land` task, `landedSha` is set and reachable from the integration branch.
- A **mission** is done when every task is `done` or `cancelled`, every work item that changed code has a `landedSha`, and the last verify on the integration branch is green.

### 4.6 Patterns that fail a stage

The verification pass searches for these. Finding one fails the stage regardless of test results.

- A check or test that passes with the service stopped.
- A hard-coded outcome where a computed one is expected (a constant verdict, a constant "ready", an always-true gate).
- An error caught and downgraded around the behaviour under test.
- Fabricated output returned as success.
- A default that passes when configuration is absent.
- A source file outside typecheck or lint; a CI workflow that omits `make check`.
- A report or commit subject claiming something the tree does not contain.
- A task command executed on the host or in the Dispatcher container.
- A container started without a name, without limits, or left running after its task.

## 5. Ground truth about OpenCode v2

The audited version is **2.0.26** (commit `4617210822`), cloned at `review/opencode`. Use it unless the Stage 1a spike passes on a newer 2.0.x. v2 is labelled beta upstream and its server API may change, so every OpenCode call lives in one Dispatcher module.

### 5.1 v1 habits that are wrong in v2

| Topic | v1 (do not use) | v2 (use this) | Source in `review/opencode` |
|---|---|---|---|
| Start a server | `opencode web`, v1 routes | `opencode serve --hostname 0.0.0.0 --port 4096` serves the API under `/api/*`, the spec at `/openapi.json`, the web app at `/` | `packages/cli/src/commands/commands.ts`, `packages/cli/src/server-process.ts` |
| Attach a client | `opencode attach`, `run --attach` | `opencode run --server <url>`, `opencode api ...` | same |
| HTTP routes | `/session/:id/message`, `/global/health`, `/event` | `POST /api/session`, `POST /api/session/{id}/prompt`, `GET /api/info`, `GET /api/event` | `packages/protocol/openapi.json`, `V2_HTTP_API_AUDIT.md` |
| SDK | `@opencode-ai/sdk` | `@opencode/client` (`OpenCode.make({ baseUrl, headers })`), or the salvaged `fetch` client | `packages/client`, `packages/cli/src/services/server-connection.ts` |
| Auth | varies | HTTP Basic, user `opencode`, password from `OPENCODE_PASSWORD` | `packages/server/src/middleware/authorization.ts` |
| Config keys | `agent`, `permission`, `provider`, `plugin`, `command`, flat `mcp.<name>` | `agents`, `permissions`, `providers`, `plugins`, `commands`, `mcp.servers.<name>` | `packages/schema/src/config.ts`, `packages/schema/src/config/*.ts` |
| Agent prompt field | `prompt` | `system`, or the markdown body of the agent file | `packages/schema/src/config/agent.ts` |
| Permissions | `{ "bash": { "git push *": "ask" } }` | ordered array of `{ action, resource, effect }`; last match wins; unmatched means `ask` | `packages/schema/src/permission.ts`, `packages/core/src/permission.ts` |
| Tool and action names | `bash`, `task` | `shell`, `subagent`; `write` and `patch` are checked as `edit` | `packages/core/src/tool/plugin/*.ts` |
| MCP toggle | `"enabled": true` | `"disabled": false`; timeouts are `{ startup, catalog, execution }` in ms | `packages/schema/src/mcp.ts` |

The docs under `review/opencode/packages/web/src/content/docs` are mostly v1-era. Do not rely on them for the server, CLI, or config.

### 5.2 Facts the design depends on

- **Sessions.** `POST /api/session` accepts `{ id?, title?, agent?, model?, location: { directory }, metadata?, permissions? }`. `POST /api/session/{id}/prompt` accepts `{ text, delivery?: "steer" | "queue", ... }` and returns at once; the model runs asynchronously. `POST /api/experimental/session/{id}/wait` returns 204 when the session is idle. `GET /api/session/{id}/message` returns the transcript. `GET /api/session/{id}/diff` returns `[{ file, patch, additions, deletions, status }]`. `POST /api/session/{id}/interrupt` cancels. `PUT /api/session/{id}/environment` replaces the environment variables the session's processes see. JSON responses are wrapped as `{ "data": ... }`.
- **Events.** `GET /api/event` is one SSE stream per server carrying every session's events.
- **Permissions over HTTP.** `GET /api/session/{id}/permission` lists pending requests; `POST /api/session/{id}/permission/{requestID}/reply` takes `{ decision: "once" | "always" | "reject", message? }`.
- **Permission resources.** `read` and `edit` match the file path, relative to the session's `location.directory` for files inside it and absolute for files outside. `shell` matches the command text. `subagent` matches the agent id. `skill` matches the skill id. `external_directory` matches `<absolute dir>/*`. MCP tools are checked as action `<server>_<tool>` with resource `*`. In patterns `*` matches any characters, including `/` (`packages/core/src/util/wildcard.ts`).
- **Config loading.** The global config directory is `OPENCODE_CONFIG_DIR` if set. From it OpenCode loads `opencode.json` or `opencode.jsonc`, `AGENTS.md`, `agents/**/*.md`, and `skills/**/SKILL.md`. Project sources rank above global and are switched off by `OPENCODE_DISABLE_PROJECT_CONFIG=1`. Config text supports `{env:VAR}` and `{file:path}`. Config is hot-reloaded.
- **Agent and skill files.** `agents/<id>.md` has YAML frontmatter (`description`, `mode`, `model`, `steps`, `color`, `hidden`, `permissions`) and the system prompt as its body (`packages/core/src/config/plugin/agent.ts`). Skills are `SKILL.md` with `name` and `description` frontmatter; see `review/opencode/.opencode/skills/sample-skill/SKILL.md`.
- **Code Mode.** MCP servers default to `codemode: true`: the model sees a compact catalog and calls tools through one `execute` tool. Keep that default for expert MCP servers.
- **Provider.** The `opencode` (Zen) provider reads `OPENCODE_API_KEY` (`packages/core/src/plugin/provider/opencode.ts`), and `opencode-go` lists the same variable. Model ids are `opencode/<model-id>` for Zen and `opencode-go/<model-id>` for Go.
- **Install.** `curl -fsSL https://opencode.ai/v2/install | bash -s -- --version <v>` installs to `$HOME/.opencode/bin` and picks the glibc or musl build. The official image `ghcr.io/anomalyco/opencode:<v>` is Alpine with a musl binary that does not run on glibc.
- **State.** Data is in `~/.local/share/opencode` (SQLite database, logs), state in `~/.local/state/opencode`.

### 5.3 Verified on the development host (2026-10-12)

These were observed during the audit. Treat them as starting facts and re-confirm the ones your stage depends on.

- `GET /api/health` does not exist: 401 without credentials, 404 with them. `GET /api/info` with Basic auth returns 200 and is the readiness probe.
- `POST /api/session/{id}/steer` does not exist. Steering is the `delivery` field of `prompt`.
- `opencode serve` started without `OPENCODE_PASSWORD` invents a password and prints it. Every `/api/*` call then returns 401 to a client that does not have it. The entrypoint must refuse to start instead.
- The salvaged client completed create, prompt, wait (204), diff, messages, and delete against OpenCode 2.0.27, and `/api/info` against a 2.0.26 container.
- The salvaged base image runs as `agent` (uid 1000) with OpenCode 2.0.26 and Bun 1.4.2.
- The host is Fedora with SELinux enforcing. A bind mount without `:z` is unreadable and unwritable inside a container.
- Docker 29.9.0 with Compose 5.6.0 is installed; Podman is also present.
- Killing a `docker run` client does not stop its container. Always give a container a name and stop it by name.
- Port 8080 on the host is already in use by another stack. The gateway port is `AGENCY_HTTP_PORT`; Stage 1a picks a free one.
- `bwrap --ro-bind / /` exposes the host home directory, environment, and network. Do not use bubblewrap for isolation in this project.

## 6. Decisions already made

These came out of the design review and the audit and are not open for you to revisit. If one turns out to be impossible, stop and tell the user.

| Area | Decision |
|---|---|
| Positioning | Standalone system in this repository. The Dispatcher mirrors the task model, states, failure policies, and branch names of es-fleet (`Heretek-AI/IUMBTEMS`, `docs/FLEET.md`) so the two can converge later. Do not import its code. License: Apache-2.0. |
| Service shape | Always-on. Several registered repositories; a mission targets exactly one. Nothing listens on a public address; GitHub is polled. |
| Triggers | Director chat, REST API and signed webhooks, GitHub issues and PR comments, schedules. |
| Workflows | Declarative playbooks enforced by the Dispatcher. The Director chooses one and writes briefs; it cannot skip a gate. |
| Missions | Durable records with a plan, a task graph, a decision log, and their own integration branch. The Dispatcher wakes the Director when tasks finish. |
| Merge gate | A non-LLM verify step runs the repository's declared checks on the task branch before landing and on the integration branch after each merge. Red blocks. No checks declared also blocks. |
| QA | A test author plus two independent judges (functional, adversarial) in separate containers on every code change; the architect breaks ties. Rework is capped: three attempts, one replan, two more attempts, then the mission halts for a human. |
| Test environment | A throwaway compose stack per task, started by an environment runner with its own nested container daemon. Only the Dispatcher calls the runner. |
| Isolation | One container per expert. The boundaries are mounts, the absence of credentials, the egress proxy, and the Dispatcher's diff check. No per-command sandbox "lanes", no bubblewrap. |
| Write scope | An ownership map per repository, proposed by the scout and approved by a human. Hard block for read-only experts and for another expert's paths; shared files (manifests, lockfiles) are allowed and flagged. |
| Control files | Ownership map, checks, environment definition, secrets, and trigger settings live in a fleet-side registry that no expert can read or write. |
| Humans | Plan approval for missions above a configurable task count and for every GitHub-triggered mission. Auto draft PR when gates are green; merging is human-only. An explicit allowlist of accounts may trigger or approve. Channels: dashboard, GitHub comments, Discord (behind a generic signed webhook). |
| Models and keys | One model for every expert (`AGENCY_MODEL`) and one key (`OPENCODE_API_KEY`), both from the environment. No LLM gateway. No spend ceiling. When a provider usage limit is hit, missions pause and resume when it resets. |
| Queue | Priority order chat, GitHub, API, schedules; a cap on concurrent missions; scheduled missions start only when the usage window has headroom. |
| Egress | Experts have no direct route out. An allowlist proxy is the only exit and logs each request with the expert's name. Scraper Swarm replaces built-in web tools later, behind a switch. |
| Roster | 25 experts. 14 core stay running; 11 extended start on demand. |
| Evaluation | A small suite of scripted missions on fixture repositories, also used to compare candidate models. |
| Extensibility | An expert-pack contract. Packs live in their own repositories and are added at a pinned commit. Nothing from a donor project is vendored here. |
| Runtime | Bun (pinned) runs the Dispatcher, verifier, environment runner, lifecycle proxy, adapters, scripts, and tests. State is SQLite through `bun:sqlite`. Expert images keep Node for MCP servers. If spike question 14 fails, the fallback is Node 24 LTS with the same code. |
| State and audit | SQLite is the state store. A hash-chained JSONL audit log (9.12) records every transition from Stage 1. It is tamper-evident, not tamper-proof; describe it that way. |
| Protocol blocks | `RESULT` and `VERDICT` carry JSON, validated by one schema (9.8). |
| Build process | One builder session per stage; an independent verification pass after each; reports and evidence committed. |
| GDevelop | Only the extracted `opencode-gdevelop` plugin may become a pack. The editor patch stack, launcher hook, and unlock code stay out of this repository and out of every image it builds. |

## 7. Target architecture

```
 triggers                          humans
 chat · REST/webhook               dashboard · GitHub comments · Discord
 GitHub poller · scheduler              ▲
        │                               │
        ▼                               │
 ┌──────────────────────────────────────┴───────────┐      ┌──────────────┐
 │ dispatcher                                       │─────►│ registry     │
 │ missions · playbooks · scheduler · landing       │      │ (state/)     │
 │ MCP for the Director · REST · dashboard          │      └──────────────┘
 └───┬───────────────┬───────────────────┬──────────┘
     │ v2 HTTP + SSE │                   │
     ▼               ▼                   ▼
 ┌──────────┐  ┌───────────────┐   ┌───────────────────┐   ┌──────────┐
 │ director │  │ experts × 24  │◄─►│ environment runner│   │ verifier │
 └────┬─────┘  └──────┬────────┘   └───────────────────┘   └────┬─────┘
      └──── internal network `fleet`, no route out ─────────────┤
                                                 ┌──────────────▼┐
   gateway (Caddy, 127.0.0.1) ── browser         │ egress proxy  │
                                                 └───────────────┘
```

Fixed design points:

- **Hub and spoke.** Only the Director has the `fleet` MCP server. Experts never dispatch to each other; they name the expert they need in their report.
- **One worktree and one fresh session per task.** Experts commit but never push, merge, or switch branches.
- **Two access classes.** `ro` experts mount the workspace read-only and write only under `/artifacts/<taskId>/`. `scoped` experts mount it read-write and may edit only the paths the task grants.
- **`fleet.yaml` is the source of truth for the roster.** A render script generates each expert's `opencode.jsonc`, the compose file, and the Dispatcher's roster from it.
- **Each expert has its own server password.** The Dispatcher knows all of them; an expert knows only its own.
- **The Dispatcher is the only caller** of the verifier, the environment runner, and the lifecycle proxy.

## 8. Repository layout (final)

```
.
├── LICENSE                          # Apache-2.0
├── Makefile
├── package.json, bun.lock, tsconfig.json, .oxlintrc.json
├── fleet.yaml                       # roster manifest (source of truth)
├── versions.env
├── .env.example
├── docker-compose.yml               # GENERATED
├── images/base/                     # shared expert base image, entrypoint.sh
├── mcp/registry.jsonc               # MCP server definitions by key
├── shared/
│   ├── FLEET_PROTOCOL.md            # becomes every expert's AGENTS.md
│   └── templates/
├── experts/<name>/
│   ├── Dockerfile
│   └── config/                      # mounted read-only at /etc/agency
│       ├── opencode.jsonc           # GENERATED
│       ├── AGENTS.md                # GENERATED
│       ├── mcp-requirements.json    # GENERATED
│       ├── agents/<name>.md
│       └── skills/<skill>/SKILL.md
├── playbooks/*.yaml                 # stage 2a
├── dispatcher/                      # src/, web/, test/ (test/support, test/live)
├── verifier/                        # stage 1c
├── envrunner/                       # stage 2b
├── lifecycle/                       # stage 4a
├── egress/                          # proxy config and allowlists
├── gateway/Caddyfile
├── adapters/discord/                # stage 3b
├── evals/                           # stage 4c
├── packs/                           # stage 4b: contract, schema, example, packs.lock.yaml
│   └── installed/                   # ignored: packs fetched at their locked commits
├── scripts/                         # render, accept.sh, accept/<stage>/, init-env, workspace-init
├── fixtures/                        # demo repositories
├── registry.example/                # example control files
├── docs/
│   ├── prompts/                     # this series; v1/ is history
│   ├── research/                    # design background
│   ├── audit/                       # the 2026-10-12 audit and the defect register
│   ├── reports/                     # one per stage, plus verification reports
│   ├── evidence/<stage>/            # accept logs and red proofs
│   ├── handoff/                     # notes for steps only a person may take
│   ├── build-notes.md
│   └── operations.md
├── state/                           # ignored: registry/, dispatcher data, audit/, backups
├── workspace/                       # ignored: <repoId>/repo, <repoId>/trees
├── secrets/                         # ignored
└── review/                          # ignored: reference clones
```

`.gitignore` covers `review/`, `.env`, `.env.*` except `.env.example`, `secrets/`, `state/`, `workspace/`, `packs/installed/`, `node_modules/`, and build output.

## 9. Shared contracts

### 9.1 Workspace paths (inside containers)

```
/work/<repoId>/repo            the clone; its checked-out branch is never used for work
/work/<repoId>/trees/<taskId>  one worktree per task
/work/<repoId>/landing/<id>    throwaway worktrees used only by the Dispatcher for merges
/artifacts/<taskId>/           reports, screenshots, SARIF, logs
```

The workspace is always a clone made by the fleet, never a bind mount of someone's live checkout.

A worktree's `.git` file points into `/work/<repoId>/repo/.git/worktrees/`. Because every container mounts the whole of `/work` at the same path, git works inside experts and the verifier. Do not mount a single worktree directory on its own.

### 9.2 Branches (mirrors es-fleet)

- `fleet/<taskId>`: one branch per task.
- `fleet/integration/<missionId>`: where passed tasks land.
- `refs/fleet-salvage/<taskId>`: anchor created before an abandoned task branch is deleted.
- Merged task branches are kept for the audit trail. The repository's base branch is never checked out, reset, or merged by the fleet.
- A retried or reworked task continues on its existing `fleet/<taskId>` branch. The fleet never force-moves a task branch.

### 9.3 Task and mission model (mirrors es-fleet)

```
Task {
  id, missionId, repo, title,
  kind: "expert-run" | "verify" | "land" | "human",
  role,                       // playbook step, e.g. "build", "test-author", "qa-functional"
  expert?,                    // for expert-run
  deps: taskId[],
  trigger: "all_success" | "one_success",
  input: { objective, context?, constraints?, acceptance[], paths[], base? },
  ceilingUSD: null,           // kept for compatibility with es-fleet; not enforced
  policy: { strategy: "fail" } | { strategy: "retry", maxAttempts } | { strategy: "replan" },
  status: "pending" | "ready" | "running" | "waiting-human" | "done" | "failed" | "cancelled",
  attempts, reason?, result?,
  sessionId?, branch?, worktree?, headSha?, landedSha?
}

Mission {
  id, repo, source: "chat" | "api" | "github" | "schedule", sourceRef?,
  playbook, objective, priority,
  status: "planning" | "waiting-human" | "running" | "paused" | "halted" | "done" | "failed" | "cancelled",
  plan, tasks[], decisions[],  // decisions is append-only
  directorSessionId?, integrationBranch, baseSha, pausedUntil?, createdAt, updatedAt
}
```

Scheduling follows es-fleet's rules:

- A task is `ready` when all its dependencies are `done` (`all_success`) or any is (`one_success`).
- A task that can never run is `cancelled`: under `all_success`, when any dependency is `failed` or `cancelled`; under `one_success`, when all are.
- Starts are ordered by id and bounded by the concurrency caps.
- On failure, `fail` is terminal and cancels dependents; `retry` re-queues the same task while `attempts <= maxAttempts`; `replan` parks the task as `waiting-human`.
- There are no "fix tasks". Rework re-runs the task in its existing session and branch.

Write the scheduler as a pure function of the graph and the caps, with no clock inside. Every status in the list must be reachable and tested.

### 9.4 Landing

Landing a task is one transaction:

1. Run verify in the task worktree. A failure marks the task `failed` with the check's name as the reason and merges nothing. An empty check list fails with `no-checks`.
2. Merge `fleet/<taskId>` into `fleet/integration/<missionId>` with `--no-ff` inside a throwaway worktree, after recording the pre-merge tip. On conflict, abort and report the conflicting files.
3. Run verify on the merged tree. If it fails, reset the integration branch to the recorded tip and fail the landing with the reason.
4. On success, set the task's `landedSha` to the merge commit.

The merge commit message carries these trailers:

```
Agency-Mission: <missionId>
Agency-Task: <taskId>
Agency-Verify: <checkId>=pass ...
Agency-Audit-Tip: <audit log tip hash at the time of the merge>
```

### 9.5 Wildcards

Path patterns everywhere (ownership maps, permission rules, the diff policy check) use OpenCode's dialect: `*` matches any characters including `/`, `?` matches one character. Port `Wildcard.match` from `review/opencode/packages/core/src/util/wildcard.ts` once and use that one function.

### 9.6 Baseline permission ruleset

Every expert's generated config starts with this list. No rule may use `ask`, and the first rule is always deny-all, so nothing can fall through to a prompt.

```jsonc
"permissions": [
  { "action": "*",                  "resource": "*",              "effect": "deny"  },
  { "action": "read",               "resource": "*",              "effect": "allow" },
  { "action": "glob",               "resource": "*",              "effect": "allow" },
  { "action": "grep",               "resource": "*",              "effect": "allow" },
  { "action": "skill",              "resource": "*",              "effect": "allow" },
  { "action": "webfetch",           "resource": "*",              "effect": "allow" },
  { "action": "websearch",          "resource": "*",              "effect": "allow" },
  { "action": "subagent",           "resource": "explore",        "effect": "allow" },
  { "action": "external_directory", "resource": "/work/*",        "effect": "allow" },
  { "action": "external_directory", "resource": "/artifacts/*",   "effect": "allow" },
  { "action": "edit",               "resource": "/artifacts/*",   "effect": "allow" },
  { "action": "read",               "resource": "*.env",          "effect": "deny"  },
  { "action": "read",               "resource": "*.env.*",        "effect": "deny"  },
  { "action": "read",               "resource": "*.env.example",  "effect": "allow" },
  { "action": "shell",              "resource": "*",              "effect": "allow" },
  { "action": "shell",              "resource": "git push*",      "effect": "deny"  },
  { "action": "shell",              "resource": "git merge*",     "effect": "deny"  },
  { "action": "shell",              "resource": "git rebase*",    "effect": "deny"  },
  { "action": "shell",              "resource": "git switch*",    "effect": "deny"  },
  { "action": "shell",              "resource": "git checkout*",  "effect": "deny"  },
  { "action": "shell",              "resource": "git worktree*",  "effect": "deny"  },
  { "action": "shell",              "resource": "git tag*",       "effect": "deny"  }
  // then one allow per MCP server the expert uses: { "action": "<key>_*", "resource": "*", "effect": "allow" }
]
```

`edit` rules for repository paths are **not** in the static config. The Dispatcher passes them per task in the `permissions` field of `POST /api/session`, built from the repository's ownership map. Stage 1a confirms that session rules are evaluated after agent rules; if they are not, fall back to static globs from `fleet.yaml`.

The Director's ruleset replaces `shell *` with allows for `git log*`, `git status*`, `git diff*`, `git show*`, denies `subagent`, and allows `fleet_*`.

Shell deny rules are text matching and guard against accidents only. The audit showed a text guard blocking `curl https://host/x` and allowing `curl host/x`. The boundaries that hold are mounts, the absence of credentials, the egress proxy, and the Dispatcher's diff check.

### 9.7 Task envelope

The text the Dispatcher sends to an expert:

```
# Task <taskId>: <title>
Mission: <missionId>   Role: <role>   Assigned to: <expert>

## Objective
<objective>

## Context
<context>

## Constraints
<constraints>
- Work only inside <worktree> (your current location). Branch: <branch, or "detached, read-only">.
- You may modify only: <granted paths, or "nothing; write findings to the artifacts directory">.
- Write reports, screenshots, and other outputs to /artifacts/<taskId>/.
- Your environment stack, if any: <service URLs and variable names>.
- If AGENTS.md exists at the worktree root, read it first and follow its conventions.

## Acceptance criteria
<numbered list>

## When finished
Commit your work on the current branch (writers only). Do not push, merge, or switch branches.
End your final message with the block your fleet protocol defines.
```

### 9.8 Result and verdict blocks

`shared/FLEET_PROTOCOL.md` becomes every expert's `AGENTS.md`. It must say: you are one specialist in a fleet and your tasks come from a Dispatcher, not from a person; nobody can answer questions, so make a reasonable assumption and record it, or report `blocked`; stay inside your granted paths and your role; verify your work by running it and report the commands and what they actually showed; never push, merge, or change branches; name the expert you need under handoffs instead of doing their job.

Builders and authors end their final message with a heading and one fenced JSON block:

````
## RESULT
```json
{
  "status": "done",
  "summary": "Two to five sentences.",
  "changes": [{ "commit": "<sha>", "files": ["src/health.ts"] }],
  "verification": [{ "command": "pnpm test", "exit": 0, "observed": "42 passed" }],
  "assumptions": [],
  "risks": [],
  "handoffs": [{ "expert": "dba", "request": "Add an index on users.created_at" }],
  "artifacts": ["/artifacts/<taskId>/report.md"],
  "question": null
}
```
````

`status` is one of `done`, `blocked`, `needs-handoff`, `needs-split`. `question` is required when `status` is `blocked`.

Judges (QA judges, reviewer, security, the architect on a tiebreak) end with:

````
## VERDICT
```json
{
  "decision": "fail",
  "findings": [
    { "severity": "blocker", "where": "src/users.ts:41", "what": "Page size is unbounded; ?limit=100000 returns every row." }
  ],
  "evidence": [
    { "command": "hurl tests/pagination.hurl", "exit": 1, "observed": "expected 100 rows, got 100000", "artifact": "/artifacts/<taskId>/pagination.log" }
  ]
}
```
````

`decision` is `pass` or `fail`. `severity` is `blocker`, `major`, or `minor`.

Rules, all in `dispatcher/src/protocol.ts`:

- Find the last `## RESULT` or `## VERDICT` heading in the final message and parse the first fenced JSON block after it. Always keep the raw text.
- A `pass` that contains a `blocker` finding is invalid. A `fail` with no `blocker` or `major` finding is invalid.
- A missing, unparseable, or invalid block gets one automatic follow-up asking for it. A second failure fails the task with reason `no-block`.
- These examples show the shape. Personas and tests should use varied content, not copies of them.

### 9.9 `fleet.yaml`

```yaml
version: 1
defaults:
  port: 4096
  maxConcurrent: 2
  taskTimeoutSec: 3600
  resources: { cpus: 2, memory: 4g }
tiers:                      # all resolve to the one model today
  frontier: "{env:AGENCY_MODEL}"
  standard: "{env:AGENCY_MODEL}"
  fast:     "{env:AGENCY_MODEL}"
  review:   "{env:AGENCY_MODEL}"
experts:
  backend:
    enabled: true
    profile: core           # core (always running) | extended (on demand)
    tier: standard
    access: scoped          # ro | scoped
    description: "Server-side implementation: endpoints, business logic, integrations, unit tests."
    handles:   ["endpoints", "business logic", "integrations", "background jobs", "unit tests"]
    delegates: ["schema and migrations -> dba", "CI and deploy -> platform", "contract files -> api"]
    proposed_writes: ["src/*", "server/*", "api/*", "services/*", "internal/*", "pkg/*", "cmd/*", "lib/*"]
    mcp:       [context7, serena, dbhub]
    skills:    [endpoint-implementation, error-handling-conventions, dependency-addition-policy, test-with-the-change]
    egress:    []           # extra allowlisted hosts for this expert
    browser:   false        # true adds shm_size and more memory
```

`proposed_writes` seeds the ownership map proposal for a new repository. The enforced map is the approved one in the registry. Every name under `skills` must have a `SKILL.md`; the renderer fails otherwise.

### 9.10 Roster

Role prose, boundaries, and skill descriptions are in `docs/research/02-expert-fleet-catalog.md`. Where that file and this table differ on MCP servers or tools, the research catalog holds. Each expert gets two to five skills written as short, concrete procedures.

| Name | Profile | Access | Proposed writes | MCP | Extra image tools |
|---|---|---|---|---|---|
| `director` | core | ro | — | `fleet` | — |
| `scout` | core | ro | — | `context7`, `deepwiki` | `ast-grep`, `scc`, `tree` |
| `architect` | core | scoped | `docs/adr/*`, `docs/architecture/*` | `context7`, `deepwiki` | `scc`, `dependency-cruiser`, `madge` |
| `product` | core | scoped | `docs/product/*`, `docs/requirements/*` | `github`, `linear` | `gh` |
| `frontend` | core | scoped | `web/*`, `apps/web/*`, `src/components/*`, `src/pages/*`, `src/app/*`, `src/styles/*`, `public/*` | `playwright`, `context7`, `figma` | `pnpm`, `bun`, Chromium, `@axe-core/cli` |
| `backend` | core | scoped | `src/*`, `server/*`, `api/*`, `services/*`, `internal/*`, `pkg/*`, `cmd/*`, `lib/*` | `context7`, `serena`, `dbhub` | `pnpm`, `hurl`, `httpie`, `make`, optional `go`, `rust`, JDK |
| `dba` | core | scoped | `migrations/*`, `db/*`, `prisma/*`, `schema/*`, `*.sql` | `postgres`, `dbhub` | `psql`, `pg_dump`, `sqlite3`, `mysql` client, `sqlfluff`, `atlas` |
| `platform` | core | scoped | `Dockerfile*`, `*compose*.yml`, `.github/*`, `.gitlab-ci.yml`, `infra/*`, `deploy/*`, `k8s/*`, `helm/*`, `terraform/*`, `Makefile`, `scripts/*` | `terraform`, `kubernetes`, `github` | `hadolint`, `actionlint`, `shellcheck`, `shfmt`, `yamllint`, `terraform`, `tflint`, `kubectl`, `helm`, `kustomize`, `kubeconform` |
| `security` | core | ro | — | `semgrep`, `trivy` | `semgrep`, `trivy`, `gitleaks`, `osv-scanner`, `syft`, `grype`, `checkov` |
| `qa` | core | scoped | `tests/*`, `test/*`, `e2e/*`, `*.test.*`, `*.spec.*`, `*__tests__*`, `playwright.config.*`, `vitest.config.*`, `jest.config.*` | `playwright` | `pnpm`, Chromium |
| `qa-functional` | core | ro | — | `playwright` | `pnpm`, Chromium, `hurl` |
| `qa-adversarial` | core | ro | — | `playwright` | `pnpm`, Chromium, `hurl` |
| `reviewer` | core | ro | — | none by default (`github` available, disabled) | `delta`, `difftastic`, `scc` |
| `docs` | core | scoped | `docs/guides/*`, `docs/reference/*`, `docs/tutorials/*`, `README*`, `CONTRIBUTING*`, `mkdocs.yml` | `context7` | `markdownlint-cli2`, `vale`, `lychee`, `prettier` |
| `api` | extended | scoped | `openapi/*`, `proto/*`, `graphql/*`, `*.graphql`, `contracts/*` | `context7` | `spectral`, `oasdiff`, `buf`, `schemathesis`, `hurl` |
| `sre` | extended | scoped | `ops/*`, `monitoring/*`, `alerts/*`, `dashboards/*`, `docs/runbooks/*` | `grafana`, `sentry` | `promtool`, `amtool`, `logcli` |
| `performance` | extended | scoped | `bench/*`, `perf/*`, `k6/*` | `chrome-devtools` | `k6`, `hyperfine`, `lighthouse`, `py-spy`, Chromium |
| `debugger` | extended | scoped | `tests/repro/*` | `chrome-devtools`, `sentry` | `gdb`, `strace`, `ltrace` |
| `refactor` | extended | scoped | union of `frontend` and `backend` | `serena` | `ast-grep`, `comby`, `jscodeshift`, `knip`, `ruff` |
| `data` | extended | scoped | `data/*`, `pipelines/*`, `dbt/*`, `analytics/*`, `notebooks/*` | `dbhub` | `duckdb`, `dbt-core`, `sqlfluff` |
| `ml` | extended | scoped | `ml/*`, `models/*`, `evals/*`, `prompts/*` | `huggingface`, `context7` | `promptfoo`, `jupyter` |
| `mobile` | extended | scoped | `mobile/*`, `apps/mobile/*`, `android/*`, `ios/*` | `context7` | Node; Android tools behind a build arg |
| `design` | extended | scoped | `design/*`, `docs/design/*`, `tokens/*` | `playwright`, `figma` | `@axe-core/cli`, `pa11y`, `lighthouse`, Chromium |
| `release` | extended | scoped | `CHANGELOG*`, `release/*`, `.release-please*` | `github` | `gh`, `git-cliff` |
| `compliance` | extended | ro | — | — | `syft`, `trivy`, `reuse` |

The `platform` expert has no container daemon. If its image carries a Docker CLI for linting build files, there is no socket for it to reach.

### 9.11 MCP registry (`mcp/registry.jsonc`)

One entry per server: the v2 server config with `{env:...}` placeholders, plus `requires` (variables that must be non-empty for the server to be enabled). Each launch command below is a starting point to verify and pin.

| Key | Config sketch | Requires |
|---|---|---|
| `fleet` | `{ "type": "remote", "url": "http://dispatcher:8080/mcp", "headers": { "Authorization": "Bearer {env:FLEET_MCP_TOKEN}" }, "oauth": false, "codemode": false, "timeout": { "execution": 900000 } }` | `FLEET_MCP_TOKEN` |
| `context7` | remote `https://mcp.context7.com/mcp`, or local `npx -y @upstash/context7-mcp` | — |
| `deepwiki` | remote `https://mcp.deepwiki.com/mcp` | — |
| `playwright` | local `npx -y @playwright/mcp --headless --isolated --no-sandbox` | — |
| `chrome-devtools` | local `npx -y chrome-devtools-mcp --headless --isolated` | — |
| `serena` | local `uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context ide-assistant` | — |
| `postgres` | local `uvx postgres-mcp --access-mode=restricted`, DSN in `DATABASE_URI` | ships disabled; see the note below |
| `dbhub` | local `npx -y @bytebase/dbhub --transport stdio --readonly --dsn <dsn>` | ships disabled; see the note below |
| `github` | remote `https://api.githubcopilot.com/mcp/` with a bearer token and read-only, minimal-toolset headers | `GITHUB_READ_TOKEN` |
| `semgrep` | local `semgrep mcp` | — |
| `trivy` | local `trivy mcp` (after `trivy plugin install mcp` at build time) | — |
| `terraform` | local `terraform-mcp-server` binary; never set `ENABLE_TF_OPERATIONS` | — |
| `kubernetes` | local `npx -y kubernetes-mcp-server --read-only` | `KUBECONFIG` |
| `grafana` | local `mcp-grafana` binary | `GRAFANA_URL`, `GRAFANA_SERVICE_ACCOUNT_TOKEN` |
| `sentry` | local `npx -y @sentry/mcp-server` | `SENTRY_ACCESS_TOKEN` |
| `huggingface` | remote `https://huggingface.co/mcp` with a token header | `HF_TOKEN` |
| `figma`, `linear` | remote, OAuth | always `"disabled": true` |

Database servers: from Stage 2b a task's database address exists only in that session's environment, while an MCP server process is started from the container's configuration, so it cannot be assumed to see it. `postgres` and `dbhub` therefore ship disabled, and experts use `psql` and similar command-line clients with the session's `DATABASE_URL`. Enable the MCP servers only if a test shows they receive the per-task address.

Rules: install local servers into the image at build time; a server whose requirements are unmet must end up `disabled` at container start; experts have no container daemon, so never launch an MCP server with `docker run`; every remote MCP host an expert uses must be on that expert's egress allowlist. Any token given to an expert's MCP server is read-only. The token that can push or open pull requests is held only by the Dispatcher.

### 9.12 Audit log

`state/audit/audit.jsonl`, one JSON object per line:

```
{ seq, at, actor, event, data, prevHash, hash }
hash = sha256( prevHash + ":" + canonicalJson({ seq, at, actor, event, data }) )
```

- `seq` starts at 1. The first `prevHash` is 64 zeros. `canonicalJson` sorts keys and omits `undefined`.
- `data` passes through the redactor before hashing.
- The Dispatcher is the only writer. It holds a lock file, opens the log with `O_APPEND`, writes one line, and calls `fsync`. It never rewrites or truncates the file.
- On startup the Dispatcher verifies the whole chain and refuses to start if it is broken.
- The tip hash is written into each landing commit's `Agency-Audit-Tip` trailer and, from Stage 3a, into draft pull request bodies. That anchors the chain outside the file: a rewritten log no longer matches the hashes in git history.
- Stage 1 events: `dispatcher.started`, `dispatcher.recovered`, `mission.created`, `plan.submitted`, `plan.approved`, `plan.rejected`, `task.started`, `task.finished`, `permission.rejected`, `policy.result`, `verify.result`, `landing.merged`, `landing.reset`, `decision`, `mission.closed`. Later stages add their own.
- Describe this log as tamper-evident. Anyone who can write the file can build a new consistent chain; the git anchors are what expose that.

### 9.13 Toolchain and commands

- Bun at the version in `versions.env` runs all first-party TypeScript. One root `package.json` with workspaces; one root `tsconfig.json` that includes every first-party `.ts` file.
- `scripts/check-ts-coverage.ts` compares `tsc --listFilesOnly` with `git ls-files '*.ts' '*.tsx'` (excluding `fixtures/`) and fails on any file the typecheck does not see.
- `make check` runs, in order: `format-check` (Prettier, pinned), `lint` (oxlint, pinned, zero errors), `typecheck` (`tsc --noEmit`), `ts-coverage`, `render-check` (from Stage 1b), `test` (`bun test`). It stops at the first failure.
- Other `make` targets: `init`, `render`, `workspace`, `build`, `up`, `down`, `ps`, `logs`, `smoke`, `e2e`, `gc`, `accept STAGE=<id>`.
- Ports: experts listen on 4096 inside the `fleet` network. The Dispatcher listens on 8080 inside it. The gateway publishes `127.0.0.1:${AGENCY_HTTP_PORT}` and nothing else is published.
- Environment variables from Stage 1: `AGENCY_MODEL`, `OPENCODE_API_KEY` (in `.env.provider`), `PW_<NAME>` per expert, `PROXY_PW_<NAME>` per expert, `FLEET_MCP_TOKEN`, `VERIFIER_TOKEN`, `AGENCY_ADMIN_PASSWORD`, `AGENCY_HTTP_PORT`, `AGENT_UID`, `AGENT_GID`, `OPENCODE_VERSION`, `BUN_VERSION`.
- Added by later stages: `ENVRUNNER_TOKEN` (2b), `GITHUB_BOT_TOKEN` and `GITHUB_READ_TOKEN` (3a), `DISCORD_BOT_TOKEN` and `AGENCY_AUTONOMY` (3b), `LIFECYCLE_TOKEN` (4a), `AGENCY_WEB_MODE`, `SCRAPER_SWARM_URL`, and `SCRAPER_SWARM_KEY` (4c). `SALVAGE_SRC` is used by Stage 0 only.
- A variable that selects a mode (`AGENCY_AUTONOMY`, `AGENCY_WEB_MODE`) accepts only its listed values. Any other value stops the service that reads it.

## 10. Security requirements

1. No expert container has access to a container daemon. The environment runner and the lifecycle proxy are the only services that do, and only the Dispatcher can call them.
2. Experts sit on an internal network with no route out. The egress proxy is the only exit and logs every allowed and denied request with the expert's name.
3. Config directories are read-only inside experts. The registry is not mounted into any expert.
4. `ro` experts cannot write to the workspace.
5. Each expert has a unique server password. The `fleet` MCP endpoint needs its bearer token. The verifier needs its token. The dashboard and REST API need the admin password. Webhooks are signature-verified. No credential has a built-in default: an unset one stops the service.
6. Nothing listens on a non-loopback host address.
7. Text from anyone not on the allowlist is never sent to an agent. Text from allowlisted people that arrives through GitHub, chat, or the API is passed to agents as quoted data inside the brief, never as instructions to the Dispatcher.
8. Secrets files are created with mode `0600` and never tracked.
9. Every container the fleet starts has a name, CPU, memory, and PID limits, `cap_drop: [ALL]`, and `no-new-privileges`, unless a stage prompt records a specific exception.
10. No process started for a task inherits the Dispatcher's environment.
