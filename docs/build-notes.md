# Build notes (Stage 0 and beyond)

Running log of facts, salvage provenance, spike answers, and fallbacks.
Stage reports in `docs/reports/` quote evidence; this file records context.

## Preflight

- Date: 2026-10-12 (UTC).
- Branch: `stage-0-salvage` (worktree `/home/john/Projects/The-Agency/worktrees/wave-0-salvage/`).
- Bun: 1.4.2. git: 2.56.0. Docker: 29.9.0. SELinux: Enforcing.
- `opencode` binary on PATH: yes (`/home/linuxbrew/.linuxbrew/bin/opencode`, v2.0.27; pin is 2.0.26).
- Salvage source: `SALVAGE_SRC=/home/john/Projects/Heretek-AI-opencode/rebuild_staging/` (read-only, never written).
- Salvage commit: `14f297a` (verified with `git -C "$SALVAGE_SRC" rev-parse --short HEAD`).
- Working tree at branch-off held only the prompt series, `docs/research/`, `docs/audit/`, and untracked `review/`.

### Stage 1a preflight

- Date: 2026-10-13 (UTC), branch `stage-1a-spike`. `bash scripts/preflight.sh`
  exits 1 while `.env.provider` is absent: the provider-file row is the
  honest fail-closed state and the key is reported present/absent only,
  never by value.
- Chosen port: `AGENCY_HTTP_PORT=8081` (8080 is in use on the development
  host; the same value is the suggested one in `.env.example`).
- Exact table from the run recorded for verification finding F2
  (`docs/evidence/1a/qa/f2-preflight-recorded.log`):

```
PREFLIGHT
runtime          PASS   Docker version 29.9.0, build 1.fc46
compose          PASS   docker compose 5.6.0
selinux          INFO   Enforcing
provider-file    FAIL   .env.provider absent (place OPENCODE_API_KEY there, mode 0600)
install-url      PASS   https://opencode.ai/v2/install reachable
http-port        PASS   AGENCY_HTTP_PORT=8081
userns           INFO   max_user_namespaces=255647 (stage 2b info only)
kernel           INFO   Linux 7.3.0-0.rc6.261009gaf32da41b032.55.fc46.x86_64 x86_64 (stage 2b info only)
preflight: 4 pass, 1 fail
```

## Salvage

Salvage commit for every row: `14f297a`
(`SALVAGE_SRC=/home/john/Projects/Heretek-AI-opencode/rebuild_staging/`, read-only).

| Source (`$SALVAGE_SRC/packages/…`)     | Destination (this repo)                                                      | Changes made                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opencode-fleet/src/util/hash.ts`      | `dispatcher/src/util/hash.ts`                                                | None beyond lint (canonical JSON, sha256 chain helpers unchanged).                                                                                                                                                                                                                                                                                                                                                                                         |
| `opencode-fleet/src/util/redact.ts`    | `dispatcher/src/util/redact.ts`                                              | None beyond lint (secret patterns, idempotent redact, redactJson unchanged).                                                                                                                                                                                                                                                                                                                                                                               |
| `opencode-fleet/src/util/exec.ts`      | `dispatcher/src/util/exec.ts`                                                | `env` is now required, never inherited; child spawns as a process-group leader (`detached: true`); timeout kills the group and confirms it gone (`{exit: 124, timedOut: true}`); stragglers reaped after normal exit; missing binary gives 127. `baseEnv()` (PATH+LANG only) lives in `dispatcher/src/config.ts`.                                                                                                                                          |
| `opencode-fleet/src/state/journal.ts`  | `dispatcher/src/audit.ts`                                                    | Rebuilt as the 9.12 audit log: `AuditLog.open` takes an exclusive lock file and verifies the chain; `append` writes one line with `O_APPEND`+`fsync`, never rewrites; divergence is tip **or** length (`checkAnchor`), not `&&`; torn tail fails closed with the byte offset; `scripts/audit-repair.ts` moves the fragment aside and appends `audit.repaired`. Data redacted before hashing.                                                               |
| `opencode-fleet/src/dag/graph.ts`      | `dispatcher/src/graph.ts`                                                    | Adapted to the 9.3 task model (`status`, both triggers, `waiting-human`); `readySet`/`allDone`/`settled` removed (scheduling is Stage 1c); kept validation (duplicates, unknown/self deps, cycles with path) and deterministic topo order.                                                                                                                                                                                                                 |
| `opencode-fleet/src/lanes/worktree.ts` | `dispatcher/src/worktrees.ts`                                                | New `allocate`/`release`/`salvage`/`inspect` API: retry attaches the existing `fleet/<id>` branch at its tip (never resets, never detaches); new branches start from the caller-supplied base; `salvage` anchors `refs/fleet-salvage/<id>` then deletes the branch (fails closed while a worktree uses it); slug validation; typed `AllocationRegistry` hook for the Stage 1c store.                                                                       |
| `opencode-fleet/src/gates/runner.ts`   | `verifier/src/run-checks.ts`                                                 | Removed `DEFAULT_GATES` and the budget gate; missing/empty checks throw `NoChecksError` (mapped to `no-checks`); setup failure ends the run with reason `setup`; every check runs even after failures; explicit `env` through `execCmd`; full redacted output to `<artifactsDir>/verify/<id>.log` with per-check `id/exit/durationMs/timedOut/logPath/outputHash/excerpt`.                                                                                 |
| `opencode-fleet/src/judges/reports.ts` | `dispatcher/src/protocol.ts`                                                 | Rewritten to the 9.8 JSON blocks with one `ResultBlock`/`VerdictBlock` schema: last heading wins, raw always returned, pass-with-blocker and fail-without-blocker/major invalid, `blocked` needs a `question`.                                                                                                                                                                                                                                             |
| `opencode-sdk/src/host/client.ts`      | `dispatcher/src/opencode.ts`                                                 | Renamed `HostClient` to `OpenCodeClient` (`health` to `info`); `createSession` sends `{title, agent, location: {directory}, permissions, metadata}`; `/api/info` parsed unwrapped (verified live: the real server returns no `{data}` envelope there); `wait` polling fallback on 404/501 only; every non-2xx throws with method, path, and status.                                                                                                        |
| `opencode-sdk/test/host-live.test.ts`  | `dispatcher/test/live/opencode.live.test.ts`                                 | Moved; run only by check `09-opencode-live`. A missing binary is a harness-level skip (exit 77 via `require_cmd --optional opencode`); an `OPENCODE_BIN` override must resolve, any `[opencode-live] SKIP` marker in test output fails the check, and any in-test skip throws so an unrunnable suite fails instead of reporting pass. Keyless `prompt`+`wait` removed (see note below); the suite runs only deterministic create/get/diff/messages/delete. |
| `opencode-sdk/src/testkit/index.ts`    | `dispatcher/test/support/git.ts`, `dispatcher/test/support/fake-opencode.ts` | Kept the temp-git-repo helpers in `git.ts`; replaced the canned-route mock with the scripted fake server (`fake-opencode.ts`): Basic auth, `{data}` wrap, script steps write/commit/message/permission/error/delay/hang with real git effects, blocking `wait`, real-diff `diff`, SSE events, request recording, and a startup self-check of every route against the real `openapi.json`.                                                                  |

### Keyless live-test timing (Stage 0 rework 1)

With no provider key (`OPENCODE_API_KEY` absent), the keyless
`prompt`-then-`wait` round trip against `opencode serve` depends on
server-internal agent-loop drain timing: verification saw `createSession`
succeed and the prompt request hang until the 120 s harness timeout, with
`1 pass 1 fail` on unchanged-tree reruns. Assumption recorded: the keyless
live suite asserts only deterministic session operations (create, get, diff,
messages, delete) and never calls `prompt`/`wait`. Model round trips return
with provider credentials in later stages, where generous documented timeouts
will apply.

## Spike

Stage 1a, 2026-10-13, branch `stage-1a-spike`, image `agency-base:2.0.26`.
Provider key supplied by the user in `.env.provider` (mode `0600`,
non-empty `OPENCODE_API_KEY`; value never shown or copied) and
`AGENCY_MODEL=opencode-go/muse-spark-1.3-contributor` in `.env` (mode
`0600`). Evidence: `docs/evidence/1a/spike/q<nn>.log` (commands + trimmed
output, credentials redacted; Q11 raw transcripts held only in ephemeral
container DBs, destroyed with the containers).

Keyed account limits observed (all fail-fast, no spend): the account's Go
monthly usage limit is exhausted (429 `GoUsageLimitError`, limitName
monthly — AGENCY_MODEL turns fail), the free-tier rate limit is exhausted
for `opencode/muse-spark-1.3-contributor-free` (429 `FreeUsageLimitError`),
and the server default model has no funding (`Insufficient account funds`).
`scripts/spike.sh` therefore pins the runnable free model
`opencode/cat-jam-free` for the session-flow run (recorded as a Deviation);
every assertion is unchanged and fail-closed.

| #   | Answer                  | Observation (one line)                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | partly                  | Serve reads OPENCODE_API_KEY from env (Go-plan quota refusal for the exact AGENCY_MODEL id proves server-side resolution); `opencode models --standalone` lists nothing in 2.0.26, default form fails EROFS on ro config; host 2.0.28 lists the id. No fallback (`auth import` is Console-export migration, not env import). |
| 2   | yes                     | Serve logs to stdout (`docker logs`); structured log at ~/.local/share/opencode/log/opencode.log; --print-logs exists for standalone.                                                                                                                                                                                        |
| 3   | yes                     | Create/prompt/wait/messages/diff all 200 on a read-only /work mount; snapshots live in the data dir (snapshot.ts), not /work; writes fail EROFS; turn-diff is snapshot-based (host edits invisible by design).                                                                                                               |
| 4   | yes                     | Healthy with read-only OPENCODE_CONFIG_DIR; writes to it fail EROFS while serving is unaffected.                                                                                                                                                                                                                             |
| 5   | yes (premise corrected) | v2 has no built-in general/explore agents (observed: build, plan + hidden compaction/title/summary); disabling absent ids is a safe no-op.                                                                                                                                                                                   |
| 6   | yes                     | @opencode/client@2.0.26 installs under Bun 1.4.2 and drives server.info + agent.list; NOT better (mistypes unwrapped /api/info) -> keep salvaged client.                                                                                                                                                                     |
| 7   | yes                     | Permission matrix live: session ask pends, baseline shell allows, per-task edit notes.txt allows, edit other.txt denied; list/reject round-trip 204 + disappears. Race: agent rules resolve async per location; early checks fail closed (deny) — Stage 1c must tolerate, never weaken.                                      |
| 8   | yes                     | Invalid key -> assistant finish:error {type:provider.auth,message,status:401,response:{body}} then idle failed. Source maps quota/rate-limit to provider.quota/provider.rate-limit in the same envelope; schema has NO reset field -> probe-on-timer fallback adopted.                                                       |
| 9   | partly                  | Session.Info fills cost 0 + tokens (in 1814/out 4/reasoning 26/cache.read 896) after a real free-model run; AGENCY_MODEL leg fails on Go quota with zeros.                                                                                                                                                                   |
| 10  | yes                     | Internal net + HTTPS_PROXY: provider turn succeeds (CONNECT opencode.ai) and internet MCP connects tools=2 (CONNECT context7); direct fails DNS rc=6. Code search missed the runtime proxy path. No fallback.                                                                                                                |
| 11  | yes                     | session.tool.called/success carry sessionID + call id; success carries tool output (echo:hello-sse3). Needs bunprobe\_\* allow or the tool is filtered. Director-polls fallback not needed.                                                                                                                                  |
| 12  | no                      | Disabled -> repo AGENTS.md not loaded (zero watcher subscriptions vs /work/trees/t1/AGENTS.md subscribed when enabled); envelope already tells the expert to read it. Nothing to adopt.                                                                                                                                      |
| 13  | yes                     | ?auth_token=base64("opencode:<pw>") -> 200 on /api/info; absent/bad -> 401. / serves the app shell publicly.                                                                                                                                                                                                                 |
| 14  | yes / yes               | Bun (SDK 1.32.1, node:http, per-connection McpServer) Streamable-HTTP server: "mcp connected" tools=1; down -> failed ConnectionRefused. bun:sqlite WAL works + reopens; ro dir fails closed (SQLiteError, rc=1); :z volume visible as agent. Bun stays; no Node fallback.                                                   |
| 15  | yes                     | PUT {variables} 204 -> session shell sees var; second session UNSET. Model shell tool shares Shell.Service + SessionEnvironment, so covered by construction.                                                                                                                                                                 |

Keyless instruction: `opencode models` (no --standalone) needs a WRITABLE
config dir for service registration (EROFS on ro /etc/agency) — CLI-only
finding; serve itself is fine read-only.

## Fallbacks in force

- Q6: keep the salvaged fetch client (`dispatcher/src/opencode.ts`); do not
  adopt `@opencode/client` (it mistypes the unwrapped `GET /api/info`).
- Q8: treat any repeated provider refusal as a usage limit; the Dispatcher
  probes on a timer. (SessionError has no reset-time field.)
- Q1/Q9-model-leg: no fallback adopted. Serve reads the env key (no
  `auth import`: that imports Console `auth export` files, not env keys);
  the AGENCY_MODEL id stands as-is (the server resolves it; quota, not
  identity, refuses). Session.Info needs no tokens-only fallback.
  (The client's polling `wait` fallback on 404/501 only is specified
  behavior, not a spike fallback.)
- Q10/Q11: no fallback needed (both yes). Q10 note for Stage 1b: set
  NO_PROXY for fleet-internal hosts — without it every client HTTP request,
  including same-net and localhost, goes to the proxy. Q11 confirms the 9.6
  per-server MCP allow must be passed per task or the tools are filtered out.
- Q3/Q4/Q5/Q7/Q12/Q13/Q14/Q15: no fallback needed (answers above).
- (Stage 0 note kept: `make accept` cannot propagate exit 77 because GNU
  make normalizes failing recipes to exit 2, so the 0/1/77 contract lives
  in `scripts/accept.sh`.)

## Proposed corrections (keyed session, 2026-10-13 — observed against 2.0.26)

- Transcript shape: the `shell` TOOL's output lands as an assistant content
  part (`{type: tool, name: shell, state.content[].text}`), never as a
  standalone `type: shell` message — those are only produced for background
  shells (`session.shell.started`, message-updater.ts). The spike transcript
  parser now accepts both genuine run-output shapes and still ignores the
  user echo (evidence `docs/evidence/1a/spike-parse/toolpart-positive.json`;
  parser re-proof in `spike-parse/run.log`).
- Proxy support: the keyless note ("no proxy support in provider/MCP paths",
  from reading source) is superseded — on an internal network with
  HTTPS_PROXY/HTTP_PROXY set, provider calls and remote MCP connect THROUGH
  the proxy (CONNECT lines in the proxy log; model turn succeeds; internet
  MCP lists tools). Only the websocket constructor shows proxy code in
  source; the runtime fetch path honors the env.
- Same-path mounts: a git worktree bind-mounted at a different container
  path breaks git (absolute .git pointer) and empties session.diff;
  `spike.sh` mounts the workspace at the identical path (as 9.1 mandates
  for /work). Check 05's diff step is now a real assertion.
- MCP tools to the model are named `<server>_<tool>` and are
  permission-filtered: without the per-server allow the call fails with "No
  tool named ... is currently available". Stage 1c must pass the 9.6
  per-server allow per task (proven: `bunprobe_*` allow -> call completes).
- Transcript hygiene: an unconstrained model dumps container env (including
  provider secrets) into transcripts via shell. Evidence stays
  hand-transcribed and redacted; raw transcripts live only in ephemeral
  container DBs. Stages 1b/1c must redact transcripts before storing them.

## Proposed corrections (earlier)

- The fake OpenCode server must serve `GET /openapi.json` (the real spec file),
  but that path is not itself listed in the spec's 118 paths. The route
  self-check therefore exempts exactly that one route and checks every other
  served route against the spec. Justification: a file cannot list itself as an
  API operation; the exemption is documented in the fake's source.
- Shared context 5.2 ("JSON responses are wrapped as `{data}`") needs an
  exception: `GET /api/info` returns `{version, ...}` unwrapped on the real
  2.0.27 server (verified live with curl during Stage 0). The client and the
  fake both model it unwrapped.
- Stage-0 table vs Step-3 text: rows D-28/D-29 mandate the disposition
  `fixed`, narrower than the three allowed values. Kept the mandated wording;
  suggest accepting `fixed` as shorthand for `fixed in salvage`.
- Shared context 5.1 config "Agent prompt field: prompt" vs observed schema:
  agent files use `system`/body; unchanged, still correct.
- Stage 1a Q5 premise ("built-in build, plan, and general agents"): v2 has
  no built-in `general` (or `explore`) agent — agents are config-defined;
  observed built-ins are `build`, `plan` plus hidden `compaction`, `title`,
  `summary` (default id `build`, agent.ts). Disabling absent ids is a no-op.
- Stage 1a Q3 premise ("sessions, snapshots, and session.diff"): diff is a
  turn-snapshot diff (diff.ts), not a working-tree diff — host-side edits
  outside a turn are invisible to it by design. Read-only mounts still leave
  every route working because snapshots live in the data dir (snapshot.ts).
- Shared context 5.2 "PUT /api/session/{id}/environment ... replaces the
  environment": request shape is `{"variables": {...}}` (a bare object
  400s). Both the direct session.shell route and the model shell tool read
  it via Shell.Service + SessionEnvironment.Service.
- `opencode models` (service-backed) writes service.json into the config
  dir and fails EROFS on a read-only OPENCODE_CONFIG_DIR; `--standalone`
  avoids it. Serve itself is unaffected by a read-only config dir.
- Stage 1a check `02-base-image-pinned` parsed the FROM digest with
  `${from##*@sha256:}`, which kept the `AS base` stage alias, so it
  rejected the correct digest recorded in `versions.env`. Fixed to strip
  the alias with sed; the check still fails on any digest mismatch.
- Stage 1a check `06-spike-answers-complete` matched answer rows with
  `^\| <n> \|`, but the answers table pads numbers (`| 1   |`), so no row
  ever matched. Fixed to allow padding — including in the NOT PERFORMED
  count, which with the old pattern counted 0 and would have passed a
  stage with unperformed questions.
- Stage 0 check `06-no-donor-code` scanned `scripts/**` for `docker run`
  with no exemptions, so the Stage 1a prompt-mandated harness
  (`scripts/spike.sh`, `scripts/accept/1a/*`) failed the stage-0 guard on
  this branch — the two prompts contradicted each other. The scan now
  exempts exactly those sanctioned paths (stated in-check), the D-06
  register row matches, and the scan itself fails closed when a scanned
  file cannot be read (it previously tolerated grep errors). Proof:
  `docs/evidence/1a/red/06-no-donor-code-scope-proof.log`.
