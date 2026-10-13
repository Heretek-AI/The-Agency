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
No provider key exists anywhere (no `.env.provider`; `AGENCY_MODEL` unset),
so model-dependent questions are recorded NOT PERFORMED, never answered.
Dummy value `spike-invalid-key-stage1a-q08` was used ONLY as a throwaway
container env var (Q8 calls for an invalid key); it appears in no tracked
file. Evidence: `docs/evidence/1a/spike/q<nn>.log` (commands + trimmed
output, credentials redacted).

| #   | Answer                  | Observation (one line)                                                                                                                                                                                                                                                                  |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | NOT PERFORMED           | Serve reads OPENCODE_API_KEY from env (dummy key -> provider.auth, not missing-var); `opencode models --standalone` lists nothing keyless; AGENCY_MODEL unset.                                                                                                                          |
| 2   | yes                     | Serve logs to stdout (`docker logs`); structured log at ~/.local/share/opencode/log/opencode.log; --print-logs exists for standalone.                                                                                                                                                   |
| 3   | yes                     | Create/prompt/wait/messages/diff all 200 on a read-only /work mount; snapshots live in the data dir (snapshot.ts), not /work; writes fail EROFS; turn-diff is snapshot-based (host edits invisible by design).                                                                          |
| 4   | yes                     | Healthy with read-only OPENCODE_CONFIG_DIR; writes to it fail EROFS while serving is unaffected.                                                                                                                                                                                        |
| 5   | yes (premise corrected) | v2 has no built-in general/explore agents (observed: build, plan + hidden compaction/title/summary); disabling absent ids is a safe no-op.                                                                                                                                              |
| 6   | yes                     | @opencode/client@2.0.26 installs under Bun 1.4.2 and drives server.info + agent.list; NOT better (mistypes unwrapped /api/info) -> keep salvaged client.                                                                                                                                |
| 7   | yes                     | Permission matrix live: session ask pends, baseline shell allows, per-task edit notes.txt allows, edit other.txt denied; list/reject round-trip 204 + disappears. Race: agent rules resolve async per location; early checks fail closed (deny) — Stage 1c must tolerate, never weaken. |
| 8   | yes                     | Invalid key -> assistant finish:error {type:provider.auth,message,status:401,response:{body}} then idle failed. Source maps quota/rate-limit to provider.quota/provider.rate-limit in the same envelope; schema has NO reset field -> probe-on-timer fallback adopted.                  |
| 9   | NOT PERFORMED           | Fields exist (cost 0 + zeroed tokens pre-run); real fill-in untested.                                                                                                                                                                                                                   |
| 10  | NOT PERFORMED           | Only websocket-constructor honors \*\_PROXY; no proxy support found in provider/MCP paths; internal-network test needs a key.                                                                                                                                                           |
| 11  | NOT PERFORMED           | permission.asked/replied carry sessionID (+requestID); MCP tool-output SSE matching untested without a model.                                                                                                                                                                           |
| 12  | no                      | Disabled -> repo AGENTS.md not loaded (zero watcher subscriptions vs /work/trees/t1/AGENTS.md subscribed when enabled); envelope already tells the expert to read it. Nothing to adopt.                                                                                                 |
| 13  | yes                     | ?auth_token=base64("opencode:<pw>") -> 200 on /api/info; absent/bad -> 401. / serves the app shell publicly.                                                                                                                                                                            |
| 14  | yes / yes               | Bun (SDK 1.32.1, node:http, per-connection McpServer) Streamable-HTTP server: "mcp connected" tools=1; down -> failed ConnectionRefused. bun:sqlite WAL works + reopens; ro dir fails closed (SQLiteError, rc=1); :z volume visible as agent. Bun stays; no Node fallback.              |
| 15  | yes                     | PUT {variables} 204 -> session shell sees var; second session UNSET. Model shell tool shares Shell.Service + SessionEnvironment, so covered by construction.                                                                                                                            |

Keyless instruction: `opencode models` (no --standalone) needs a WRITABLE
config dir for service registration (EROFS on ro /etc/agency) — CLI-only
finding; serve itself is fine read-only.

## Fallbacks in force

- Q6: keep the salvaged fetch client (`dispatcher/src/opencode.ts`); do not
  adopt `@opencode/client` (it mistypes the unwrapped `GET /api/info`).
- Q8: treat any repeated provider refusal as a usage limit; the Dispatcher
  probes on a timer. (SessionError has no reset-time field.)
- Q1/Q7/Q9/Q10/Q11/Q15-model-leg: no fallback adopted; pending provider key.
  (The client's polling `wait` fallback on 404/501 only is specified
  behavior, not a spike fallback.)
- Q3/Q4/Q5/Q12/Q13/Q14: no fallback needed (answers above).
- (Stage 0 note kept: `make accept` cannot propagate exit 77 because GNU
  make normalizes failing recipes to exit 2, so the 0/1/77 contract lives
  in `scripts/accept.sh`.)

## Proposed corrections

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
