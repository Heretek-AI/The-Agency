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

| Source (`$SALVAGE_SRC/packages/…`)     | Destination (this repo)                                                      | Changes made                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opencode-fleet/src/util/hash.ts`      | `dispatcher/src/util/hash.ts`                                                | None beyond lint (canonical JSON, sha256 chain helpers unchanged).                                                                                                                                                                                                                                                                                                                           |
| `opencode-fleet/src/util/redact.ts`    | `dispatcher/src/util/redact.ts`                                              | None beyond lint (secret patterns, idempotent redact, redactJson unchanged).                                                                                                                                                                                                                                                                                                                 |
| `opencode-fleet/src/util/exec.ts`      | `dispatcher/src/util/exec.ts`                                                | `env` is now required, never inherited; child spawns as a process-group leader (`detached: true`); timeout kills the group and confirms it gone (`{exit: 124, timedOut: true}`); stragglers reaped after normal exit; missing binary gives 127. `baseEnv()` (PATH+LANG only) lives in `dispatcher/src/config.ts`.                                                                            |
| `opencode-fleet/src/state/journal.ts`  | `dispatcher/src/audit.ts`                                                    | Rebuilt as the 9.12 audit log: `AuditLog.open` takes an exclusive lock file and verifies the chain; `append` writes one line with `O_APPEND`+`fsync`, never rewrites; divergence is tip **or** length (`checkAnchor`), not `&&`; torn tail fails closed with the byte offset; `scripts/audit-repair.ts` moves the fragment aside and appends `audit.repaired`. Data redacted before hashing. |
| `opencode-fleet/src/dag/graph.ts`      | `dispatcher/src/graph.ts`                                                    | Adapted to the 9.3 task model (`status`, both triggers, `waiting-human`); `readySet`/`allDone`/`settled` removed (scheduling is Stage 1c); kept validation (duplicates, unknown/self deps, cycles with path) and deterministic topo order.                                                                                                                                                   |
| `opencode-fleet/src/lanes/worktree.ts` | `dispatcher/src/worktrees.ts`                                                | New `allocate`/`release`/`salvage`/`inspect` API: retry attaches the existing `fleet/<id>` branch at its tip (never resets, never detaches); new branches start from the caller-supplied base; `salvage` anchors `refs/fleet-salvage/<id>` then deletes the branch (fails closed while a worktree uses it); slug validation; typed `AllocationRegistry` hook for the Stage 1c store.         |
| `opencode-fleet/src/gates/runner.ts`   | `verifier/src/run-checks.ts`                                                 | Removed `DEFAULT_GATES` and the budget gate; missing/empty checks throw `NoChecksError` (mapped to `no-checks`); setup failure ends the run with reason `setup`; every check runs even after failures; explicit `env` through `execCmd`; full redacted output to `<artifactsDir>/verify/<id>.log` with per-check `id/exit/durationMs/timedOut/logPath/outputHash/excerpt`.                   |
| `opencode-fleet/src/judges/reports.ts` | `dispatcher/src/protocol.ts`                                                 | Rewritten to the 9.8 JSON blocks with one `ResultBlock`/`VerdictBlock` schema: last heading wins, raw always returned, pass-with-blocker and fail-without-blocker/major invalid, `blocked` needs a `question`.                                                                                                                                                                               |
| `opencode-sdk/src/host/client.ts`      | `dispatcher/src/opencode.ts`                                                 | Renamed `HostClient` to `OpenCodeClient` (`health` to `info`); `createSession` sends `{title, agent, location: {directory}, permissions, metadata}`; `/api/info` parsed unwrapped (verified live: the real server returns no `{data}` envelope there); `wait` polling fallback on 404/501 only; every non-2xx throws with method, path, and status.                                          |
| `opencode-sdk/test/host-live.test.ts`  | `dispatcher/test/live/opencode.live.test.ts`                                 | Moved; missing binary is a logged skip (early return), run only by check `09-opencode-live`.                                                                                                                                                                                                                                                                                                 |
| `opencode-sdk/src/testkit/index.ts`    | `dispatcher/test/support/git.ts`, `dispatcher/test/support/fake-opencode.ts` | Kept the temp-git-repo helpers in `git.ts`; replaced the canned-route mock with the scripted fake server (`fake-opencode.ts`): Basic auth, `{data}` wrap, script steps write/commit/message/permission/error/delay/hang with real git effects, blocking `wait`, real-diff `diff`, SSE events, request recording, and a startup self-check of every route against the real `openapi.json`.    |

| Source (`$SALVAGE_SRC/packages/…`) | Destination (this repo) | Changes made |
| ---------------------------------- | ----------------------- | ------------ |

## Spike

Not in Stage 0. Recorded in Stage 1a.

## Fallbacks in force

None. (Stage 0 builds no production fallbacks. Notes: the client's polling
`wait` fallback on 404/501 only is specified behavior; `make accept` cannot
propagate exit 77 because GNU make normalizes failing recipes to exit 2, so
the 0/1/77 contract lives in `scripts/accept.sh`.)

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
