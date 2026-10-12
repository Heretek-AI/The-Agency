# The Agency — Architectural Analysis

Research date: 2026-10-12.

**Audit basis.** Local clone `review/opencode` at commit `4617210822` (`v2.0.0-1105-g4617210822`), package version **2.0.26** (changelog entry dated 2026-10-08), upstream `anomalyco/opencode`, default branch `v2`.

Two caveats shape everything below:

1. **The docs inside the clone describe v1, not v2.** `packages/web/src/content/docs/*.mdx` still documents `opencode web`, `opencode attach`, `/session/:id/message`, and the `permission: { bash: ... }` object format. None of that matches the v2 source. Every statement in section 1 comes from source: `packages/cli`, `packages/server`, `packages/protocol/openapi.json`, `packages/schema`, `packages/core`.
2. **v2 is still labelled beta upstream.** The official migration guide says the server API and plugin API may keep changing. The fleet must pin one OpenCode version and keep all API calls behind one module.

---

## 1. OpenCode v2 headless capabilities

### 1.1 Process modes (`packages/cli/src/commands/commands.ts`)

| Command | Behavior | Role in the fleet |
|---|---|---|
| `opencode serve [--hostname H] [--port P] [--cors ORIGIN]...` | "Start the v2 API and web server." Runs in the foreground. Defaults to `127.0.0.1`; with no `--port` it tries 4096 and increments while the port is busy. Prints `server listening on <url>`. Serves the web app at `/`, the API under `/api/*`, and the spec at `/openapi.json`. | Entrypoint of every expert container |
| `opencode serve --stdio` | Prints `{"url": ...}` as JSON and shuts down when stdin closes. | Not used |
| `opencode serve --service`, `opencode service start\|stop\|restart\|status\|get\|set\|unset` | Managed background daemon with a registration file and a persisted password. | Desktop use; not for containers |
| `opencode run [message..] --server URL --format json --agent A --model provider/model#variant --session ID --continue --fork --file F --title T --auto` | Non-interactive prompt against a running server (`--server`) or a private one (`--standalone`). | Smoke tests and scripts |
| `opencode api <operationId \| METHOD /path> [-d BODY] [--param k=v] [-H name:value]` | curl-like request to the running server; resolves operation IDs from `/openapi.json`. | Debugging |
| `opencode acp` | Agent Client Protocol agent over stdio (ndJSON), backed by a standalone server. | Editor integration; not used |
| `opencode pair [--url U] [--remote]` | Prints one-time links to connect a browser or app. | Optional |
| `opencode debug agents\|config\|paths`, `mcp list\|add\|auth\|logout`, `auth list\|login\|logout\|export\|import\|switch`, `models`, `session list\|delete\|export\|import`, `stats`, `plugin ...`, `reload` | Administration and diagnostics. | Bootstrap and verification |

Removed since v1: `opencode web`, `opencode attach`, and `run --attach` (now `run --server`).

### 1.2 Authentication (`packages/server/src/middleware/authorization.ts`, `auth.ts`)

- HTTP Basic. The username is fixed to `opencode`. The password comes from `OPENCODE_PASSWORD` (the legacy `OPENCODE_SERVER_PASSWORD` is still read). If neither is set, `serve` generates a random password and prints it.
- Also accepted: `?auth_token=<base64 "opencode:password">` and a signed session cookie (30-day TTL, name `opencode_session_<port>`).
- The web shell (static assets) is served before authentication so a signed-out browser gets the app's own sign-in screen. Everything under `/api/*` is gated.
- CORS origins are added with repeated `--cors`.

### 1.3 HTTP API (`packages/protocol/openapi.json`, `V2_HTTP_API_AUDIT.md`)

118 paths, all under `/api/*`. JSON responses wrap the payload as `{ "data": ... }`. The operations the orchestration layer needs:

| Operation | Method and path | Notes |
|---|---|---|
| `server.info` | `GET /api/info` | `{ version, pid, urls, paths }`; readiness is the HTTP status. Requires auth. |
| `session.create` | `POST /api/session` | Body (all optional): `id`, `parentID`, `title`, `agent`, `model {providerID, id, variant?}`, `location {directory}`, `metadata`, `permissions` (a ruleset). |
| `session.prompt` | `POST /api/session/{sessionID}/prompt` | Body: `text` (required), `files`, `agents`, `skills`, `metadata`, `delivery: "steer" \| "queue"`, `resume`. Admission is durable and asynchronous: the call returns the inbox item, not the answer. |
| `experimental.session.wait` | `POST /api/experimental/session/{sessionID}/wait` | Returns 204 when the session is idle ("race-free idle barrier"). Experimental. |
| `session.interrupt` | `POST /api/session/{sessionID}/interrupt` | Cancel a running session. |
| `session.message.list` | `GET /api/session/{sessionID}/message?limit&order&cursor&type` | Transcript. |
| `session.diff` | `GET /api/session/{sessionID}/diff?from&to&context` | `[{ file, patch, additions, deletions, status }]`. |
| `session.permission.list` / `.reply` | `GET /api/session/{id}/permission`, `POST .../permission/{requestID}/reply` | Reply body `{ decision: "once" \| "always" \| "reject", message? }`. |
| `event.subscribe` | `GET /api/event` | One SSE stream of all server events. |
| `session.active`, `session.get`, `session.list`, `session.fork`, `session.switchAgent`, `session.switchModel`, `session.synthetic` | — | Status, lifecycle, and synthetic message injection. |
| `vcs.status`, `vcs.diff`, `worktree.list\|create\|remove`, `fs.read\|list\|find` | — | Working-copy inspection without shelling in. |
| `agent.list`, `skill.list`, `mcp.list`, `model.list` | — | Verify what each expert actually loaded. |

Clients: `@opencode/client` (promise, effect, and solid entry points) is the v2 client; the CLI uses it as `OpenCode.make({ baseUrl, headers })`. The v1 package `@opencode-ai/sdk` does not speak v2.

### 1.4 Configuration (`packages/schema/src/config*.ts`, `packages/core/src/config*`)

**Files and precedence** (lowest to highest): well-known remote config → global directory (`~/.config/opencode`, or `OPENCODE_CONFIG_DIR`) → `OPENCODE_CONFIG` file → `opencode.json`/`opencode.jsonc` in ancestor directories → project `.opencode/` directories → `OPENCODE_CONFIG_CONTENT`. `.claude/` and `.agents/` directories (global and project) are also read for compatibility. `OPENCODE_DISABLE_PROJECT_CONFIG=1` turns off the project sources. Config is watched and hot-reloaded.

**Substitution:** `{env:VAR}` and `{file:path}` inside config text.

**v2 key names** (v1 names are still read and migrated in memory, with warnings):

| v2 key | Shape | v1 name |
|---|---|---|
| `model` | `"provider/model#variant"` or `{ providerID, model, variant? }` | `model` |
| `default_agent` | agent id | same |
| `agents` | `{ <id>: { model, system, description, mode, hidden, color, steps, disabled, permissions, request } }` | `agent` (`prompt` → `system`, `disable` → `disabled`) |
| `permissions` | ordered array of `{ action, resource, effect }` | `permission` object |
| `mcp` | `{ timeout?, servers: { <name>: local \| remote } }` | flat `mcp.<name>` |
| `skills` | array of paths or URLs | `{ paths, urls }` |
| `instructions` | array of paths or URLs | same |
| `commands`, `references`, `plugins`, `providers`, `snapshots` | — | `command`, `reference`, `plugin`, `provider`, `snapshot` |
| `update` | `"disable" \| "notify" \| "auto"` | `autoupdate` |
| `share` | `"manual" \| "auto" \| "disabled"` | `autoshare` |
| `experimental.subagent_depth` | integer, default 1 | top-level `subagent_depth` (now ignored) |

**Agents.** Defined in config (`agents.<id>`) or as markdown at `<config root>/{agent,agents}/**/*.md`, where the frontmatter holds the same fields and the body becomes `system`. Built-ins: `build` (default primary), `general` and `explore` (subagents), `plan`, plus hidden `compaction`, `title`, `summary`. A new agent id starts from allow-all plus "ask before reading `.env`".

**Permissions.** Rules are evaluated with *last match wins*; if nothing matches the effect is `ask`. `*` in a pattern matches any characters, including `/`.

| Action | Resource matched against |
|---|---|
| `read`, `edit` | File path: relative to the session location for files inside it, absolute for files outside. (`write` and `patch` tools assert `edit`.) |
| `shell` | The command text, one check per parsed command. `git *` also matches bare `git`. |
| `glob`, `grep` | The pattern. |
| `webfetch`, `websearch`, `question` | `*` in practice. |
| `subagent` | The agent id. |
| `skill` | The skill id. |
| `external_directory` | `<absolute dir>/*` for paths outside the session location. |
| `<server>_<tool>` | MCP tool calls; the resource is `*`. |

**MCP.** Local servers: `{ type: "local", command: [...], cwd?, environment?, disabled?, codemode?, timeout?, protocol? }`. Remote servers: `{ type: "remote", url, headers?, oauth? | false, disabled?, codemode?, timeout?, protocol? }`. Timeouts are `{ startup, catalog, execution }` in milliseconds. **Code Mode** is on by default per server: instead of injecting every MCP tool schema, the model gets a compact catalog and one `execute` tool that runs code calling those tools. That is a built-in answer to tool-schema bloat, and it is the reason the fleet can afford a few MCP servers per expert.

**Skills.** Loaded from `<config root>/{skill,skills}/` (`*.md` or `**/SKILL.md`) and from the `skills` array. Frontmatter: `name`, `description`.

**Instructions.** `AGENTS.md` in the global config directory and in ancestor directories of the session location, plus the `instructions` array.

### 1.5 Containerization

- **Official image:** `ghcr.io/anomalyco/opencode:<version>` (`packages/cli/Dockerfile`). Alpine, a single musl binary at `/usr/local/bin/opencode`, runtime deps `libgcc libstdc++ ripgrep`, `ENTRYPOINT ["opencode"]`. Multi-arch (amd64, arm64). The publish script tags by version only; I did not see a `latest` tag being pushed.
- **Install script:** `curl -fsSL https://opencode.ai/v2/install | bash -s -- --version <v>` installs to `$HOME/.opencode/bin` and picks the glibc or musl, baseline or AVX2 build automatically. This is the route for a Debian or Ubuntu based image; the musl binary from the official image will not run on glibc.
- **State:** XDG layout. Data in `~/.local/share/opencode` (SQLite `opencode.db`, logs, cloned reference repos), plus config, cache, and state directories. Persist data and state per expert.
- **Runtime dependencies beyond the binary:** `git` and `ripgrep`; whatever each MCP server needs (`node`, `uv`, a browser).
- **Useful environment variables** (read in `packages/cli/src/server-process.ts` and `index.ts`): `OPENCODE_PASSWORD`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_DB`, `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_MODELS_URL`, `OPENCODE_CLIENT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`.

### 1.6 Design constraints that follow from the audit

1. **One `opencode serve` per expert; all orchestration is HTTP plus SSE.** There is no need for tmux, PTY scraping, or CLI wrappers.
2. **Nobody is there to answer `ask`.** Every expert ruleset must resolve to `allow` or `deny`, and the orchestration layer must auto-reject any permission request that still appears.
3. **Config hot-reloads and the agent has a shell.** If an expert can write its own config directory it can rewrite its own permissions. The config must be read-only to the agent user.
4. **Project config outranks global config.** A target repository with its own `opencode.json` or `.opencode/` could widen an expert's permissions or add MCP servers. Experts should run with `OPENCODE_DISABLE_PROJECT_CONFIG=1`.
5. **The web app is served from the server root.** Per-expert UIs must be routed by hostname or port, not by URL subpath.
6. **Shell permission patterns are text matching, not a sandbox.** The real write boundary is the container's mounts and credentials, backed by a deterministic check of the resulting diff.

---

## 2. Orchestration layers and WebUIs

### 2.1 The finding that decides most of it

OpenCode v2 removed the v1 HTTP API. Every route moved under `/api/*` with new contracts, and the v1 SDK (`@opencode-ai/sdk`, last published in the 1.18 line) cannot talk to a v2 server. Third-party clients are filing "support v2" issues for exactly this reason. So tools fall into two groups:

- **Server-API clients** (OpenChamber, CodeNomad, opencode-manager, portal, and similar) need a v2 port before they work against a 2.x server. I could not confirm v2 support for any of them from primary sources today; check each project's release notes before adopting one.
- **CLI-spawning orchestrators** (Paperclip, Multica, agent-swarm, Paseo) run `opencode run ...` as a child process next to their own daemon. They survive the API change, but they assume the agent CLI lives beside the orchestrator, which is the opposite of one isolated container per expert.

### 2.2 Comparison

Repository figures were read from the project pages today and are approximate.

| Candidate | What it is | How it drives OpenCode | Director chat | Cross-instance delegation | Live logs and diffs | Docker | Fit for "one v2 container per expert" |
|---|---|---|---|---|---|---|---|
| **A. Native v2 server and web UI + thin Dispatcher (to build)** | Each expert's own `serve` (API and web app), plus a small service that exposes fleet tools to the Director over MCP and a fleet dashboard | v2 HTTP API and SSE directly | Yes: the Director's own web UI | Yes: `fleet_dispatch` and friends | Per-expert native UI, plus aggregated dashboard and container logs | Native | **Best.** No dependence on unported third-party clients. Cost: roughly 1–2k lines of custom code to own. |
| **B. Paperclip** (`paperclipai/paperclip`, MIT, ~100k stars) | "Company" control plane: org chart, CEO agent, tickets, heartbeats, budgets, approvals | `opencode_local` adapter runs `opencode run --format json` on the Paperclip host; sets `OPENCODE_DISABLE_PROJECT_CONFIG=true` and, by default, writes a temporary allow-all permission config | Through tickets and task threads rather than a live chat | Yes, CEO to reports through tickets | Run logs, costs, work products | Yes (Postgres) | Medium. Strong governance, but the adapter is co-located, v2 is not mentioned in its docs, and the default allow-all config would override per-expert permissions. Could sit on top of option A later through its `http` or `process` adapter. |
| **C. Multica** (`multica-ai/multica`, modified Apache-2.0, ~52k stars) | Issue board where agents are assignees; Go backend, Postgres, web, desktop, and mobile clients | A daemon spawns the installed agent CLI | Chat and mentions | Squads with a leader route work; agents do not delegate to each other | Execution logs, per-run cost, PR-based review | Yes | Medium-low. Every expert container would also need the Multica daemon; the license adds conditions for hosted and embedded use. |
| **D. agent-swarm** (`desplega-ai/agent-swarm`, MIT, ~900 stars) | Lead agent plus workers in Docker containers, MCP and REST coordination, dashboard, many integrations | Harness wrapper inside its own worker image; OpenCode is one of about ten harnesses | Lead agent via Slack, API, or dashboard | Yes, lead to workers | Task logs, session history | Yes | Medium. The topology matches, but workers are its image and its identity model, the project is small, and it changes daily. |
| **E. Paseo** (`getpaseo/paseo`, Apache-2.0, ~20k stars) | Daemon plus desktop, web, mobile, and CLI clients; worktrees, diffs, PRs | Daemon manages local agent processes | Yes, per agent | Handoff, advisor, and committee skills | Live streams, side-by-side diffs | Yes | Medium-low. Built around one daemon owning the agent processes on one host. |
| **F. OpenChamber, CodeNomad, opencode-manager, portal** | Web, desktop, and mobile UIs for OpenCode | OpenCode server API (v1 lineage) | Yes, for one instance | No | Yes, per instance (OpenChamber has multi-run and a change walkthrough) | Varies | Low until v2 support is confirmed, and none of them routes work between instances. |
| **G. Vibe Kanban** | Kanban board that starts agents in worktrees and shows diffs | Spawns local CLIs | No | No | Yes | Yes | Low. Reported as community-maintained since the company closed in April 2026. |
| **H. Gas Town / Gas City** | "Mayor" dispatching to 20–30 agents from a git-backed ledger | tmux and CLIs; needs Go, Dolt, Beads | Mayor | Yes | Mostly terminal | Not its focus | Low. Heavy operational bar and no web-first UI. |
| **I. LangGraph, CrewAI, Temporal** | General agent or workflow frameworks | You write the OpenCode adapter yourself | You build it | You build it | Framework tooling, not coding-agent aware | Yes | Low. The adapter is the same work as option A's Dispatcher, without a suitable UI. |
| **J. In-process harnesses** (oh-my-opencode, OAK, opencode-workspace) and **native v2 subagents** | Multiple agents inside one OpenCode process | Plugins and the built-in `subagent` tool | Yes | Inside one process only | Native UI | n/a | Different architecture. Worth knowing: native subagents with per-agent permissions are the cheap alternative if container isolation ever stops being worth it. |

### 2.3 Recommendation

**Option A: native OpenCode v2 servers and web UIs, plus a purpose-built Dispatcher.**

This subsection is the recommendation as the research left it. A design review then extended it considerably; section 3 records the outcome, and where the two differ, section 3 holds.

```
                      browser (127.0.0.1 only)
                               │
                        ┌──────▼──────┐
                        │   gateway   │  Caddy, host-based routing
                        └┬─────┬─────┬┘
          agency.localhost     │     <expert>.agency.localhost
                 │   director.agency.localhost     │
        ┌────────▼───┐  ┌──────▼─────┐   ┌─────────▼─────────┐
        │ dispatcher │◄─┤  director  │   │  expert × N       │
        │ MCP + REST │  │ opencode   │   │  opencode serve   │
        │ dashboard  │  │ serve      │   │  own config, MCP, │
        └──┬──────┬──┘  └────────────┘   │  skills, toolchain│
           │      │   v2 HTTP + SSE      └─────────▲─────────┘
           │      └────────────────────────────────┘
     ┌─────▼───────────────────────────────────────────────┐
     │ /work (repo + per-task worktrees), /artifacts       │
     └─────────────────────────────────────────────────────┘
```

- **Talking to the Director:** the Director is an ordinary OpenCode instance, so its native web UI is the chat surface. Nothing to build.
- **Routing and collection:** the Director has one MCP server, `fleet`, served by the Dispatcher. `fleet_dispatch` creates a git worktree and a session on the chosen expert, sends a task envelope, and tracks it. `fleet_wait`, `fleet_result`, and `fleet_diff` bring back the report and the patch. Deterministic work (worktrees, waiting, diff policy checks, merging to an integration branch) lives in Dispatcher code rather than in a prompt.
- **Monitoring:** the Dispatcher dashboard shows the roster, task states, live transcripts relayed from each expert's SSE stream, diffs, and artifacts, and links into each expert's native UI. Dozzle gives live container logs. OpenCode reads `OTEL_EXPORTER_OTLP_ENDPOINT`, so an OTLP backend can be added as a profile; I saw the variable wired in the CLI entrypoint but did not verify which signals it emits.
- **Why not adopt an existing platform now:** the ones that drive OpenCode over its server API are on the v1 contract, and the ones that spawn the CLI want to own the process and, in Paperclip's case, the permission config. Either way the per-expert isolation that motivates this project gets weakened.
- **Later option:** if tickets, budgets, and approval workflows become important, put Paperclip in front and point its `http` or `process` adapter at the Dispatcher's REST API. The fleet itself would not change.

### 2.4 Open risks

| Risk | Mitigation in the design |
|---|---|
| v2 API changes during beta | Pin `OPENCODE_VERSION`; one `opencode-client` module in the Dispatcher; contract test against `/openapi.json` on startup. |
| `experimental.session.wait` is experimental | Fall back to polling session status and SSE idle events. |
| Provider credentials via environment variables were not verified in v2 | Verify in the first build phase with `opencode models`; fall back to `opencode auth import` in the entrypoint. |
| Read-only mounts of a git working tree may upset snapshots or VCS status | Test early; fall back to a read-write mount with deny rules and the Dispatcher's diff policy check. |
| Remote MCP servers that need OAuth are awkward in headless containers | Prefer token or header auth; ship OAuth-only servers disabled by default. |
| The host is Fedora, so SELinux applies to bind mounts | Use `:z` on shared bind mounts; detect Docker versus Podman. |

---

## 3. Design review outcome (2026-10-12)

The review asked what the first design was missing, whether it handled QA and workflows, and how the organization's other projects fit. The short answers were: it had no workflow layer, QA rested on model judgement and self-reported results, and one of the side projects, Epistemic Swarm, already solves both for a single host.

### 3.1 What changed

| Topic | Research draft | Decided in review |
|---|---|---|
| Deployment | Local, one repo, chat only | Always-on service; several registered repositories, one per mission; private network only |
| Triggers | Director chat | Director chat, REST API and webhooks, GitHub issues and PR comments (polled), schedules |
| Workflow | The Director improvises a plan each time | Playbooks enforced by the Dispatcher (feature, bugfix, security fix, dependency update, docs-only, research); the Director writes briefs but cannot skip a gate |
| Mission state | Lives in the Director's context | Durable mission records in the Dispatcher, a branch per mission, and the Dispatcher wakes the Director when tasks finish |
| Merge gate | Reviewer expert and Director judgement | A mandatory non-LLM verify step on the task branch and again on the mission branch after each merge |
| QA | One `qa` expert, optional | A test author plus two independent judges (functional, adversarial) on every code change; the architect breaks ties; rework capped at three attempts, one replan, two more, then halt |
| Test environment | None | A throwaway compose stack per task, started by an environment runner with its own nested container daemon |
| Task model | Own states and branch names | Mirrors es-fleet: its task states, dependency triggers, failure policies, and branching policy |
| Write scope | Default globs per expert | An ownership map per repository, proposed by the scout, approved by a human, stored in a fleet-side registry experts can only read |
| Models and keys | Three Claude tiers | One model for every expert and one key (`OPENCODE_API_KEY`, OpenCode Go or Zen), both from the environment; no LLM gateway and no spend ceiling; missions pause at a Go usage cap and resume when it resets |
| Egress | Open internet | An allowlist proxy now; Scraper Swarm as the only web path once its contract is stable |
| Humans | Not specified | Plan approval for larger missions and all GitHub-triggered ones; a bot opens a draft PR when gates are green; merging is human-only; an explicit allowlist of who may trigger or approve; dashboard, GitHub comments, and Discord as channels |
| Roster | 23 experts | 25: the two QA judges added; 14 core experts stay up, 11 extended start on demand |
| Evaluation | None | A small suite of scripted missions on fixture repositories, also used to choose the model |

### 3.2 Architecture after the review

```
 triggers                          humans
 chat · REST/webhook               dashboard · GitHub comments · Discord
 GitHub poller · scheduler              ▲ approvals, questions, results
        │                               │
        ▼                               │
 ┌──────────────────────────────────────┴───────────┐      ┌──────────────┐
 │ dispatcher                                       │─────►│ registry     │
 │ missions · playbooks · scheduler · landing       │      │ per repo:    │
 │ MCP for the Director · REST · dashboard          │      │ ownership,   │
 └───┬───────────────┬───────────────────┬──────────┘      │ checks, env, │
     │ v2 HTTP + SSE │                   │                 │ secrets      │
     ▼               ▼                   ▼                 └──────────────┘
 ┌──────────┐  ┌───────────────┐   ┌───────────────────┐
 │ director │  │ experts × 24  │   │ environment runner│  nested daemon:
 │ one      │  │ core up,      │◄─►│ per-task stacks,  │  app, database,
 │ session  │  │ extended on   │   │ verify checks     │  services
 │ / mission│  │ demand        │   └───────────────────┘
 └────┬─────┘  └──────┬────────┘
      └───── internal network, no direct route out ─────┐
                                                 ┌──────▼───────┐
                                                 │ egress proxy │ allowlist:
                                                 └──────────────┘ opencode.ai,
                                                                  registries, docs
```

### 3.3 Relationship to Epistemic Swarm

The Agency is built as a standalone system with seams where Epistemic Swarm (`Heretek-AI/IUMBTEMS`) can later take over governance. The two differ in their isolation unit: ES runs seats as subagents inside one OpenCode process under bubblewrap; The Agency runs one container per expert with its own tools and MCP servers.

| The Agency | Epistemic Swarm | Convergence path |
|---|---|---|
| Mission | Task DAG in es-fleet | Same model already; swap the scheduler |
| Task states, dependency triggers, failure policies | `pending`, `ready`, `running`, `waiting-human`, `done`, `failed`, `cancelled`; `all_success`, `one_success`; `fail`, `retry`, `replan` | Identical by design |
| `fleet/<taskId>`, `fleet/integration/<missionId>`, `refs/fleet-salvage/<taskId>` | The same names, with `<dagId>` | Identical by design |
| Landing: verify, then `--no-ff` merge in a throwaway worktree | `landTask`: gates, then the same merge | Swap the implementation |
| Verify step running declared checks | Mechanical gates in `es-core` (format, lint, typecheck, affected tests, secrets, OSV, budgets) | Replace the runner with es-core gates |
| Playbooks | Factory stages (Grill, Research, Spec, Build and QA, Release) | Playbooks can become stage presets |
| `qa-functional`, `qa-adversarial`, architect tiebreak | `qa-functional`, `qa-adversarial`, manager tiebreak | Same roles |
| Plain approvals from an allowlist | Human-only approvals signed with a sealed key | Adopt signing |
| Ceiling field present but unenforced | Mandatory positive ceiling per task | Enforce when billing is per token |

This mapping comes from ES's README, `SYSTEM_ARCHITECTURE.md`, and `docs/FLEET.md`. I did not read its source or test its APIs, so each convergence step needs its own check before it is relied on.

### 3.4 Other side projects

| Project | Fit | Adopt when |
|---|---|---|
| `scraper-swarm` | The fleet's web access: an MCP gateway with scoped keys, SSRF checks, and its own egress proxy | Its v1 MCP contract is stable. It then replaces built-in `webfetch` and `websearch`. |
| `claude-4-opencode` | A source of skills from Claude Code plugins | Later and opt-in: baked into images at build time, pinned, per-expert allowlist, plugin hooks and plugin MCP servers off by default |
| `opencode-rea` | A reverse-engineering expert pack | It runs headless with `runtime` set to `allow` or `deny` (its default is `ask`), has a container recipe, and tests on the pinned OpenCode version |
| `godot-opencode` | A Godot expert pack | The same conditions, plus a headless Godot editor in the image |
| `GDevelop-Unlocked` | Only its `opencode-gdevelop` plugin, as an expert pack | The same conditions. The patch stack that removes GDevelop's premium gating stays out of The Agency's distribution. |

### 3.5 Consequences and new risks

| Item | Why it matters | Handling |
|---|---|---|
| Go usage caps ($12 per 5 hours, $30 per week, $60 per month) | A feature mission is at least seven sessions. By the Go docs' estimates Kimi K3 gets about 110 requests per window and DeepSeek V4 Flash about 31,000, so the model choice decides whether the fleet can stay busy. | The eval suite compares candidate models before anything else is tuned. |
| No spend ceiling | Safe on Go, which is flat-rate. On a pay-as-you-go Zen key nothing in the fleet bounds spend. | If a Zen key is used, set a workspace monthly limit and disable auto-reload in the Zen console. Task timeouts, step caps, and the rework cap still apply. |
| The real key is in every expert | A prompt injection could try to send it elsewhere. | Experts have no direct route out; the allowlist proxy is the only exit. |
| The nested daemon | The environment runner needs elevated privileges for that one container. | Only the Dispatcher can call it; experts never reach a daemon. |
| Remaining Go quota may not be queryable | Schedule headroom depends on knowing it. | The Dispatcher keeps its own usage account and learns from limit errors. To be checked in the first spike. |
| Waking the Director needs its session id | MCP calls do not carry it. | Correlate the Director's tool-call events with the mission id; fall back to polling. To be checked in the first spike. |
| Proxy variables in v2 | Only the v1-era docs state that OpenCode honors them. | The internal network enforces the route regardless; the spike confirms provider calls work through the proxy. |
| Size | The build is several times the first draft. | Four staged prompts in `docs/prompts/`, each proven before the next. |

---

## Sources

- [Epistemic Swarm (IUMBTEMS)](https://github.com/Heretek-AI/IUMBTEMS), [scraper-swarm](https://github.com/Heretek-AI/scraper-swarm), [claude-4-opencode](https://github.com/Heretek-AI/claude-4-opencode), [opencode-rea](https://github.com/Heretek-AI/opencode-rea), [godot-opencode](https://github.com/Heretek-AI/godot-opencode), [GDevelop-Unlocked](https://github.com/Heretek-AI/GDevelop-Unlocked) (READMEs and top-level docs only).
- OpenCode Go and Zen: `review/opencode/packages/web/src/content/docs/go.mdx` and `zen.mdx`; key handling in `packages/core/src/plugin/provider/opencode.ts`.
- Local source: `review/opencode` (paths cited inline).
- [OpenCode v2 migration guide](https://opencode.ai/v2/docs/migrate-v1/)
- [OpenCode ecosystem page](https://opencode.ai/docs/ecosystem/)
- [Happier issue #414: v2 removed the v1 server API](https://github.com/happier-dev/happier/issues/414)
- [oc-remote issue #42: support OpenCode v2 servers](https://github.com/crim50n/oc-remote/issues/42)
- [awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators)
- [Paperclip](https://github.com/paperclipai/paperclip), [adapters overview](https://docs.paperclip.ing/adapters/overview), [OpenCode adapter](https://docs.paperclip.ing/adapters/opencode-local)
- [Multica](https://github.com/multica-ai/multica)
- [agent-swarm](https://github.com/desplega-ai/agent-swarm)
- [Paseo](https://github.com/getpaseo/paseo)
- [OpenChamber](https://github.com/openchamber/openchamber), [opencode-manager](https://github.com/chriswritescode-dev/opencode-manager)
- [Vibe Kanban status summary](https://aiidelist.com/ide/vibe-kanban)
- [Gas Town coverage, The New Stack](https://thenewstack.io/steve-yegges-ai-agent-orchestration-project-gas-town-comes-to-the-cloud-and-brings-the-wasteland-with-it/)
