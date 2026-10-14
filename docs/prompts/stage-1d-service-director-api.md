# Stage 1d — Dispatcher service, Director, gateway, and control plane API

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** `docs/reports/stage-1c.md` and its verification report exist with a PASS verdict. Work on branch `stage-1d-service`.

## Goal of this stage

Put a robust production daemon in front of the engine, the Director in front of the service, configure Caddy gateway routing, and expose the complete authenticated REST and SSE control plane—including the Director chat proxy and role-aware access controls—that the upcoming Web UI (Stage 1e) will consume.

At the end of this stage, all operations (planning, dispatching, chat proxying, plan editing, and role authorization) are fully operational and verified through live REST/SSE calls against the real fleet.

## Not in this stage

The React Web UI (built in Stage 1e conforming to `docs/prompts/ui-spec.md`). Playbooks and QA judges (Stage 2a). Environment stacks (Stage 2b). Multi-repo triggers, GitHub poller, Discord (Stages 3a and 3b). Extended experts (Stage 4a).

## Ask the user

Nothing new.

## Step 1 — MCP tools

`dispatcher/src/mcp.ts` serves the `fleet` MCP server on `/mcp` (Streamable HTTP), bearer `FLEET_MCP_TOKEN`. Each tool calls the engine API from Stage 1c and nothing else. Every result is bounded in size and says where the full data is.

| Tool | Input | Effect |
|---|---|---|
| `fleet_roster` | — | Experts with description, handles, delegates, access, health, and load. |
| `fleet_mission_create` | `objective`, `repo?` | Creates a mission in `planning`. Returns `missionId` and the repository's ownership map summary. |
| `fleet_plan_submit` | `missionId`, `tasks[]` each with `key`, `expert`, `title`, `objective`, `context`, `constraints`, `acceptance[]`, `paths[]`, `deps[]` | Validates (experts exist, paths fall inside each expert's grant, the graph is acyclic), expands the plan, and either starts it or parks the mission as `waiting-human` when it exceeds `planApprovalAbove`. |
| `fleet_mission_get` | `missionId` | Objective, plan, every task's status and reason, decisions. This is how the Director recovers after a compaction. |
| `fleet_task_result` | `taskId` | Parsed block, report text (truncated, with the path of the full text), changed files, commits, policy flags, rejected permissions, verify results, artifacts. |
| `fleet_task_diff` | `taskId`, `file?`, `maxBytes?` | Bounded unified diff. |
| `fleet_decide` | `taskId`, `decision: "accept" \| "rework" \| "abandon"`, `notes` | As `engine.decide`. Every decision is appended to the mission's log. |
| `fleet_wait` | `missionId`, `timeoutSec` (at most 600) | Returns when anything in the mission changes. |
| `fleet_mission_close` | `missionId`, `summary` | Marks the mission `done` and stores the Director's report. Refused unless the definition of done in shared context 4.5 holds. |

Tests with an MCP client against the server and fake OpenCode behind the engine: each tool's happy path; validation failures; missing token refused; truncation of oversized output; `fleet_mission_close` refused while land task unlanded.

**Accept:** the tests pass.

## Step 2 — REST, SSE, auth and chat proxy

`dispatcher/src/http.ts`. Authentication and authorization are enforced on every route except `GET /healthz` and `POST /api/auth/login`.

### Authentication & Roles
- Backed by accounts in `state/registry/allowlist.yaml` (seeded with `admin`, `approver`, and `viewer` accounts with argon2-hashed passwords).
- Supports session cookies and `Authorization: Bearer <token>` headers.
- Roles enforced:
  - `viewer`: read-only access to fleet, missions, tasks, artifacts, chat streams.
  - `approver`: all viewer access + `approve`, `reject`, `cancel`, `PUT /api/missions/:id/plan`, and `decide`.
  - `admin`: all approver access + system GC, container lifecycle, and settings.
- `POST /api/auth/login` `{ username, password }` sets session cookie and returns user profile with role.
- `POST /api/auth/logout` clears session.
- `GET /api/auth/me` returns current user session.

### Mission & Task Routes
`GET /api/fleet`, `GET|POST /api/missions`, `GET /api/missions/:id`, `GET /api/missions/:id/events` (SSE), `POST /api/missions/:id/approve`, `POST /api/missions/:id/reject`, `POST /api/missions/:id/cancel`, `PUT /api/missions/:id/plan` (allows approver/admin to adjust work items while in `waiting-human`), `GET /api/tasks/:id`, `GET /api/tasks/:id/diff`, `GET /api/tasks/:id/artifacts/*`, `POST /api/gc`.

### Director Chat Proxy Routes
These allow the unified Web UI (built in Stage 1e) to communicate with the Director without bypassing Dispatcher security:
- `POST /api/missions/:id/chat`: `{ message }`. Relays the user message to the mission's Director session via `POST /api/session/{directorSessionId}/prompt`.
- `GET /api/missions/:id/chat`: Returns the formatted transcript messages from the Director's session.
- `GET /api/missions/:id/chat/events`: SSE stream of text deltas and tool execution updates from the Director session.

### Health & Entrypoint
- `GET /healthz` reports healthy only when the store is open, the audit log verifies, and contract assertions pass for every enabled expert.
- The artifacts route resolves paths and refuses anything outside `/artifacts/<taskId>/`.
- `dispatcher/src/main.ts` is the entrypoint: load config, open store and audit log, assert contracts, run recovery, start engine loop, and listen on port 8080.

Tests: each route; unauthenticated requests get 401; viewer attempting approval gets 403; path traversal on artifacts refused; Dispatcher refuses startup if any credential is missing; `/healthz` becomes unhealthy if expert contract fails; chat proxy correctly relays prompts and streams SSE events.

**Accept:** the tests pass; the Dispatcher container reaches healthy with `make up`.

## Step 3 — Director

**`dispatcher/src/director.ts`.** Creates a Director session for a mission that has none, correlates chat missions to their session (the spike's answer to question 11), and sends wake-ups.

**Wake-ups.** When a task reaches a terminal state or a mission needs a decision, send the Director's session a queued prompt: `[fleet] Task <id> (<expert>, <role>) is <status>. Mission <missionId> needs your attention; call fleet_mission_get.` If the session id is unknown, the Director uses `fleet_wait`.

**`experts/director/config/agents/director.md`.** Finish the persona started in Stage 1b. It must cover:
- **Identity.** You lead missions. You do not write code. Your tools are reading the repository and the `fleet_*` tools.
- **Start.** Call `fleet_roster` and `fleet_mission_create`. Read enough of the repository to plan. If ambiguous, ask one concise question; otherwise proceed.
- **Planning.** Each task has one owner, paths inside that owner's grant, and checkable acceptance criteria. Tell the person the plan in a few lines, then `fleet_plan_submit`.
- **Briefs.** A brief stands alone; the expert sees nothing of this conversation.
- **Waiting.** After submitting, stop. You will be woken by a `[fleet]` message. On waking, call `fleet_mission_get` and act on what changed.
- **Deciding.** Read `fleet_task_result` first and `fleet_task_diff` only when needed. Do not accept a task with verification failures, blocked status, or scope failures. Rework at most twice, then report.
- **Handoffs.** Turn each handoff line into a new task in the plan.
- **Report.** When tasks have landed, call `fleet_mission_close` and report what was done, where it is, what was verified, and what remains open.

Write `config/skills/` for the Director's five skills in `fleet.yaml` as real procedures.

**Accept:** check `06` below.

## Step 4 — Gateway

**Gateway** (`gateway/Caddyfile`):
- `agency.localhost` routes to Dispatcher at `dispatcher:8080`.
- `<name>.agency.localhost` routes to `<name>:4096` using host label routing.
- Response buffering disabled (`flush_interval -1`) so SSE streams pass without buffering.
- Gateway publishes only on `127.0.0.1:${AGENCY_HTTP_PORT}:8080`.
- Provide `docker-compose.ports.yml` fallback publishing experts on loopback ports in 41xx range.
- Caddy image pinned by digest.

Finish `make` targets: `init`, `render`, `render-check`, `workspace`, `build`, `up`, `down`, `ps`, `logs`, `smoke`, `test`, `e2e`, `gc`, `accept`.

**Accept:** `agency.localhost:${AGENCY_HTTP_PORT}/healthz` returns healthy; `director.agency.localhost:${AGENCY_HTTP_PORT}` serves the OpenCode UI as debug fallback.

## Step 5 — Live acceptance through REST

Write `scripts/accept/1d/` checks that drive the running fleet through the REST API, with a real key:
1. A `scout` task completes with a report.
2. A `docs` task lands on the integration branch after verify passes.
3. A task whose change breaks the linter fails at verify and merges nothing (arranged via brief).
4. Two tasks that are each green but break tests together are caught by post-merge verify, and the branch is reset.
5. A `docs` task told to edit `src/` ends with the edit refused or failed for `scope`.
6. Killing and restarting the Dispatcher container mid-task collects the task cleanly.
7. Role enforcement: `viewer` cannot approve plans or mutate state; `approver` can approve and edit plans.
8. Director chat proxy: prompt relayed to Director session and SSE token stream received.

**Accept:** all checks pass with a real key.

## Step 6 — End to end

`scripts/e2e.sh` (`make e2e`): on the demo repository, ask the Director, through its API, to "add a `/health` endpoint that returns the app version, with a test, and document it in the README". Assert:
- Tasks dispatched to at least `backend` and `docs`.
- Commits are on `fleet/integration/<missionId>` with trailers.
- Verify results recorded and green for each landing.
- Tests pass on that branch, run by the verifier.
- Endpoint source and README text exist on branch.
- Audit log verifies and contains full chain from `mission.created` to `mission.closed`.

**Accept:** `make e2e` exits 0 with a real key.

## Acceptance checks for this stage

Under `scripts/accept/1d/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` exits 0. |
| `02-up-healthy` | Twelve experts, proxy, verifier, Dispatcher, and gateway are healthy. |
| `03-only-gateway-published` | The only host port binding is gateway on `127.0.0.1`. |
| `04-credentials-required` | Dispatcher exits non-zero when each credential is unset in turn. |
| `05-auth-and-roles` | Unauthenticated requests get 401; viewer role is blocked from approvals with 403; approver succeeds. |
| `06-director-scout` | Through Director API, asking scout for repository languages creates mission, task, and accurate response. |
| `07` to `12` | The six live checks of step 5. |
| `13-e2e` | Step 6 passes. |
| `14-director-chat-proxy` | Chat proxy sends message to Director session and receives streaming SSE events. |
| `15-audit-chain` | Audit log verifies and landed commits' audit tips match. |
| `16-stage-1-register` | Every guard in defect register with stage 1d or earlier passes. |

Checks `06` to `14` skip only without a provider key.

## Report

Write `docs/reports/stage-1d.md` in the format of shared context 4.4, noting that the Web UI foundation follows immediately in Stage 1e. Then stop.
