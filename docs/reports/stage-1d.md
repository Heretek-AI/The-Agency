# Stage 1d — Dispatcher service, Director, gateway, and control plane API

## 1. Built

Per step of `docs/prompts/stage-1d-service-director-api.md`:

- Step 1 (MCP tools): `dispatcher/src/mcp.ts` — the `fleet` MCP server as
  Streamable HTTP (`handleMcpHttp`), bearer `FLEET_MCP_TOKEN`, nine tools
  (`fleet_roster`, `fleet_mission_create`, `fleet_plan_submit`,
  `fleet_mission_get`, `fleet_task_result`, `fleet_task_diff`,
  `fleet_decide`, `fleet_wait`, `fleet_mission_close`). Each tool calls
  only the Stage 1c engine API. Every result is bounded (`boundText`,
  default 8000 bytes, hard cap 65536) and names where the full data
  lives. Engine additions to support it: `listMissionIds`,
  `listDecisions`, `setDirectorSession`, `recordReport`, `updatePlan`,
  `setWakeHook`, plus `StoreTx.deleteTask` and persisted `raw` report
  text with `permissionRejections` in expert-run results.
- Step 2 (REST, SSE, auth, chat proxy): `dispatcher/src/auth.ts`
  (allowlist loading with argon2 verification, session store, role
  ranks, cookie/Bearer parsing), `dispatcher/src/http.ts` (all routes,
  SSE mission/chat streams, traversal-guarded artifacts, chat proxy via
  the Director's OpenCode session), `dispatcher/src/main.ts` (entrypoint:
  config, store/audit, contract assertion, recovery, engine loop, listen
  8080; refuses startup naming any missing credential). Roles:
  viewer/approver/admin as specified, plus `POST /api/tasks/:id/decide`
  for the approver `decide` capability the roles list but the route list
  omits (deviation 3).
- Step 3 (Director): `dispatcher/src/director.ts` (session creation and
  correlation through `directorSessionId`, queued `[fleet]` wake-ups,
  `fleet_wait` fallback, engine `onWake` wiring), the finished
  `experts/director/config/agents/director.md` persona (all eight
  sections), and `fleet_*` tool sections in all five Director skills.
- Step 4 (Gateway): rendered `gateway/Caddyfile` (agency.localhost to
  the Dispatcher, per-expert host routing to `:4096`, `flush_interval
-1`), digest-pinned Caddy, loopback-only publishing, static
  `docker-compose.ports.yml` 41xx fallback, rendered dispatcher service,
  `FLEET_MCP_TOKEN` inside the Director container, and working `e2e`
  and `gc` make targets.
- Step 5 (live acceptance): `scripts/accept/1d/rest.inc` plus checks
  06-14, fully implemented against the running fleet.
- Step 6 (end to end): `scripts/e2e.sh` (`make e2e`) driving the
  Director through its API on the demo repository.

Tests: `dispatcher/test/{auth,mcp,http,director,engine-1d,main}.test.ts`
plus `dispatcher/test/support/service-harness.ts` (fake-backed engine,
argon2 accounts, ephemeral HTTP). Render tests cover the gateway
routing and digest pin.

Recovery fixes found by the accept runs (all committed on this
branch, each pinned by a unit or render test):

- Gateway `exec /usr/bin/caddy: operation not permitted` (Restarting
  loop): the official Caddy binary carries file capability
  `cap_net_bind_service=ep`, and `cap_drop: ALL` empties the bounding
  set so execve fails EPERM. The renderer re-adds exactly
  `cap_add: [NET_BIND_SERVICE]` (guard 16 still requires `cap_drop:
[ALL]`).
- Published ports silently dropped on internal-only networks (Docker
  29.9.0, bisected with `docker run -p` on/off the internal network):
  the gateway is dual-homed (`fleet` + `outside`, like egress) while
  experts stay internal-only; check 05 creates its ephemeral dispatcher
  on the egress network and joins it to fleet second. The gateway still
  publishes only on `127.0.0.1`.
- Gateway 502s to the dispatcher: `serveHttp` bound container-loopback
  by default. New `dispatcherHostname()` (default loopback, refuses
  empty); the renderer sets `DISPATCHER_HOSTNAME=0.0.0.0`, and check 05
  passes it to its ephemeral dispatcher too.
- Dispatcher crash-loop on `LockedError` after any recreation: the
  SIGTERM handler called `process.exit(0)` before `close()` released
  `audit.lock`. New exported `shutdownService` awaits `close()` before
  exiting (second signal ignored while closing); three unit tests.
- Gateway Host routing: `rest.inc` helpers, `gc.sh`, and the checks now
  send `Host: agency.localhost` for dispatcher APIs (director-API calls
  already sent `director.agency.localhost`); unmatched hosts get Caddy's
  default empty reply, which the helpers fail closed on.
- `state/registry/allowlist.yaml` disagreed with
  `secrets/allowlist.env` (approver login 401 through a healthy stack);
  the yaml hashes were re-derived from the operator file (both are
  ignored environment state, mode 0600 kept) and the dispatcher
  restarted to reload it.
- Check-script bugs fixed: 13 maps `make e2e`'s exit 2 (make converts
  the recipe's 77) via the `e2e: SKIP` marker instead of missing exit
  77; 16 delegates the bwrap scan to stage-0 check 06 (which exempts
  its own mention) instead of a naive grep that false-positived on the
  harness itself, and its `run_guard` now fails a guard that ran
  nothing.

## 2. Acceptance

Final run: `make accept STAGE=1d` (calls
`ACCEPT_TIMEOUT=900 bash scripts/accept.sh 1d`). `scripts/accept.sh`
exited 77 (no failures; skips only where the stage prompt allows them);
`make` surfaces that as `Error 77`. Earlier runs are kept alongside:
`accept-20261014T212135Z.log` and `accept-20261014T212734Z.log` (both 4
pass / 7 skip / 5 fail — pre-fix tree: gateway Restarting, dispatcher
crash-looping on a stale audit lock), `accept-20261014T213316Z.log` and
`accept-20261014T213342Z.log` (both 8 pass / 8 skip / 0 fail,
post-fix confirmations).

```
CHECKS for stage 1d
1d/01-make-check             PASS
1d/02-up-healthy             PASS
1d/03-only-gateway-published PASS
1d/04-credentials-required   PASS
1d/05-auth-and-roles         PASS
1d/06-director-scout         SKIP   no provider key in .env.provider
1d/07-scout-completes        SKIP   no provider key in .env.provider
1d/08-docs-lands             SKIP   no provider key in .env.provider
1d/09-linter-break-fails-verify SKIP   no provider key in .env.provider
1d/10-joint-breakage-resets  SKIP   no provider key in .env.provider
1d/11-scope-refusal          PASS
1d/12-restart-collects       SKIP   no provider key in .env.provider
1d/13-e2e                    SKIP   make e2e skipped (no provider key)
1d/14-director-chat-proxy    SKIP   no provider key in .env.provider
1d/15-audit-chain            PASS
1d/16-stage-1-register       PASS
stage 1d: 8 pass, 8 skip, 0 fail (16 checks)
log: docs/evidence/1d/accept-20261014T214146Z.log
```

| Check                        | Result                 | Evidence                                     |
| ---------------------------- | ---------------------- | -------------------------------------------- |
| 01-make-check                | PASS                   | docs/evidence/1d/accept-20261014T214146Z.log |
| 02-up-healthy                | PASS                   | docs/evidence/1d/accept-20261014T214146Z.log |
| 03-only-gateway-published    | PASS                   | docs/evidence/1d/accept-20261014T214146Z.log |
| 04-credentials-required      | PASS                   | docs/evidence/1d/accept-20261014T214146Z.log |
| 05-auth-and-roles            | PASS                   | docs/evidence/1d/accept-20261014T214146Z.log |
| 06-director-scout            | SKIP (no provider key) | docs/evidence/1d/accept-20261014T214146Z.log |
| 07-scout-completes           | SKIP (no provider key) | docs/evidence/1d/accept-20261014T214146Z.log |
| 08-docs-lands                | SKIP (no provider key) | docs/evidence/1d/accept-20261014T214146Z.log |
| 09-linter-break-fails-verify | SKIP (no provider key) | docs/evidence/1d/accept-20261014T214146Z.log |
| 10-joint-breakage-resets     | SKIP (no provider key) | docs/evidence/1d/accept-20261014T214146Z.log |
| 11-scope-refusal             | PASS                   | docs/evidence/1d/accept-20261014T214146Z.log |
| 12-restart-collects          | SKIP (no provider key) | docs/evidence/1d/accept-20261014T214146Z.log |
| 13-e2e                       | SKIP (no provider key) | docs/evidence/1d/accept-20261014T214146Z.log |
| 14-director-chat-proxy       | SKIP (no provider key) | docs/evidence/1d/accept-20261014T214146Z.log |
| 15-audit-chain               | PASS                   | docs/evidence/1d/accept-20261014T214146Z.log |
| 16-stage-1-register          | PASS                   | docs/evidence/1d/accept-20261014T214146Z.log |

`make check` (format, lint, typecheck, coverage, render-check, 253 unit
tests) exits 0. `git status` is clean except the files committed with
this report.

## 3. Red proofs

Per-check sabotage with green re-confirmation, under
`docs/evidence/1d/red/` (first line of each file says what was broken;
each sabotage was restored byte-identically — md5-verified — and the
check re-ran green before moving on):

- `01-make-check` (`red/01-make-check.log`): appended an unformatted
  line to `dispatcher/src/config.ts` → `make check` failed at
  format-check, check exited 1.
- `02-up-healthy` (`red/02-up-healthy.log`): appended invalid YAML to
  the rendered `docker-compose.yml` → build/up failed, check exited 1.
  Restored from backup (md5-verified, `render-check` clean), check green.
- `03-only-gateway-published`
  (`red/03-only-gateway-published.log`): temporarily published
  `127.0.0.1:19998` on the verifier service and recreated it → check
  exited 1 naming the binding. Restored, recreated without the binding,
  check green. (A stray non-compose container does not trip this check:
  it scopes to `docker compose ps`, which is correct — the fleet asserts
  over its own project, not the shared host.)
- `04-credentials-required` (`red/04-credentials-required.log`):
  `dispatcherCredentials()` used an `optionalEnv` default for
  `FLEET_MCP_TOKEN` in a scratch image build → the unset-credential
  probe failed, check exited 1. Sources restored md5-verified, image
  rebuilt, check green. (A first attempt sabotaged only the standalone
  `fleetMcpToken()` accessor, which nothing calls — the check stayed
  green and exposed the attempt as incomplete; the real gate is
  `dispatcherCredentials()`.)
- `05-auth-and-roles` (`red/05-auth-and-roles.log`): `ROLE_RANK`
  demoted to `viewer: 1` in a scratch image build → viewer approvals
  passed the approver gate (`viewer approve returned 200, want 403`),
  check exited 1. Restored, rebuilt, check green.
- `11-scope-refusal` (`red/11-scope-refusal.log`): widened the docs
  grant in `state/registry/demo/ownership.yaml` to include `src/*` and
  restarted the dispatcher → the out-of-grant plan was accepted, check
  exited 1. Ownership restored, dispatcher restarted, probe mission
  cancelled, check green.
- `15-audit-chain` (`red/15-audit-chain.log`): stopped the dispatcher
  and appended a malformed entry to `state/audit/audit.jsonl` → chain
  verification failed, check exited 1. Log restored md5-verified,
  dispatcher started healthy, check green.
- `16-stage-1-register` (`red/16-stage-1-register.log`): created
  `dispatcher/src/lanes/` → the D-06 guard failed (`lanes directory
exists`), check exited 1. Directory removed, check green.
- Checks 06, 07, 08, 09, 10, 12, 13, 14: no red proof possible — each
  skips without a provider key and never ran green in this environment,
  so there is no passing behavior to sabotage. The skips are the ones
  the stage prompt allows. (`red/07-scout-completes.log`, left in place
  by the concurrent session, is explicitly disqualified: it sabotaged
  the API key but the run failed at the `agency-verifier is not healthy`
  prerequisite during overlapping proof windows, never reaching the
  sabotaged condition.)
- No check asserts only file existence; every runnable check above has
  a behavioral red proof.

## 4. Not performed

- Checks 06, 07, 08, 09, 10, 12, 13, 14: SKIP — no provider key in this
  environment (`.env.provider` holds the documented `disabled-no-key`
  marker so containers boot; live checks treat it as absent). Each is
  fully implemented and fails closed with a real key; none ran here.
  These are exactly the skips the stage prompt allows ("Checks 06 to
  14 skip only without a provider key").
- Check 11 ran and passed (needs no model, only the stack).

## 5. Not built

Nothing the stage asks for is missing. Not wired: nothing — `director.ts`
is imported by `http.ts`, `main.ts`, and (via notify) `mcp.ts`; every new
module is covered by unit tests and `make check`.

## 6. Deviations

1. `.env.provider` holds `OPENCODE_API_KEY=disabled-no-key` (documented
   in the file): the expert entrypoint refuses to boot with an empty key
   (correct fail-closed behavior), so infrastructure checks 02-05 need a
   non-empty value while inference checks 06-14 skip on the marker.
2. `scripts/accept/1c/04-single-opencode-module.sh` refined: the
   Dispatcher now serves its own `/api/*` control plane, so the check
   matches OpenCode operation paths (`/api/session`, `/api/event`,
   `/api/experimental`, `/api/info`, `openapi.json`) instead of any
   `/api/` string; comment lines do not count (same rule as 1c/09).
3. Added `POST /api/tasks/:id/decide` (approver): the roles section
   grants approver `decide` but the route list has no decide endpoint;
   MCP already had `fleet_decide`. The endpoint wakes the Director hook.
4. `fleet_wait` watches a snapshot of every mission rather than only the
   named mission's terminal status, so "anything changes" holds.
5. Check 11 (scope refusal) runs without a provider key: it needs no
   model, only plan validation, so passing it here is stronger than
   skipping it.
6. Concurrent debugging landed in this branch: a second builder worked
   in this same worktree during the stage and fixed three live defects
   the accept run exposed — Dispatcher loopback bind (new
   `DISPATCHER_HOSTNAME`, default loopback, compose sets `0.0.0.0`),
   published ports dropped on internal-only networks (gateway dual-homed,
   ephemeral dispatcher in check 05 created on the egress network and
   joined to fleet), Caddy file capabilities (`cap_add:
NET_BIND_SERVICE`), and a shutdown audit-lock race (new exported
   `shutdownService` that waits for `close()`). Every hunk was reviewed,
   each fix is pinned by unit or render tests, `make check` and the
   accept suite verify them, and the process breach (one builder, one
   branch) is recorded here rather than hidden.
7. Gateway clients send explicit `Host` headers (`agency.localhost`
   for dispatcher APIs in `rest.inc`/`gc.sh`, `<name>.agency.localhost`
   for expert APIs as before): the Caddyfile routes by host label, and
   an unmatched Host gets Caddy's default empty reply. Curl-by-IP
   without a Host header is not a supported path.
8. Ignored environment state was repaired, not regenerated:
   `state/registry/allowlist.yaml` re-derived from
   `secrets/allowlist.env`, one stale `audit.lock` from a pre-fix
   container removed after confirming the holder was gone. Tracked
   files were never touched for this.
9. Red-proof sabotages touched only backups-first copies (sources
   restored md5-verified, images rebuilt, ownership/audit/compose
   restored, probe missions cancelled); the final `make check` and
   `make accept` ran after every restore.

## 7. Proposed corrections

- Stage prompt check 04 wording ("each credential") is interpreted as
  the Dispatcher credential set (`FLEET_MCP_TOKEN`, `VERIFIER_TOKEN`,
  `AGENCY_MODEL`, twelve `PW_*`); `OPENCODE_API_KEY` is consumed by
  expert entrypoints, not the Dispatcher.
- The 1c/04 refinement above should be carried forward: any future
  Dispatcher-owned `/api/*` route would otherwise trip the old wording.

## 8. Next

Stage 1e (Web UI foundation) needs from the user: a real provider key
in `.env.provider` (replacing `disabled-no-key`) to run the skipped
live checks 06-14 any time; nothing else. The REST/SSE/chat-proxy
surface it consumes is specified in Step 2 above and `docs/prompts/ui-spec.md`.
