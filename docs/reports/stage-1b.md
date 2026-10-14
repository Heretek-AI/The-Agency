# Stage 1b report — Roster, renderer, network, and egress

Date: 2026-10-14 (UTC). Branch: `stage-1b-roster`.
Model: `AGENCY_MODEL=opencode-go/muse-spark-1.3-contributor` (`.env`, mode `0600`).
Images: `agency-<expert>:2.0.26` (twelve), `agency-egress:1.0.0`.
Provider key: `.env.provider`, mode `0600`, non-empty `OPENCODE_API_KEY`
(presence only; value never shown, copied, or committed).

**This stage is complete.** `make check` exits 0 and
`bash scripts/accept.sh 1b` exits 0 (12 pass, 0 skip, 0 fail).
Final log: `docs/evidence/1b/accept-20261014T010532Z.log`.
All twelve red proofs are recorded under `docs/evidence/1b/red/`.

This report covers the whole stage. Steps 1–8 were built by a prior
session (commits `0f7641f`, `562ae65`, `7fcb258` plus fixes `7e0f9c7`,
`d0ad618`, `e85912f`, `ca822e0`, `717d070`); the close-out
session diagnosed the last accept failure (06-smoke), hardened two
harness scripts, fixed one fail-open defect the red proofs exposed, and
re-ran everything green.

## 1. Built

- **Step 1 — `fleet.yaml` and schema** (`fleet.yaml`,
  `dispatcher/src/fleet-schema.ts`, tests; commit `0f7641f`). 25 experts
  from shared context 9.10, exactly twelve enabled (`director`, `scout`,
  `architect`, `product`, `frontend`, `backend`, `dba`, `platform`,
  `security`, `qa`, `reviewer`, `docs`). Zod schema rejects unknown keys,
  `ro` experts with `proposed_writes`, and `scoped` experts without them.
- **Step 2 — MCP registry** (`mcp/registry.jsonc`, schema test; commit
  `0f7641f`). Every local server pinned and installed at build time.
  Per-entry verification is recorded in `docs/build-notes.md`
  ("MCP registry verification"). Disabled: `postgres`, `dbhub`, `figma`,
  `linear` (per 9.11); `fleet` (needs `FLEET_MCP_TOKEN`, Stage 1d);
  `github`, `kubernetes`, `grafana`, `sentry`, `huggingface` carry
  `requires` and are disabled at container start until their variables
  exist. Not installed, with reasons in build notes: `vale` (upstream
  answers Moved Permanently), `atlas` (no downloadable release assets),
  Docker CLI (no daemon socket by design), Go/Rust/JDK (optional per the
  research catalog; nothing in 1b needs them), extended-expert-only tools.
- **Step 3 — Fleet protocol** (`shared/FLEET_PROTOCOL.md`,
  `dispatcher/src/protocol.ts`, `dispatcher/test/protocol-examples.test.ts`;
  commit `0f7641f`). `RESULT`/`VERDICT` formats with original examples;
  the test extracts each fenced example and parses it through the schema.
- **Step 4 — Renderer** (`scripts/render.ts`, `shared/templates/`;
  commit `562ae65`). Generates per-expert `opencode.jsonc`, `AGENTS.md`,
  `mcp-requirements.json`, `docker-compose.yml`, and the proxy allowlist,
  all byte-for-byte reproducible with `--check`. Refuses on `ask` rules,
  non-deny-all first rule, missing `SKILL.md`, unknown MCP key, or remote
  MCP host off the egress allowlist. `make render-check` is part of
  `make check`.
- **Step 5 — Experts** (`experts/<name>/{Dockerfile,config/}`; commits
  `562ae65`, `7e0f9c7`). Twelve hand-written Dockerfiles (no floating
  versions; release binaries hashed and re-checked at build time),
  personas from `docs/research/02-expert-fleet-catalog.md` with `mode:
primary`, and one concrete-procedure `SKILL.md` per skill named in
  `fleet.yaml`. Reviewer and security close with `VERDICT` (they are
  judges under 9.8; see Deviations).
- **Step 6 — Networks and egress** (`egress/`, commit `562ae65` plus
  `e85912f`, `ca822e0`, `717d070`). Network `fleet` is internal-only;
  experts attach only to it. **Proxy choice: Squid 6.14** (pinned apt on
  the pinned Ubuntu digest): per-user `basic_ncsa_auth` identities from
  `PROXY_PW_<NAME>`, `dstdomain` allowlist
  (`egress/allowlist.txt`: `opencode.ai` + observed provider hosts,
  toolchain registries, remote MCP hosts, documented doc hosts),
  per-expert additions from `fleet.yaml`, one log line per request with
  expert name / host / verdict, `CONNECT` limited to 443/80, and
  private/loopback/link-local/metadata destinations denied regardless of
  the allowlist. Smokescreen (salvaged, commit-pinned) was not chosen: as
  salvaged it has no ACL and no role mapping; Squid meets every bullet
  with configuration, not new code. Experts get `HTTP_PROXY`,
  `HTTPS_PROXY`, and `NO_PROXY=localhost,127.0.0.1,egress,dispatcher,verifier`
  (spike Q10).
- **Step 7 — Compose** (generated `docker-compose.yml`,
  `scripts/init-env.sh`; commit `562ae65`). One service per enabled
  expert: `cap_drop: [ALL]`, `no-new-privileges`, `pids_limit: 1024`,
  `cpus`/`mem_limit` (browser experts `shm_size: 1g`, 6g), fleet network
  only, no ports, every bind `:z`, read-only config mounts, `ro` experts
  read-only `/work`, whole `/work` mounted (9.1), healthcheck on
  `/api/info`. `init-env.sh` creates `.env` (uid/gid, `AGENCY_HTTP_PORT`,
  random `PW_<NAME>`/`PROXY_PW_<NAME>`/tokens) and placeholder
  `.env.provider`, mode `0600`, never overwriting.
- **Step 8 — Workspace and minimal registry**
  (`scripts/workspace-init.sh`, `fixtures/demo-repo`,
  `registry.example/demo/`, `dispatcher/src/registry-schema.ts`;
  commit `7fcb258`). `--demo` copies the fixture and runs `git init`;
  submodule/LFS repositories refused with reasons; control-file schemas
  with tests. **Close-out fix:** the demo leg was fail-open — with the
  fixture missing, `cp` failed and the script still printed "ready" and
  exited 0 (no `set -e`), so check 11 passed on an empty directory. Now
  `set -e` plus an explicit `cp` guard that removes the partial workspace
  and exits 1 (commit below).
- **Step 9 — Smoke** (`scripts/smoke.sh`, `make smoke`; commits
  `7fcb258`, close-out fix below). Per expert, no model calls: healthy,
  uid, `/api/agent` lists the persona, `/api/skill` lists every skill,
  `/api/mcp` settled with none failed, no normalization diagnostic in the
  log, mount writability by access class, own password accepted / other's
  rejected. **Close-out fix:** transport errors inside the `/api/agent`,
  `/api/skill`, `/api/mcp` retry loops no longer fail instantly; they
  retry inside the same 36×5s budget (see 06 root cause).

## 2. Acceptance

Final run: `docs/evidence/1b/accept-20261014T010532Z.log`, exit 0.

```
1b/01-render-check           PASS
1b/02-compose-config         PASS
1b/03-compose-hardening      PASS
1b/04-images-pinned-and-built PASS
1b/05-up-healthy             PASS
1b/06-smoke                  PASS
1b/07-egress-allow-deny      PASS
1b/08-no-direct-route        PASS
1b/09-unique-passwords       PASS
1b/10-protocol-examples-parse PASS
1b/11-workspace-demo         PASS
1b/12-no-published-ports     PASS
stage 1b: 12 pass, 0 skip, 0 fail (12 checks)
```

`make check` exits 0 (format, lint, typecheck, ts-coverage, render-check
with 39 generated files current, 109 unit tests pass across 19 files).

## 3. Red proofs

One recorded red run per check under `docs/evidence/1b/red/`; each log's
first line states the sabotage, followed by the check's FAIL. All were
restored afterwards (re-render, `git checkout`, container
start/unpause/disconnect, `.env` restore) and the final accept above
re-confirms green.

| Check | Sabotage                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01    | Appended a hand-edited line to generated `docker-compose.yml` → render-check fails.                                                                                                   |
| 02    | Appended invalid YAML to `docker-compose.yml` → `config -q` fails.                                                                                                                    |
| 03    | Replaced one service's `cap_drop: [ALL]` with `[]` → hardening check fails.                                                                                                           |
| 04    | Appended `FROM ubuntu:latest` to `experts/docs/Dockerfile` → floating-version gate fails before any build.                                                                            |
| 05    | Paused `agency-docs` (unhealthy; `make up` errors on a paused container) → fails.                                                                                                     |
| 06    | Stopped `agency-director` → smoke fails on the first expert.                                                                                                                          |
| 07    | Stopped `agency-egress` → allowlisted request fails (`Could not resolve proxy`). Re-validated after the poll-window change below.                                                     |
| 08    | Attached `agency-backend` to the `bridge` network (bypass returned 200) → fails; detached afterwards.                                                                                 |
| 09    | Set `PW_BACKEND` equal to `PW_DIRECTOR` and recreated `agency-backend` → director accepted backend's password (200). `.env` restored from backup (backup shredded), mode kept `0600`. |
| 10    | Changed one `RESULT` example status to `bogus` in `shared/FLEET_PROTOCOL.md` → example test fails.                                                                                    |
| 11    | Moved `fixtures/demo-repo` away → workspace build fails (this is the run that exposed the fail-open defect; fixed before this proof).                                                 |
| 12    | Published `127.0.0.1:18099:4096` on a recreated `agency-docs` → live inspect shows the binding → fails; re-rendered and recreated without it.                                         |

## 4. Not performed

None. 0 skips; every check ran.

## 5. Not built

Per the stage prompt: the Dispatcher, the verifier, landing (1c); the
`fleet` MCP server, REST, Director planning behaviour, gateway, dashboard
(1d); `qa-functional` / `qa-adversarial` (2a); extended experts (4a); no
published host ports. Not installed (see build notes for reasons): `vale`,
`atlas`, Docker CLI, Go/Rust/JDK toolchains. `mcp-grafana` and
`chrome-devtools-mcp` binaries are verified but installed only with their
extended experts in Stage 4a.

## 6. Deviations

Build-notes deviations (compose omits Podman-only `userns_mode`;
explicit per-service maps instead of the `x-expert` anchor; `postgres-mcp`
binary instead of `uvx`; remote `sentry`; `VERDICT` closings for
security/reviewer; explicit `container_name`/`image`) all stand — see
`docs/build-notes.md`.

Close-out deviations (all in this tree, all documented in-check):

- `scripts/smoke.sh`: transport errors in the three settle loops retry
  inside the unchanged 36×5s budget instead of failing instantly. Same
  assertions, same final verdicts; a down server still fails after the
  window. Justification: §7.
- `scripts/accept/1b/09-unique-passwords.sh`: removed the `sleep 2`
  pacing between cross-password probes (uncommitted residue). It made the
  check unable to pass: 132 sleeps ≈ 264s against the 120s per-check
  harness budget (proven: timeout, exit 124). Assertions unchanged; the
  run takes ~20s and shows no wedge. The "rapid probes wedge opencode"
  mechanism was unconfirmed even in its own comment.
- `scripts/accept/1b/07-egress-allow-deny.sh`: log poll 12×5s → 18×5s,
  assertion byte-identical. Longer waiting cannot false-pass; the
  proxy-stopped red still fails earlier at the probe step. Justification: §7.
- `scripts/workspace-init.sh`: `set -e` plus an explicit `cp` guard
  (fail-open fix, §7). Behaviour on success is unchanged.

## 7. Proposed corrections

- **06 root cause (fixed, not weakened).** `GET /api/agent` is a valid
  2.0.26 route (confirmed against the live `/openapi.json`:
  `agent.list` returns "currently registered agents"). Renderer output
  for reviewer was correct (`default_agent: reviewer`,
  `agents/reviewer.md` mounted, persona served). The failure was a
  startup race: `/api/info` returns 200 (hence `healthy`, hence 05 green)
  while `/api/agent` is still `{"data":[]}` or the listener is not up
  yet — proven by restarting one expert and polling both routes
  (connection refused → `info 200 + agent []` → persona present ~6s
  later). Smoke retried assertion mismatches 36×5s but failed instantly
  on any curl transport error (`|| fail ... unreachable`); one transient
  during reviewer's window killed the run after qa had passed. Fix: retry
  transport errors inside the same budget. Validated by restarting the
  whole fleet and running `make smoke` straight into the boot window:
  green in 90s.
- **Fail-open `workspace-init.sh` demo leg (fixed).** Red-11 attempt
  moved the fixture away and the check still passed: without `set -e`,
  a failed `cp` fell through to `git init/add/commit` (failures ignored)
  and the script printed "demo workspace ready", exit 0, on an empty
  directory. The check's directory assertions then passed on nothing.
  This is the audit's failure class (work reported finished when it was
  neither). Fixed fail-closed; red-11 now goes red correctly.
- **07 log-mirror lag (tolerated, not fixed).** Three clustered 07
  failures showed probes returning 2xx/403 while the `docker logs`
  mirror showed no lines for >60s; the authoritative
  `/var/log/squid/access.log` (persisted on a volume) and the mirror
  agree outside those windows, and a manual probe→log round-trip takes
  <3s. The mirror is `tail -F` behind `docker logs`; under host load it
  can stall. The check now waits longer with identical assertions.
- **Shared-host contention (note for the verifier).** The host rebooted
  mid-stage (`uptime`: up 31 min at ~01:00Z; whole fleet recreated
  ~00:30Z). The persistent squid log shows 07-shaped probe batches at
  00:35:48 and inference tunnels to `models.opencode.ai` from all twelve
  experts in ~5-minute lockstep batches through 00:57 — i.e. another
  driver is using this fleet concurrently (long-lived tunnels up to
  ~300s, one 62-minute `opencode.ai` tunnel). Load averaged ~12–14 on 32
  cores during close-out. Prefer a quiet box for the verification pass;
  if 06/07 ever flake there, re-run before doubting the tree.

## 8. Next

- Stage 1c needs: this branch merged after a PASS verification; the
  provider key (`.env.provider`) and `AGENCY_MODEL` in `.env` (both
  gitignored, mode `0600` — never commit, never print); image tags
  `agency-<expert>:2.0.26` / `agency-egress:1.0.0`; the demo workspace at
  `workspace/demo/` (gitignored; rebuild with
  `make workspace ARGS="demo --demo"`); per-expert passwords
  `PW_<NAME>` and proxy identities `PROXY_PW_<NAME>` in `.env`.
- Known roughness for 1c: `/api/agent` (and by the same mechanism
  `/api/skill`, `/api/mcp`) is empty for a few seconds after every
  (re)start while `/api/info` is already 200 — the Dispatcher must treat
  "healthy" as "reachable", not "ready", and poll with a budget.
- Nothing is asked of the user. Do not merge this branch here; the master
  merges after verification.
