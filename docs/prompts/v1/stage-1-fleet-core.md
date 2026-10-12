# Stage 1 — Fleet core, durable missions, and the verify gate

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

## Goal of this stage

A working fleet on one machine and one repository: twelve expert containers behind an egress proxy, a Dispatcher that runs durable missions with the es-fleet task model, a non-LLM verify gate in front of every landing, a Director that plans and delegates, and a dashboard to watch it.

At the end of this stage a person opens the Director's web UI, asks for a change to the demo repository, and gets verified commits on `fleet/integration/<missionId>`.

## Not in this stage

Playbooks, the QA judges, per-task environment stacks (stage 2). Multiple repositories, onboarding, GitHub, schedules, Discord (stage 3). Extended experts, on-demand start, evals, expert packs (stage 4). Build the seams this document names so those stages add to the code instead of rewriting it.

## Ask the user

- The `OPENCODE_API_KEY` value (OpenCode Go or Zen) and the model id for `AGENCY_MODEL`.
- Docker or Podman, if both are installed.

## Step 0 — Preflight

Detect the container runtime and Compose version (2.24 or newer). Confirm OpenCode 2.0.26 is installable. Create `.gitignore`, `LICENSE` (Apache-2.0), `versions.env`, `docs/build-notes.md`, and branch `stage-1-core`.

**Accept:** the runtime is identified, versions are recorded, `review/` is ignored.

## Step 1 — Spike

Build the base image (step 2 describes it) and run one container with a minimal hand-written config: the deny-all baseline and one test agent. With `curl` or `opencode api`, exercise `/api/info`, `/openapi.json`, creating a session at a worktree directory, prompt, wait, messages, diff, and a rejected permission request. Then settle each question below and write the answer in `docs/build-notes.md`.

| # | Question | Fallback if the answer is no |
|---|---|---|
| 1 | Does `opencode serve` pick up `OPENCODE_API_KEY` from the environment, and is the `AGENCY_MODEL` id listed by `opencode models`? | `opencode auth import` in the entrypoint; correct the id |
| 2 | Can server logs reach container stdout (`--print-logs`, or tailing the data `log` directory)? | Tail the files from the entrypoint |
| 3 | Does a read-only workspace mount leave sessions, snapshots, and `session.diff` working? | Mount read-write and fail any `ro` task whose worktree changed |
| 4 | Does `serve` start with a read-only `OPENCODE_CONFIG_DIR`? | Bake config into the image, owned by root, mode `0444` |
| 5 | Is disabling the built-in `build`, `plan`, and `general` agents safe? | Mark them `hidden` |
| 6 | Is `@opencode/client@<version>` installable from npm and usable from Node? | A thin `fetch` client typed from `/openapi.json` |
| 7 | Are rules passed in `session.create`'s `permissions` evaluated after the agent's rules, so a per-task `edit` allow takes effect over the deny-all baseline? | Static `edit` globs from `fleet.yaml` |
| 8 | What does a session emit when the provider refuses a request for quota or rate limit, and does it say when the limit resets? Read `packages/schema/src/session-error.ts` and provoke an error with an invalid key to see the shape. | Treat any repeated provider refusal as a limit and probe on a timer |
| 9 | Does `Session.Info` report cost and token counts for the chosen model? | Count steps and tokens only |
| 10 | With `HTTPS_PROXY` set and no direct route out, do provider calls and remote MCP servers work? | Check `NODE_USE_ENV_PROXY` and similar switches; as a last resort allow the provider host by a routed exception and document it |
| 11 | Do the Director's SSE events for an MCP tool call carry the session id and the tool output, so the Dispatcher can match a `fleet_mission_create` call to its session? | The Director polls with `fleet_wait` |
| 12 | With project config disabled, is the repository's own `AGENTS.md` still loaded? | Nothing needed; the envelope tells the expert to read it |
| 13 | Does the web app accept `?auth_token=<base64("opencode:<password>")>` on first navigation? | Manual sign-in per expert UI |

**Accept:** `scripts/spike.sh` reproduces the session flow end to end, and every row has a recorded answer.

## Step 2 — Images, manifest, renderer

**Base image** (`images/base/Dockerfile`): `ubuntu:24.04` pinned by digest; `ca-certificates curl git jq ripgrep fd-find tini unzip xz-utils openssh-client python3`, `yq`, Node LTS, `uv`; user `agent` from build args `AGENT_UID` and `AGENT_GID`; `/work`, `/artifacts`, `/etc/agency`, and the XDG data and state directories owned by `agent`; OpenCode installed with the v2 install script at `OPENCODE_VERSION`, moved to `/usr/local/bin/opencode`, and checked with `opencode --version`; `git config --system --add safe.directory '*'` and a git identity of `<expert> (The Agency)`; entrypoint `tini -- /usr/local/bin/entrypoint.sh`.

**`entrypoint.sh`:**

1. Fail fast if `OPENCODE_PASSWORD` or `OPENCODE_API_KEY` is empty.
2. Read `/etc/agency/mcp-requirements.json`. For every MCP server whose required variables are not all set, put its complete config with `"disabled": true` into an overlay exported as `OPENCODE_CONFIG_CONTENT`. A later config document replaces a server entry whole, so the overlay must carry the full entry.
3. Apply any fallbacks the spike required.
4. `exec opencode serve --hostname 0.0.0.0 --port 4096`.

**`fleet.yaml`:** all 25 experts as in the shared context, each with an `enabled` flag. Enable twelve now: `director`, `scout`, `architect`, `product`, `frontend`, `backend`, `dba`, `platform`, `security`, `qa`, `reviewer`, `docs`.

**`mcp/registry.jsonc`:** as in the shared context.

**`scripts/render.mjs`:** from `fleet.yaml`, the registry, and `shared/templates/`, generate for each enabled expert `config/opencode.jsonc`, `config/AGENTS.md` (a copy of `shared/FLEET_PROTOCOL.md`), and `config/mcp-requirements.json`, and generate `docker-compose.yml`. Generated files carry a "GENERATED, do not edit" header. `--check` fails when generated files are stale.

**Generated `opencode.jsonc`:**

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "{env:AGENCY_MODEL}",
  "default_agent": "backend",
  "update": "disable",
  "share": "disabled",
  "snapshots": true,
  "agents": {
    "build":   { "disabled": true },
    "plan":    { "disabled": true },
    "general": { "disabled": true }
  },
  "permissions": [ /* baseline from the shared context, then MCP allows */ ],
  "mcp": {
    "timeout": { "startup": 60000, "catalog": 30000, "execution": 300000 },
    "servers": { /* inlined from mcp/registry.jsonc */ }
  }
}
```

**Per expert, hand-written:** `experts/<name>/Dockerfile` (`FROM agency-base`, that expert's pinned tools, browsers installed at build time), `config/agents/<name>.md` (`mode: primary`, a `description`, the persona as the body), and two to four skills.

**Accept:** `make render-check` passes; `docker compose config -q` passes; all twelve images build.

## Step 3 — Networks and the egress proxy

- Network `fleet` is `internal: true`. Experts attach only to it.
- Network `outside` is a normal bridge. The egress proxy, the Dispatcher, the verifier, and the gateway attach to both.
- `egress/`: a forward proxy with a global allowlist (`egress/allowlist.txt`: `opencode.ai`, the package registries the toolchains use, the remote MCP hosts in the registry, and a documented list of documentation hosts) plus per-expert additions from `fleet.yaml`. Identify the caller by per-expert proxy credentials or a fixed address, and log every allowed and denied request with the expert's name. Choose the proxy software yourself (Squid and Smokescreen both fit) and record why.
- Each expert gets `HTTP_PROXY`, `HTTPS_PROXY`, and a `NO_PROXY` listing loopback and the fleet's internal service names.

**Compose service shape** (generated; one per enabled expert):

```yaml
x-expert: &expert
  restart: unless-stopped
  working_dir: /work
  networks: [fleet]
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  pids_limit: 1024
  healthcheck:
    test: ["CMD-SHELL", "curl -fsS --noproxy '*' -u opencode:$$OPENCODE_PASSWORD http://127.0.0.1:4096/api/info >/dev/null"]
    interval: 15s
    timeout: 5s
    retries: 10
    start_period: 30s

services:
  backend:
    <<: *expert
    build:
      context: .
      dockerfile: experts/backend/Dockerfile
      args: { OPENCODE_VERSION: "${OPENCODE_VERSION}", AGENT_UID: "${AGENT_UID}", AGENT_GID: "${AGENT_GID}" }
    environment:
      OPENCODE_CONFIG_DIR: /etc/agency
      OPENCODE_DISABLE_PROJECT_CONFIG: "1"
      OPENCODE_CLIENT: agency
      OPENCODE_PASSWORD: ${PW_BACKEND}
      AGENCY_MODEL: ${AGENCY_MODEL}
      HTTP_PROXY: http://backend:${PROXY_PW_BACKEND}@egress:3128
      HTTPS_PROXY: http://backend:${PROXY_PW_BACKEND}@egress:3128
      NO_PROXY: localhost,127.0.0.1,dispatcher,verifier
    env_file:
      - path: .env.provider          # OPENCODE_API_KEY
        required: true
      - path: secrets/backend.env
        required: false
    volumes:
      - ./experts/backend/config:/etc/agency:ro,z
      - ${AGENCY_WORKSPACE:-./workspace}:/work:rw,z     # ":ro,z" for ro experts
      - artifacts:/artifacts
      - backend-data:/home/agent/.local/share/opencode
      - backend-state:/home/agent/.local/state/opencode
      - backend-cache:/home/agent/.cache
    cpus: 2
    mem_limit: 4g
```

Use `:z` on bind mounts (the development host is Fedora with SELinux). For rootless Podman add `userns_mode: "keep-id"` to services with bind mounts. Browser experts get `shm_size: 1g` and `mem_limit: 6g`. Only the gateway publishes a port, as `127.0.0.1:8080:8080`.

**Accept:** `make up` brings all twelve experts to healthy. From inside an expert, a request to an allowlisted host succeeds, a request to any other host fails, and both appear in the proxy log under that expert's name. `scripts/smoke.sh` confirms for each expert that `/api/agent` lists its persona, `/api/skill` lists its skills, `/api/mcp` shows every server connected or disabled with none failed, and the OpenCode log contains no line with `configuration normalization diagnostic`.

## Step 4 — Workspace and a minimal registry

- `scripts/workspace-init.sh <repoId> <git-url | path | --demo>` clones into `workspace/<repoId>/repo` and creates `trees/` and `landing/`. `--demo` copies `fixtures/demo-repo` (a small HTTP service with tests, a linter, and a formatter) and runs `git init`. It refuses repositories with submodules or LFS for now and says why.
- `state/registry/<repoId>/` holds the control files. In this stage they are written by hand for the demo repository, with examples under `registry.example/`:

```yaml
# repo.yaml
id: demo
defaultBranch: main
planApprovalAbove: 3        # tasks; plans larger than this wait for a human

# ownership.yaml
version: 1
experts:
  backend: { writes: ["src/*"] }
  qa:      { writes: ["tests/*", "*.test.*"] }
  docs:    { writes: ["README*", "docs/*"] }
shared:    ["package.json", "pnpm-lock.yaml"]     # allowed for any scoped expert, flagged for review
protected: [".github/*"]                          # no expert may change these

# checks.yaml
version: 1
setup:  ["pnpm install --frozen-lockfile"]
checks:
  - { id: format,    run: "pnpm format:check", timeoutSec: 300 }
  - { id: lint,      run: "pnpm lint",         timeoutSec: 300 }
  - { id: typecheck, run: "pnpm typecheck",    timeoutSec: 600 }
  - { id: test,      run: "pnpm test",         timeoutSec: 900 }
```

The registry is mounted into the Dispatcher and the verifier only.

## Step 5 — Verifier

A non-LLM service built on the base image with the common toolchains, no provider key, `/work` read-write, and egress through the proxy for dependency installs. One endpoint, callable only by the Dispatcher with a shared secret: run a repository's `setup` and `checks` in a given directory with per-check timeouts, and return each check's exit code and duration, with full logs written to `/artifacts/<taskId>/verify/`. Package-manager stores are shared through a cache volume so each worktree does not download everything again.

Put it behind an interface in the Dispatcher (`Verifier.run(dir, checks)`). Stage 2 adds a second implementation that runs checks inside the task's environment stack.

## Step 6 — Dispatcher

TypeScript on Node 24 LTS. Dependencies: `@modelcontextprotocol/sdk` (Streamable HTTP server transport), a small HTTP framework, `yaml`, `zod`, `node:sqlite` or `better-sqlite3`, and the OpenCode client chosen in the spike. It runs as the same UID as the experts with `/work`, `/artifacts`, the registry, and `/data` mounted, and has `git`.

| Module | Responsibility |
|---|---|
| `config.ts` | `fleet.yaml`, the registry, and the environment (passwords `PW_<NAME>`, `FLEET_MCP_TOKEN`, `AGENCY_ADMIN_PASSWORD`). |
| `opencode.ts` | The only file that knows the OpenCode API: `info`, `createSession`, `prompt`, `waitIdle` (wait endpoint with a polling fallback), `interrupt`, `messages`, `diff`, `pendingPermissions`, `replyPermission`, `subscribeEvents`. On startup it fetches each expert's `/openapi.json` and asserts that every operation it uses exists. |
| `wildcard.ts` | Port of `Wildcard.match`. |
| `store.ts` | SQLite persistence for missions, tasks, decisions, and events. |
| `scheduler.ts` | The pure scheduling function from the shared context, plus one extra rule: two `expert-run` tasks whose declared `paths` overlap never run at the same time. |
| `worktrees.ts` | Allocate, inspect, release, and salvage worktrees with the branch names from the shared context. Allocation is registered before the git work and confirmed after, so a crash never leaves an untracked worktree. |
| `runner.ts` | Runs one `expert-run` task. |
| `verify.ts` | The `Verifier` interface and the stage 1 implementation. |
| `policy.ts` | Compares a task's changed paths with the ownership map. |
| `landing.ts` | The landing transaction from the shared context. |
| `plan.ts` | `expandPlan(mission, directorTasks)`: turns the Director's tasks into the full graph. In this stage it appends a `verify` task and a `land` task behind every `scoped` expert-run. Stage 2 replaces this function with the playbook engine, so keep everything else unaware of how the graph was built. |
| `director.ts` | Creates Director sessions for missions that have none, correlates chat missions to their session (spike question 11), and sends wake-up messages. |
| `limits.ts` | Classifies provider errors, pauses and resumes missions. |
| `recovery.ts` | Reconciliation on startup. |
| `mcp.ts` | The `fleet_*` tools on `/mcp`. |
| `http.ts` | REST, SSE, and the static dashboard. |

**Running an `expert-run` task:**

1. Allocate the worktree: a new branch `fleet/<taskId>` for `scoped` experts, detached for `ro` experts, from the task's `base` or the mission's integration branch.
2. Build the session permissions: for a `scoped` expert, an `edit` allow for each granted path (the expert's entry in the ownership map, plus `shared`), then an `edit` deny for each `protected` path.
3. `createSession({ title, agent, location: { directory: worktree }, permissions, metadata: { taskId, missionId } })`, then `prompt` with the task envelope.
4. While it runs: relay the session's SSE events to the task's event log and to dashboard subscribers. Every few seconds, reject any pending permission request with the message `Headless fleet: this action is outside your permissions. Continue without it or report it as blocked.` and record it.
5. Wait for idle, or interrupt at `taskTimeoutSec` and fail with reason `timeout`.
6. Collect the final message, `session.diff`, the commit list and `git diff <base>...HEAD`, and the files under `/artifacts/<taskId>/`. Commit any uncommitted changes as the Dispatcher and record that it did.
7. Parse the RESULT block; on failure send one follow-up asking for it.
8. Run the policy check. Changes outside the granted paths fail the task with reason `scope`; changes to `shared` paths are recorded as flags.
9. Mark the task `done` and wake the Director.

**Wake-ups.** When a task reaches a terminal state or a mission needs a decision, send the Director's session a queued prompt: `[fleet] Task <id> (<expert>, <role>) is <status>. Mission <missionId> needs your attention; call fleet_mission_get.` If the session id is unknown, the Director uses `fleet_wait`.

**Provider limits.** A provider refusal that looks transient is retried with backoff by re-prompting `Continue.` in the same session. A usage-limit refusal pauses every running mission: tasks are left as they are, the mission becomes `paused` with `pausedUntil` set to the reset time if the error gives one, otherwise the Dispatcher probes on a timer. On resume it re-prompts the interrupted sessions.

**Recovery.** On startup, for every task recorded as `running`: if the expert still has the session and it is busy, re-attach; if it is idle, collect; if the session is gone, fail the task with reason `lost` so its failure policy applies. Stale worktree allocations are cleaned as es-fleet does.

**MCP tools** (bearer `FLEET_MCP_TOKEN`; every result is bounded and says where the full data is):

| Tool | Input | Effect |
|---|---|---|
| `fleet_roster` | — | Experts with description, handles, delegates, access, health, and load. |
| `fleet_mission_create` | `objective`, `repo?` | Creates a mission in `planning`. Returns `missionId` and the repository's ownership map summary. |
| `fleet_plan_submit` | `missionId`, `tasks[]` each with `key`, `expert`, `title`, `objective`, `context`, `constraints`, `acceptance[]`, `paths[]`, `deps[]` | Validates (experts exist, paths fall inside each expert's grant, the graph is acyclic), expands the plan, and either starts it or parks the mission as `waiting-human` when it exceeds `planApprovalAbove`. |
| `fleet_mission_get` | `missionId` | Objective, plan, every task's status and reason, decisions. This is how the Director recovers after a compaction. |
| `fleet_task_result` | `taskId` | Parsed block, report text (truncated, with the path of the full text), changed files, commits, policy flags, rejected permissions, verify results, artifacts. |
| `fleet_task_diff` | `taskId`, `file?`, `maxBytes?` | Bounded unified diff. |
| `fleet_decide` | `taskId`, `decision: "accept" \| "rework" \| "abandon"`, `notes` | `accept` releases the task's verify and land steps. `rework` sends the notes into the same session and increments `attempts`. `abandon` salvages the branch. Every decision is appended to the mission's log. |
| `fleet_wait` | `missionId`, `timeoutSec` (at most 600) | Returns when anything in the mission changes. |
| `fleet_mission_close` | `missionId`, `summary` | Marks the mission `done` and stores the Director's report. |

**REST** (admin password; `GET /healthz` is open): `GET /api/fleet`, `GET|POST /api/missions`, `GET /api/missions/:id`, `GET /api/missions/:id/events` (SSE), `POST /api/missions/:id/approve`, `POST /api/missions/:id/reject`, `POST /api/missions/:id/cancel`, `GET /api/tasks/:id`, `GET /api/tasks/:id/diff`, `GET /api/tasks/:id/artifacts/*`, `POST /api/gc`.

**Accept:** `make test` passes (scheduler, wildcard, plan expansion, policy, landing, and recovery are unit-tested against a fake OpenCode server and temporary git repositories). Against the live fleet through REST: a `scout` task completes with a report; a `docs` task lands on the integration branch after verify passes; a task whose change breaks the linter fails at verify and merges nothing; two tasks that are each green but break the tests together are caught by the post-merge verify, and the integration branch is reset; a `docs` task told to edit `src/` ends with the edit refused or the task failed for `scope`, without hanging; killing and restarting the Dispatcher mid-task ends with the task collected.

## Step 7 — Director

`experts/director/config/agents/director.md` must cover:

- **Identity.** You lead missions. You do not write code. Your tools are reading the repository and the `fleet_*` tools.
- **Start.** Call `fleet_roster` and `fleet_mission_create`. Read enough of the repository to plan. If the request is ambiguous in a way that changes the plan, ask one concise question; otherwise proceed.
- **Planning.** Each task has one owner, paths inside that owner's grant, and acceptance criteria that can be checked. Tell the person the plan in a few lines, then `fleet_plan_submit`.
- **Briefs.** A brief stands alone; the expert sees nothing of this conversation.
- **Waiting.** After submitting, stop. You will be woken by a `[fleet]` message. On waking, call `fleet_mission_get` and act on what changed.
- **Deciding.** Read `fleet_task_result` first and `fleet_task_diff` only for what you need to check. Do not accept a task whose verification shows failures, whose status is `blocked`, or that has scope failures. Rework at most twice, then tell the person.
- **Handoffs.** Turn each handoff line into a new task in the plan.
- **Report.** When the mission's tasks have landed, call `fleet_mission_close` and tell the person what was done, where it is, what was verified and by what, and what is open. Do not claim something was tested unless a verify result or an expert's report shows it.

**Accept:** through the Director's API, "ask the scout which languages this repository uses and tell me" produces a mission, a completed task, and an answer that reflects the scout's report. The Director is idle, not polling, while the task runs (if spike question 11 allowed it).

## Step 8 — Gateway and dashboard

- **Gateway** (`gateway/Caddyfile`): `agency.localhost` to the Dispatcher; `<name>.agency.localhost` to `<name>:4096`, using one wildcard site with `{http.request.host.labels.2}` as the upstream if that works, otherwise one generated block per expert. Response buffering off so SSE passes through. Provide `docker-compose.ports.yml` as a fallback that publishes each expert on `127.0.0.1:41xx`.
- **Dashboard** (`dispatcher/web/`, a small Preact or React app built into the Dispatcher image): a fleet view (health, version, load, a link to each expert's own UI); a missions list; a mission page (objective, plan, task graph with states, decision log, approve and reject when it is waiting); a task page (brief, live transcript, parsed block, verify results, diff viewer, artifacts); a form to start a mission by hand.
- `make` targets: `init`, `render`, `render-check`, `workspace`, `build`, `up`, `down`, `ps`, `logs`, `smoke`, `test`, `e2e`, `gc`.
- `scripts/init-env.sh` creates `.env` (host UID and GID, random secrets for every password and token) and `.env.provider` (placeholder for `OPENCODE_API_KEY`), mode `0600`, never overwriting.

**Accept:** through the gateway the dashboard loads, lists experts and missions, streams a running task, and renders a diff; `director.agency.localhost:8080` serves the OpenCode web app.

## Step 9 — End to end

`scripts/e2e.sh`: on the demo repository, ask the Director to "add a `/health` endpoint that returns the app version, with a test, and document it in the README". Assert that tasks went to at least `backend` and `docs`; that their commits are on `fleet/integration/<missionId>`; that verify results are recorded and green for each landing; and that the demo repository's tests pass on that branch.

**Accept:** `make e2e` passes with a real key. Without one, every other check in this stage passes and the report says the end-to-end run was not performed.

## Report

Reply with: what was built per step and the commit for each; every acceptance check with the command and its result; the thirteen spike answers; deviations and why; MCP servers left out or disabled; anything not tested, stated as not tested; and the commands for a first run:

```
make init
$EDITOR .env.provider .env        # OPENCODE_API_KEY, AGENCY_MODEL
make workspace ARGS="demo --demo"
make build && make up && make smoke
open http://agency.localhost:8080            # dashboard
open http://director.agency.localhost:8080   # the Director (user: opencode, password: PW_DIRECTOR in .env)
```
