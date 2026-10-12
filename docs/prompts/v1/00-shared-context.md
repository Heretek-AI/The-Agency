# The Agency — shared context for all build stages

This file is part of every stage prompt in this directory. Read it fully before starting a stage. It holds the things that do not change between stages: the rules you work under, the facts about OpenCode v2, the decisions already made, and the contracts every component shares.

You are working in the repository root of **The Agency** (`https://github.com/Heretek-AI/The-Agency`).

## 1. What is being built

An always-on, containerized fleet of specialized OpenCode **v2** instances. Each instance is a domain expert with its own persona, permissions, MCP servers, skills, and toolchain image. A **Director** instance leads each mission. A **Dispatcher** service owns everything deterministic: missions, playbooks, scheduling, worktrees, verification, landing, triggers, and notifications.

The finished system does this:

1. A mission starts from the Director's chat, a REST call, a GitHub issue or PR comment, or a schedule, against one of several registered repositories.
2. The Director picks a playbook and submits a plan. Larger plans and all GitHub-triggered plans wait for a human to approve.
3. The Dispatcher runs the playbook: experts work in per-task git worktrees with a throwaway environment stack; a test author writes the tests; a non-LLM verify step runs the repository's declared checks; two independent QA judges, a reviewer, and where relevant a security expert give verdicts.
4. Work that passes lands on the mission's integration branch, is verified again there, and is pushed as a draft pull request by a bot identity. A human merges.
5. People follow and steer through a dashboard, GitHub comments, and Discord.

The build is split into four stages (`stage-1` to `stage-4` in this directory). Each stage must pass its acceptance checks before the next begins.

## 2. Operating rules

- **Work in the order the stage gives, and prove each step.** Run the acceptance checks and fix failures before moving on. Do not write everything first and debug afterwards.
- **Verify; do not assume.** Your training data mostly describes OpenCode v1. v2 is different (section 3). A full v2 source tree is at `review/opencode`. When you need a fact about OpenCode, read the source file cited here. If this document and the source disagree, the source wins; record the discrepancy in `docs/build-notes.md` and adapt.
- **Never modify or commit `review/`.** It is a reference clone and must be in `.gitignore`.
- **Never write secrets to tracked files.** Secrets live in `.env`, `.env.provider`, `secrets/`, and `state/`, all ignored.
- **Work on a branch per stage** (`stage-1-core`, and so on) and commit locally with conventional commit messages. Do not push.
- **Pin every version** you install and record it in `versions.env`.
- **Check each third-party package or endpoint exists before depending on it.** If one cannot be verified, leave it out or disabled, say so in `docs/build-notes.md`, and continue.
- **Stop and ask the user** only for what a stage lists under "Ask the user". Optional integrations ship disabled and must not block you.
- **Report honestly.** Each stage ends with a report of what you ran and what passed, what you could not test, and every place you departed from the prompt.

## 3. Ground truth about OpenCode v2

The audited version is **2.0.26** (commit `4617210822`). Use it unless the stage 1 spike passes on a newer 2.0.x. v2 is labelled beta upstream and its server API may change, so every OpenCode call lives in one Dispatcher module.

### 3.1 v1 habits that are wrong in v2

| Topic | v1 (do not use) | v2 (use this) | Source in `review/opencode` |
|---|---|---|---|
| Start a server | `opencode web`, v1 routes | `opencode serve --hostname 0.0.0.0 --port 4096` serves the API under `/api/*`, the spec at `/openapi.json`, the web app at `/` | `packages/cli/src/commands/commands.ts`, `packages/cli/src/server-process.ts` |
| Attach a client | `opencode attach`, `run --attach` | `opencode run --server <url>`, `opencode api ...` | same |
| HTTP routes | `/session/:id/message`, `/global/health`, `/event` | `POST /api/session`, `POST /api/session/{id}/prompt`, `GET /api/info`, `GET /api/event` | `packages/protocol/openapi.json`, `V2_HTTP_API_AUDIT.md` |
| SDK | `@opencode-ai/sdk` | `@opencode/client` (`OpenCode.make({ baseUrl, headers })`) | `packages/client`, `packages/cli/src/services/server-connection.ts` |
| Auth | varies | HTTP Basic, user `opencode`, password from `OPENCODE_PASSWORD` | `packages/server/src/middleware/authorization.ts` |
| Config keys | `agent`, `permission`, `provider`, `plugin`, `command`, flat `mcp.<name>` | `agents`, `permissions`, `providers`, `plugins`, `commands`, `mcp.servers.<name>` | `packages/schema/src/config.ts`, `packages/schema/src/config/*.ts` |
| Agent prompt field | `prompt` | `system`, or the markdown body of the agent file | `packages/schema/src/config/agent.ts` |
| Permissions | `{ "bash": { "git push *": "ask" } }` | ordered array of `{ action, resource, effect }`; last match wins; unmatched means `ask` | `packages/schema/src/permission.ts`, `packages/core/src/permission.ts` |
| Tool and action names | `bash`, `task` | `shell`, `subagent`; `write` and `patch` are checked as `edit` | `packages/core/src/tool/plugin/*.ts` |
| MCP toggle | `"enabled": true` | `"disabled": false`; timeouts are `{ startup, catalog, execution }` in ms | `packages/schema/src/mcp.ts` |

The docs under `review/opencode/packages/web/src/content/docs` are mostly v1-era. Do not rely on them for the server, CLI, or config.

### 3.2 Facts the design depends on

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

## 4. Decisions already made

These came out of a design review and are not open for you to revisit. If one turns out to be impossible, stop and tell the user.

| Area | Decision |
|---|---|
| Positioning | Standalone system. The Dispatcher mirrors the task model, states, failure policies, and branch names of es-fleet (`Heretek-AI/IUMBTEMS`, `docs/FLEET.md`) so the two can converge later. Do not import its code. License: Apache-2.0. |
| Service shape | Always-on. Several registered repositories; a mission targets exactly one. Nothing listens on a public address; GitHub is polled. |
| Triggers | Director chat, REST API and signed webhooks, GitHub issues and PR comments, schedules. |
| Workflows | Declarative playbooks enforced by the Dispatcher. The Director chooses one and writes briefs; it cannot skip a gate. |
| Missions | Durable records with a plan, a task graph, a decision log, and their own integration branch. The Dispatcher wakes the Director when tasks finish. |
| Merge gate | A non-LLM verify step runs the repository's declared checks on the task branch before landing and on the integration branch after each merge. Red blocks. |
| QA | A test author plus two independent judges (functional, adversarial) in separate containers on every code change; the architect breaks ties. Rework is capped: three attempts, one replan, two more attempts, then the mission halts for a human. |
| Test environment | A throwaway compose stack per task, started by an environment runner with its own nested container daemon. Only the Dispatcher calls the runner. |
| Write scope | An ownership map per repository, proposed by the scout and approved by a human. Hard block for read-only experts and for another expert's paths; shared files (manifests, lockfiles) are allowed and flagged. |
| Control files | Ownership map, checks, environment definition, secrets, and trigger settings live in a fleet-side registry that no expert can read or write. |
| Humans | Plan approval for missions above a configurable task count and for every GitHub-triggered mission. Auto draft PR when gates are green; merging is human-only. An explicit allowlist of accounts may trigger or approve. Channels: dashboard, GitHub comments, Discord (behind a generic signed webhook). |
| Models and keys | One model for every expert (`AGENCY_MODEL`) and one key (`OPENCODE_API_KEY`), both from the environment. No LLM gateway. No spend ceiling. When a provider usage limit is hit, missions pause and resume when it resets. |
| Queue | Priority order chat, GitHub, API, schedules; a cap on concurrent missions; scheduled missions start only when the usage window has headroom. |
| Egress | Experts have no direct route out. An allowlist proxy is the only exit. Scraper Swarm replaces built-in web tools later. |
| Roster | 25 experts. 14 core stay running; 11 extended start on demand. |
| Evaluation | A small suite of scripted missions on fixture repositories, also used to compare candidate models. |
| Extensibility | An expert-pack contract so outside projects can ship experts. |

## 5. Target architecture

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
 ┌──────────┐  ┌───────────────┐   ┌───────────────────┐
 │ director │  │ experts × 24  │◄─►│ environment runner│ nested daemon
 └────┬─────┘  └──────┬────────┘   └───────────────────┘
      └──── internal network `fleet`, no route out ─────┐
                                                 ┌──────▼───────┐
   gateway (Caddy, 127.0.0.1:8080) ── browser    │ egress proxy │
                                                 └──────────────┘
```

Fixed design points:

- **Hub and spoke.** Only the Director has the `fleet` MCP server. Experts never dispatch to each other; they name the expert they need in their report.
- **One worktree and one fresh session per task.** Experts commit but never push, merge, or switch branches.
- **Two access classes.** `ro` experts mount the workspace read-only and write only under `/artifacts/<taskId>/`. `scoped` experts mount it read-write and may edit only the paths the task grants.
- **`fleet.yaml` is the source of truth for the roster.** A render script generates each expert's `opencode.jsonc`, the compose file, and the Dispatcher's roster from it.
- **Each expert has its own server password.** The Dispatcher knows all of them; an expert knows only its own.

## 6. Repository layout (final)

```
.
├── LICENSE                          # Apache-2.0
├── Makefile
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
├── playbooks/*.yaml                 # stage 2
├── dispatcher/                      # src/, web/, test/
├── envrunner/                       # stage 2
├── egress/                          # proxy config and allowlists
├── gateway/Caddyfile
├── adapters/discord/                # stage 3
├── evals/                           # stage 4
├── packs/                           # stage 4: contract, validator, examples
├── scripts/
├── fixtures/                        # demo repositories
├── registry.example/                # example control files
├── state/                           # ignored: registry/, dispatcher data, backups
├── workspace/                       # ignored: <repoId>/repo, <repoId>/trees
├── secrets/                         # ignored
└── docs/
```

`.gitignore` covers `review/`, `.env`, `.env.provider`, `secrets/`, `state/`, `workspace/`, `node_modules/`, and build output.

## 7. Shared contracts

### 7.1 Workspace paths (inside containers)

```
/work/<repoId>/repo            the clone; its checked-out branch is never used for work
/work/<repoId>/trees/<taskId>  one worktree per task
/work/<repoId>/landing/<id>    throwaway worktrees used only by the Dispatcher for merges
/artifacts/<taskId>/           reports, screenshots, SARIF, logs
```

The workspace is always a clone made by the fleet, never a bind mount of someone's live checkout.

### 7.2 Branches (mirrors es-fleet)

- `fleet/<taskId>`: one branch per task.
- `fleet/integration/<missionId>`: where passed tasks land.
- `refs/fleet-salvage/<taskId>`: anchor created before an abandoned task branch is deleted.
- Merged task branches are kept for the audit trail. The repository's base branch is never checked out, reset, or merged by the fleet.

### 7.3 Task and mission model (mirrors es-fleet)

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
  sessionId?, branch?, worktree?
}

Mission {
  id, repo, source: "chat" | "api" | "github" | "schedule", sourceRef?,
  playbook, objective, priority,
  status: "planning" | "waiting-human" | "running" | "paused" | "halted" | "done" | "failed" | "cancelled",
  plan, tasks[], decisions[],  // decisions is append-only
  directorSessionId?, integrationBranch, pausedUntil?, createdAt, updatedAt
}
```

Scheduling follows es-fleet's rules: a task is `ready` when all its dependencies are `done` (`all_success`) or any is (`one_success`); a task that can never run is `cancelled`; starts are ordered by id and bounded by the concurrency caps; on failure, `fail` is terminal and cancels dependents, `retry` re-queues while `attempts <= maxAttempts`, `replan` parks the task as `waiting-human`. Write the scheduler as a pure function of the graph and the caps, with no clock inside.

### 7.4 Landing

Landing a task is one transaction:

1. Run verify in the task worktree. A failure marks the task `failed` with the check's name as the reason and merges nothing.
2. Merge `fleet/<taskId>` into `fleet/integration/<missionId>` with `--no-ff` inside a throwaway worktree, after recording the pre-merge tip. On conflict, abort and report the conflicting files.
3. Run verify on the merged tree. If it fails, reset the integration branch to the recorded tip and fail the landing with the reason.

### 7.5 Wildcards

Path patterns everywhere (ownership maps, permission rules, the diff policy check) use OpenCode's dialect: `*` matches any characters including `/`, `?` matches one character. Port `Wildcard.match` once and use that one function.

### 7.6 Baseline permission ruleset

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

`edit` rules for repository paths are **not** in the static config. The Dispatcher passes them per task in the `permissions` field of `POST /api/session`, built from the repository's ownership map. Stage 1 confirms that session rules are evaluated after agent rules; if they are not, fall back to static globs from `fleet.yaml`.

The Director's ruleset replaces `shell *` with allows for `git log*`, `git status*`, `git diff*`, `git show*`, denies `subagent`, and allows `fleet_*`. Shell deny rules are text matching and guard against accidents only; the boundaries that hold are mounts, the absence of credentials, the egress proxy, and the Dispatcher's diff check.

### 7.7 Task envelope

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

### 7.8 Result and verdict blocks

`shared/FLEET_PROTOCOL.md` becomes every expert's `AGENTS.md`. It must say: you are one specialist in a fleet and your tasks come from a Dispatcher, not from a person; nobody can answer questions, so make a reasonable assumption and record it, or report `blocked`; stay inside your granted paths and your role; verify your work by running it and report the commands and what they actually showed; never push, merge, or change branches; name the expert you need under handoffs instead of doing their job. Builders and authors end with:

```
## RESULT
status: done | blocked | needs-handoff | needs-split
summary: <two to five sentences>
changes: <commits and files, or "none">
verification: <commands run and what each showed>
assumptions: <list or "none">
risks: <list or "none">
handoffs: <"<expert>: <request>" lines, or "none">
artifacts: <paths under /artifacts/<taskId>/, or "none">
```

Judges (QA judges, reviewer, security, the architect on a tiebreak) end with:

```
## VERDICT
decision: pass | fail
findings:
  - severity: blocker | major | minor
    where: <file:line, criterion number, or reproduction steps>
    what: <one or two sentences>
evidence: <commands run and what each showed, artifact paths>
```

The Dispatcher parses both leniently and always keeps the raw text. A missing or unusable block gets one automatic follow-up asking for it; a second failure fails the task.

### 7.9 `fleet.yaml`

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
    profile: core           # core (always running) | extended (on demand)
    tier: standard
    access: scoped          # ro | scoped
    description: "Server-side implementation: endpoints, business logic, integrations, unit tests."
    handles:   ["endpoints", "business logic", "integrations", "background jobs", "unit tests"]
    delegates: ["schema and migrations -> dba", "CI and deploy -> platform", "contract files -> api"]
    proposed_writes: ["src/*", "server/*", "api/*", "services/*", "internal/*", "pkg/*", "cmd/*", "lib/*"]
    mcp:       [context7, serena, dbhub]
    egress:    []           # extra allowlisted hosts for this expert
    browser:   false        # true adds shm_size and more memory
```

`proposed_writes` seeds the ownership map proposal for a new repository. The enforced map is the approved one in the registry.

### 7.10 Roster

Role prose, boundaries, and skill descriptions are in `docs/research/02-expert-fleet-catalog.md`; if that file is missing, derive them from this table. Each expert gets two to four skills written as short, concrete procedures.

| Name | Profile | Access | Proposed writes | MCP | Extra image tools |
|---|---|---|---|---|---|
| `director` | core | ro | — | `fleet` | — |
| `scout` | core | ro | — | `context7`, `deepwiki` | `ast-grep`, `scc`, `tree` |
| `architect` | core | scoped | `docs/adr/*`, `docs/architecture/*` | `context7`, `deepwiki` | `scc`, `dependency-cruiser`, `madge` |
| `product` | core | scoped | `docs/product/*`, `docs/requirements/*` | `github`, `linear` | `gh` |
| `frontend` | core | scoped | `web/*`, `apps/web/*`, `src/components/*`, `src/pages/*`, `src/app/*`, `src/styles/*`, `public/*` | `playwright`, `context7`, `figma` | `pnpm`, `bun`, Chromium, `@axe-core/cli` |
| `backend` | core | scoped | `src/*`, `server/*`, `api/*`, `services/*`, `internal/*`, `pkg/*`, `cmd/*`, `lib/*` | `context7`, `serena`, `dbhub` | `pnpm`, `hurl`, `httpie`, `make`, optional `go`, `rust`, JDK |
| `dba` | core | scoped | `migrations/*`, `db/*`, `prisma/*`, `schema/*`, `*.sql` | `postgres` | `psql`, `sqlite3`, `sqlfluff`, `atlas` |
| `platform` | core | scoped | `Dockerfile*`, `*compose*.yml`, `.github/*`, `.gitlab-ci.yml`, `infra/*`, `deploy/*`, `k8s/*`, `helm/*`, `terraform/*`, `Makefile`, `scripts/*` | `terraform`, `kubernetes`, `github` | `hadolint`, `actionlint`, `shellcheck`, `shfmt`, `yamllint`, `terraform`, `tflint`, `kubectl`, `helm`, `kustomize`, `kubeconform` |
| `security` | core | ro | — | `semgrep`, `trivy` | `semgrep`, `trivy`, `gitleaks`, `osv-scanner`, `syft`, `grype`, `checkov` |
| `qa` | core | scoped | `tests/*`, `test/*`, `e2e/*`, `*.test.*`, `*.spec.*`, `*__tests__*`, `playwright.config.*`, `vitest.config.*`, `jest.config.*` | `playwright` | `pnpm`, Chromium |
| `qa-functional` | core | ro | — | `playwright` | `pnpm`, Chromium, `hurl` |
| `qa-adversarial` | core | ro | — | `playwright` | `pnpm`, Chromium, `hurl` |
| `reviewer` | core | ro | — | `github` | `delta`, `difftastic`, `scc` |
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

### 7.11 MCP registry (`mcp/registry.jsonc`)

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

Database servers: from stage 2 a task's database address exists only in that session's environment, while an MCP server process is started from the container's configuration, so it cannot be assumed to see it. `postgres` and `dbhub` therefore ship disabled, and experts use `psql` and similar command-line clients with the session's `DATABASE_URL`. Enable the MCP servers only if a test shows they receive the per-task address.

Rules: install local servers into the image at build time; a server whose requirements are unmet must end up `disabled` at container start; experts have no container daemon, so never launch an MCP server with `docker run`; every remote MCP host an expert uses must be on that expert's egress allowlist. Any token given to an expert's MCP server is read-only. The token that can push or open pull requests is held only by the Dispatcher.

## 8. Security requirements

1. No expert container has access to a container daemon. The environment runner and the lifecycle proxy are the only services that do, and only the Dispatcher can call them.
2. Experts sit on an internal network with no route out. The egress proxy is the only exit and logs every allowed and denied request with the expert's name.
3. Config directories are read-only inside experts. The registry is not mounted into any expert.
4. `ro` experts cannot write to the workspace.
5. Each expert has a unique server password. The `fleet` MCP endpoint needs its bearer token. The dashboard and REST API need the admin password. Webhooks are signature-verified.
6. Nothing listens on a non-loopback host address.
7. Text from anyone not on the allowlist is never sent to an agent. Text from allowlisted people that arrives through GitHub, chat, or the API is passed to agents as quoted data inside the brief, never as instructions to the Dispatcher.
8. Secrets files are created with mode `0600` and never tracked.
