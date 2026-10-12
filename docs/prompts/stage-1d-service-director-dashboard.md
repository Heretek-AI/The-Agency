# Stage 1d — Dispatcher service, Director, gateway, and dashboard

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** `docs/reports/stage-1c.md` and its verification report exist with a PASS verdict. Work on branch `stage-1d-service`.

## Goal of this stage

Put a service in front of the engine and a Director in front of the service, so a person can ask for a change and get verified commits.

At the end of this stage a person opens the Director's web UI, asks for a change to the demo repository, and gets verified commits on `fleet/integration/<missionId>`, while watching the mission on a dashboard. This completes Stage 1 of the original design (issue #1).

## Not in this stage

Playbooks, the QA judges, per-task environment stacks (stages 2a and 2b). Multiple repositories, onboarding, GitHub, schedules, Discord (stages 3a and 3b). Extended experts, on-demand start, evals, packs (stage 4).

## Ask the user

Nothing new.

## Step 1 — MCP tools

`dispatcher/src/mcp.ts` serves the `fleet` MCP server on `/mcp` (Streamable HTTP, or the spike's fallback for question 14), bearer `FLEET_MCP_TOKEN`. Each tool calls the engine API from Stage 1c and nothing else. Every result is bounded in size and says where the full data is.

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

Tests, with an MCP client against the server and the fake OpenCode behind the engine: each tool's happy path; each validation failure of `fleet_plan_submit`; a call without the token is refused; an oversized result is truncated and names the full path; `fleet_mission_close` is refused while a land task is unlanded.

**Accept:** the tests pass.

## Step 2 — REST and events

`dispatcher/src/http.ts`. Admin password on everything except `GET /healthz`.

`GET /api/fleet`, `GET|POST /api/missions`, `GET /api/missions/:id`, `GET /api/missions/:id/events` (SSE), `POST /api/missions/:id/approve`, `POST /api/missions/:id/reject`, `POST /api/missions/:id/cancel`, `GET /api/tasks/:id`, `GET /api/tasks/:id/diff`, `GET /api/tasks/:id/artifacts/*`, `POST /api/gc`.

- `/healthz` reports healthy only when the store is open, the audit log verifies, and the contract assertion passed for every enabled expert. It is computed, not a constant.
- The artifacts route resolves paths and refuses anything outside `/artifacts/<taskId>/`.
- `dispatcher/src/main.ts` is the entrypoint: load config, open the store and audit log, assert the contract, run recovery, start the engine loop, then listen. If any step fails, exit non-zero with the reason.

Tests: each route; no password gives 401; a path traversal on the artifacts route is refused; `Dispatcher refuses to start without each credential` (one case per variable in shared context 9.13); `/healthz` turns unhealthy when an expert's contract assertion fails.

Add the Dispatcher service to the renderer's compose output: networks `fleet` and `outside`, limits and hardening, a healthcheck on `/healthz`, no published port. Set `FLEET_MCP_TOKEN` for the Director so its `fleet` server is enabled.

**Accept:** the tests pass; the Dispatcher container reaches healthy with `make up`.

## Step 3 — Director

**`dispatcher/src/director.ts`.** Creates a Director session for a mission that has none, correlates chat missions to their session (the spike's answer to question 11), and sends wake-ups.

**Wake-ups.** When a task reaches a terminal state or a mission needs a decision, send the Director's session a queued prompt: `[fleet] Task <id> (<expert>, <role>) is <status>. Mission <missionId> needs your attention; call fleet_mission_get.` If the session id is unknown, the Director uses `fleet_wait`.

**`experts/director/config/agents/director.md`.** Finish the persona started in Stage 1b. It must cover:

- **Identity.** You lead missions. You do not write code. Your tools are reading the repository and the `fleet_*` tools.
- **Start.** Call `fleet_roster` and `fleet_mission_create`. Read enough of the repository to plan. If the request is ambiguous in a way that changes the plan, ask one concise question; otherwise proceed.
- **Planning.** Each task has one owner, paths inside that owner's grant, and acceptance criteria that can be checked. Tell the person the plan in a few lines, then `fleet_plan_submit`.
- **Briefs.** A brief stands alone; the expert sees nothing of this conversation.
- **Waiting.** After submitting, stop. You will be woken by a `[fleet]` message. On waking, call `fleet_mission_get` and act on what changed.
- **Deciding.** Read `fleet_task_result` first and `fleet_task_diff` only for what you need to check. Do not accept a task whose verification shows failures, whose status is `blocked`, or that has scope failures. Rework at most twice, then tell the person.
- **Handoffs.** Turn each handoff line into a new task in the plan.
- **Report.** When the mission's tasks have landed, call `fleet_mission_close` and tell the person what was done, where it is, what was verified and by what, and what is open. Do not claim something was tested unless a verify result or an expert's report shows it.

Write `config/skills/` for the Director's five skills in `fleet.yaml` as real procedures.

**Accept:** check `06` below.

## Step 4 — Gateway and dashboard

**Gateway** (`gateway/Caddyfile`): `agency.localhost` to the Dispatcher; `<name>.agency.localhost` to `<name>:4096`, using one wildcard site with `{http.request.host.labels.2}` as the upstream if that works, otherwise one generated block per expert. Response buffering off so SSE passes through. The gateway is the only service that publishes a port: `127.0.0.1:${AGENCY_HTTP_PORT}:8080`. Provide `docker-compose.ports.yml` as a fallback that publishes each expert on a loopback port in the 41xx range. Pin the Caddy image by digest.

**Dashboard** (`dispatcher/web/`, a small Preact or React app built into the Dispatcher image):

- a fleet view: health, version, load, a link to each expert's own UI;
- a missions list;
- a mission page: objective, plan, task graph with states, decision log, approve and reject when it is waiting;
- a task page: brief, live transcript, parsed block, verify results, diff viewer, artifacts;
- a form to start a mission by hand.

Escape everything that came from a model, a repository, or a person before rendering it.

Finish the `make` targets: `init`, `render`, `render-check`, `workspace`, `build`, `up`, `down`, `ps`, `logs`, `smoke`, `test`, `e2e`, `gc`, `accept`. No target is a stub after this stage.

**Accept:** through the gateway the dashboard loads, lists experts and missions, streams a running task, and renders a diff; `director.agency.localhost:${AGENCY_HTTP_PORT}` serves the OpenCode web app.

## Step 5 — Live acceptance through REST

Write `scripts/accept/1d/` checks that drive the running fleet through the REST API, with a real key. Each check asserts on state the fleet produced; none writes into the workspace.

1. A `scout` task completes with a report.
2. A `docs` task lands on the integration branch after verify passes.
3. A task whose change breaks the linter fails at verify and merges nothing. Arrange this through the brief ("change the indentation of `src/index.js` to tabs"), not by editing files from the check.
4. Two tasks that are each green but break the tests together are caught by the post-merge verify, and the integration branch is reset. Use a fixture designed for this in `fixtures/` and say in its README how it produces the collision.
5. A `docs` task told to edit `src/` ends with the edit refused or the task failed for `scope`, and does not hang.
6. Killing and restarting the Dispatcher container mid-task ends with the task collected.

**Accept:** all six pass with a real key.

## Step 6 — End to end

`scripts/e2e.sh` (`make e2e`): on the demo repository, ask the Director, through its API, to "add a `/health` endpoint that returns the app version, with a test, and document it in the README". Assert:

- tasks went to at least `backend` and `docs`;
- their commits are on `fleet/integration/<missionId>` with the trailers;
- verify results are recorded and green for each landing;
- the demo repository's tests pass on that branch, run by the verifier;
- the endpoint's source and the README text exist on that branch and were written by expert sessions;
- the audit log verifies and contains the chain from `mission.created` to `mission.closed`.

The script fails on the first unmet assertion. With no key it prints `SKIP` and exits 77.

**Accept:** `make e2e` exits 0 with a real key.

## Acceptance checks for this stage

Under `scripts/accept/1d/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` exits 0. |
| `02-up-healthy` | Twelve experts, the proxy, the verifier, the Dispatcher, and the gateway are healthy. |
| `03-only-gateway-published` | The only host port binding in the project is the gateway's, on `127.0.0.1`. |
| `04-credentials-required` | The Dispatcher container exits non-zero when each credential is unset in turn. |
| `05-auth` | REST without the admin password, MCP without the token, and an expert UI without its password are each refused. |
| `06-director-scout` | Through the Director's API, "ask the scout which languages this repository uses and tell me" produces a mission, a completed task, and an answer that reflects the scout's report. The Director is idle, not polling, while the task runs (if spike question 11 allowed it). |
| `07` to `12` | The six live checks of step 5. |
| `13-e2e` | Step 6. |
| `14-dashboard` | Through the gateway: the dashboard returns the fleet and mission lists as data from the API, and the Director's host serves the OpenCode web app. |
| `15-audit-chain` | After the checks above, the audit log verifies and every landed commit's audit tip is found in it. |
| `16-stage-1-register` | Every guard in the defect register with a stage of 1d or earlier exists and passed. |

Checks `06` to `13` skip only without a provider key. If they skip, Stage 1 is not complete; the report says the end-to-end run was not performed.

Red proofs worth the effort: stop the verifier during `08`; remove the `docs` expert's grant for `08`; set the admin password empty for `04`; kill the Dispatcher and do not restart it for `12`.

## Report

Write `docs/reports/stage-1d.md` in the format of shared context 4.4, and add:

- the fifteen spike answers and fallbacks in force, restated;
- MCP servers left out or disabled;
- the commands for a first run:

```
make init
$EDITOR .env.provider .env        # OPENCODE_API_KEY, AGENCY_MODEL
make workspace ARGS="demo --demo"
make build && make up && make smoke
open http://agency.localhost:$AGENCY_HTTP_PORT            # dashboard
open http://director.agency.localhost:$AGENCY_HTTP_PORT   # the Director (user: opencode, password: PW_DIRECTOR in .env)
```

Then stop.
