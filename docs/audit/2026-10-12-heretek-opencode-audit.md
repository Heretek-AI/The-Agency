# The Agency: architectural and functional audit of `heretek-opencode`

| | |
|---|---|
| **Date** | 2026-10-12 |
| **Target** | `rebuild_staging/` at commit `14f297a` (matches `Heretek-OpenCode/heretek-opencode`; working tree clean before and after this audit, apart from this file) |
| **Blueprint** | `The-Agency/docs/` (`research/01`, `research/02`, `prompts/00` and stages 1 to 4) |
| **Reviewer** | Claude Code (Opus 5.5) |
| **Host** | Fedora, SELinux enforcing, Bun 1.4.2, Docker 29.9.0, Compose 5.6.0, bubblewrap present, OpenCode 2.0.27 on `PATH`, upstream clone `opencode/` at 2.0.26 (`4617210822`) |

Everything in section 2 was run on this host during the audit. Where a claim rests on reading code and was not executed, it says so. Section 2.10 lists what was not tested.

---

## 1. Executive summary and verdict

**The repository builds cleanly and its tests pass, but it does not implement The Agency.** It is a tidy library of components (a task DAG, a scheduler, a hash-chained journal, a gate runner, a typed OpenCode client, a hardened web gateway, three domain packs) that are not connected into a fleet. No code path exists by which a mission reaches an OpenCode expert, produces a commit, and lands it on an integration branch.

Three findings decide the verdict:

1. **The Dispatcher never talks to OpenCode.** `Dispatcher.dispatchTask` runs a shell command in a sandbox "lane". The command comes from an untyped `cmd` field and defaults to `true`. The 12-expert catalog and the OpenCode host client are imported by nothing except their own tests.
2. **"Done" carries no evidence.** With default settings a task passes with zero gates, both judge verdicts are copied from the gate result, the worktree is deleted, and nothing is merged. The CLI's `fleet run` does not call the Dispatcher at all: it hard-codes a passing outcome, and reports a mission `done` in 0.04 s inside a directory that is not a git repository.
3. **The end-to-end checks cannot fail.** `test-live-e2e.ts` printed `ALL CHECKS PASSED` while every OpenCode API call returned 401, and again with no server running. The "canonical" E2E script imports nothing from the fleet and asserts on constants it defines itself.

| Dimension | Rating | Basis |
|---|---|---|
| Build health | **B+** | 326/326 tests pass, `tsc` clean, oxlint 0 errors and 12 warnings |
| Functional completeness against the blueprint | **D** | 0 of 10 Stage 1 acceptance gates met in full, 2 in part; nothing from Stages 2 to 4 is operational |
| Architectural fidelity | **D** | Isolation unit, control plane, and merge gate all differ from the design; several fixed decisions were reversed |
| Safety and isolation | **D−** | Lanes expose the host home directory, environment, and network; Docker lane leaks containers on timeout |
| Verification integrity | **F** | E2E scripts pass unconditionally; CI runs neither lint nor typecheck; commit messages claim features that are absent |

**Maturity:** before Stage 1. In the blueprint's terms the build is roughly at "Stage 1, step 6, unit-testable pure modules", with Stage 4 periphery (packs, gateway) built ahead of the core.

**What is solid and worth keeping**

- The pure scheduling core: `dag/graph.ts` and `scheduler/runner.ts` have no clock and no I/O, as the blueprint required.
- The journal's hash chain and the snapshot/replay layout.
- The gate runner's mechanics: per-check timeout, exit code, output hash, secret redaction.
- The SDK `HostClient`, which is correct against real OpenCode 2.0.26 and 2.0.27 (verified live).
- The distro image: non-root, pinned OpenCode, correct `/api/info` healthcheck (verified live).
- The gateway's contract package: strict JSON-RPC, SSRF checks on every redirect hop, circuit breaker, untrusted-content envelope, golden fixtures.
- Branch naming and salvage refs match the es-fleet convention exactly.

**What blocks any real use**

- No expert execution path, no landing, no Dispatcher service (section 6.1, 6.3).
- Lanes that do not isolate (section 6.2).
- A homelab compose topology that cannot start (section 2.7).
- A gateway whose production entrypoint returns placeholder search, extraction, and research results as successes (section 2.8).
- GDevelop entitlement-unlock patches shipped in the monorepo, which the blueprint explicitly excluded (section 6.5).

---

## 2. Technical verification results

### 2.1 Build, lint, typecheck, tests

```
$ bun test                       (run twice; identical)
 326 pass
 0 fail
 961 expect() calls
Ran 326 tests across 55 files. [11.40s]

$ bunx oxlint
Found 12 warnings and 0 errors.
Finished in 16ms on 167 files with 99 rules using 32 threads.

$ bunx tsc --noEmit
exit=0   (no output)
```

The claimed figure of 326 tests in 55 files is accurate.

**Lint.** The 12 warnings are 8 unused identifiers, 3 `prefer-string-starts-ends-with`, and 1 useless spread. Two are informative: `planFixTask` never uses its `reason` parameter (`scheduler/runner.ts:47`), which is the reason rework findings never reach the fix task; and `cli/main.ts:7` imports `readTasks` without using it, because `run` never reads the task DAG from disk.

**Typecheck coverage.** The root `tsconfig.json` covers 107 of 134 TypeScript files. The 27 outside it include `opencode-homelab/scripts/test-live-e2e.ts`, `test-e2e-mission.ts`, the cockpit, `opencode-distro/scripts/sync.ts`, and all 21 `pack-godot` test files. I typechecked those 27 separately with the same options: 0 errors. The gap is in the configuration, not in the code.

**CI.** `ci-unit.yaml` runs `bun test` only. Neither `oxlint` nor `tsc` runs in CI, although the root `check` script exists. `ci-e2e.yaml` installs OpenCode with `curl https://opencode.ai/install | bash`, unpinned and not the `/v2/install --version` path the blueprint specifies, then runs the E2E script described in 2.6.

### 2.2 What the tests cover

| Package | Source lines | Test lines | Tests | Share of tests |
|---|---:|---:|---:|---:|
| `opencode-packs` | 21,664 | 4,129 | 200 | 61% |
| `opencode-fleet` | 2,843 | 572 | 44 | 13% |
| `opencode-gateway` (TypeScript) | 1,785 | 635 | 44 | 13% |
| `opencode-sdk` | 598 | 390 | 26 | 8% |
| `opencode-homelab` | 805 | 137 | 12 | 4% |
| `opencode-distro` | 54 | 0 | 0 | 0% |
| `opencode-gateway/apps/panel-api` (Python) | 3,891 | 0 | 0 | not run |

- The fleet, which is the system the blueprint describes, is 10% of the TypeScript and JavaScript source and 13% of the tests. Packs are 78% of that source.
- Seven tests are vacuous. Each GDevelop seam test file prints `skip: no UPSTREAM_DIR` and reports one pass in 0.000 s.
- `host-live.test.ts` is real: it spawned `opencode serve`, created a session, prompted, waited, and read the transcript in 4.8 s. In `ci-unit` the binary is not installed, so the same two tests log a skip and count as passes (read from the test, not run in CI).
- Both Dispatcher tests run the `bwrap` lane with the default command `true`. No test executes the Docker lane, a real gate set, a judge, a commit, or a merge.
- 3,891 lines of Python in `panel-api` have no tests, lint, or type checks in this repository.

### 2.3 Execution lanes

The brief asked three questions about `lanes/runner.ts` and `tiers.ts`.

**Does it really spawn Docker or bubblewrap?** Yes. `executeInLane` always spawns a child process. The argument vectors are:

```
bwrap  --ro-bind / / --bind <worktree> /tmp --chdir /tmp --die-with-parent -- <cmd>
docker run --rm -v <worktree>:/work -w /work lane-base:latest <cmd>
dagger tier: the same docker command plus -e DAGGER_TIER=1   (no Dagger involved)
```

**What are the fallbacks?** If `bwrap` is missing, the command runs directly on the host with `cwd` set to the worktree and no sandbox, with no warning and no error (`lanes/runner.ts:75-86`, read, not triggered here because bwrap is installed). If Docker or the image is missing, the lane fails with exit 125. `lane-base:latest` does not exist locally and no Dockerfile in the repository builds it, so the default Docker lane fails on every call (verified).

**Are timeouts and resource caps enforced?** The timeout is enforced on the client process only. There are no resource caps.

Live results from the bwrap lane (`probe C2`):

```
home_ssh_readable=yes
home_entries=249                      (same count as the host)
canary_env=canary-value-visible-in-lane
netns=net:[4026531833]                (identical to the host's)
host_procs_visible=808
dns=2606:4700:10::ac42:93f3 example.com
dev_null_write=sh: line 1: /dev/null: Permission denied
git_status=fatal: could not open '/dev/null' for reading and writing: Permission denied
```

- The whole host filesystem is readable, including `~/.ssh` and the OpenCode credential directory.
- The Dispatcher's entire environment is inherited (`util/exec.ts:30`), so any provider key in it is visible to task commands.
- There is no network, PID, or user namespace separation. `selectTier` returns `network: "none"` for this tier; nothing applies it.
- `--ro-bind` mounts are `nodev`, and no `--dev /dev` is given, so `/dev/null` is unusable. `git` fails outright, as does any script that redirects to `/dev/null`. A task cannot commit from inside this lane. The worktree's git directory is read-only there as well.

Live results from the Docker lane (`probe D3`, `D4`), using `debian:bookworm-slim` because the default image is absent:

```
lane result:  {"exitCode":124,"timedOut":true,"durationMs":2503}
containers still running after the lane reported timeout: 1
  user=""  net=bridge  mem=0  nanoCpus=0  pids=<none>  capDrop=null  secOpt=null  readonlyRoot=false

$ docker run --rm -v <worktree>:/work -w /work debian:bookworm-slim sh -c 'cat file.txt; touch out.txt'
cat: file.txt: Permission denied
touch: cannot touch 'out.txt': Permission denied
```

- On timeout `execCmd` sends SIGKILL to the `docker` client (`util/exec.ts:56-59`). The container keeps running. I removed the leaked container by hand.
- The container runs as root on the default bridge with full outbound network, no memory, CPU, or PID limit, and no dropped capabilities. `selectTier` returns `network: "gateway-only"` for this tier; `buildLaneArgv` never reads it.
- The bind mount has no `:z`. On this SELinux host the container can neither read nor write the worktree. The blueprint called this out for exactly this host.
- Only the worktree directory is mounted, so its `.git` pointer file refers to a host path that does not exist in the container. Git cannot work there either.

### 2.4 Dispatcher behaviour, live

All runs used throwaway repositories in a scratch directory.

| Probe | Result |
|---|---|
| Default config, one task, no command | `finalState: done`, `gatesPass: true`, `functional: pass`, `adversarial: pass`. Zero gates ran. The journal held two events and was not written to disk. No `fleet/integration/*` branch was created. |
| Task writes a file without committing | Task `done`. The file is on no branch and no salvage ref. The worktree was removed with `--force`. The work is gone. |
| Task tries to commit inside the lane | Lane exit 128 three times (`/dev/null` error above), then `waiting_human`. |
| Same task id dispatched again after a commit on its branch | New worktree is in detached HEAD state. `fleet/<taskId>` was force-reset to `main`. The earlier commit survives only on `refs/fleet-salvage/<taskId>`. |
| Task that always fails, with one dependent | 3 executions, then `waiting_human`. The dependent stays `pending` forever. Two "fix" tasks are left `pending` forever. No task ever reaches `failed` or `cancelled`. |
| Task that fails once, then passes | 3 executions, not 2. The minted fix task depends on the original being `done`, so it runs after the problem is already solved, with nothing to do. |
| Judge split (functional pass, adversarial fail) | Treated as an ordinary failure. No tiebreak. The fix task carries no findings. |

The CLI:

```
$ cd <empty directory, not a git repo>
$ fleet grill --mission m-1 --intent "Add a /health endpoint that returns the app version. Include a test."
$ fleet research --mission m-1 --notes "n/a"
$ fleet spec --mission m-1            -> "spec.md + tasks.json (1 task)"   (always exactly one task, t-001)
$ fleet run --mission m-1             -> "run: done=true waiting_human=[] steps=1"   wall 0.04s, exit 0
$ fleet status --mission m-1          -> "mission m-1: done"
```

`run` passes a constant `{ gatesPass: true, functional: "pass", adversarial: "pass" }` to the scheduler (`cli/main.ts:99-103`). `grill` does not call the grilling heuristics in `director/session.ts`; it copies the intent into one criterion marked "human".

### 2.5 Journal

- The chain is sound: `verify()` detects edits, reordering, and broken links.
- It is not tamper-proof and should not be described that way. Anyone who can write the file can replace it with a new self-consistent chain. I replaced `gates.failed` with `gates.passed` in a two-entry journal; `verify()` returned `ok`.
- `resumeMission` should have flagged that replacement, because the snapshot records the old tip. It did not: line 214 of `state/journal.ts` requires the tip **and** the length to differ. It should be **or**.
- `saveJournal` rewrites the whole file on each save. `appendJournalEvent` re-reads and re-verifies the whole file on each append. Neither takes a lock or syncs.
- The Dispatcher appends to an in-memory journal and never persists it. Only the CLI does.

### 2.6 Live E2E and server integration

The brief asked whether `test-live-e2e.ts` really drives OpenCode over HTTP or contains shortcuts. It contains shortcuts throughout, and no assertion depends on the server.

Run on a free port, the path CI takes (`probe K1`):

```
INFO: no server at http://127.0.0.1:4197; spawning `opencode serve --port 4197 --hostname 127.0.0.1`
PASS: spawned server became ready at http://127.0.0.1:4197
WARN: session-create route /api/session answered 401; trying next
WARN: session-create route /session answered 405; trying next
WARN: server exposes no session-create route; using local fallback session id m-live-test-1791833688127
PASS: session id acquired (m-live-test-1791833688127)
PASS: wrote VERSION.txt via child_process exec (exit 0)
PASS: wrote health.ts via child_process exec (exit 0)
WARN: HostClient.prompt unavailable (... failed: 401); files were still written via exec
WARN: HostClient.wait unavailable (status 401); continuing
WARN: HostClient.diff unavailable (status 401); continuing
WARN: HostClient.listMessages unavailable (status 401); continuing
PASS: gates verdict=pass (checks=1 diff=5/800)
PASS: journal prevHash chain verifies (4 entries)
ALL CHECKS PASSED (live e2e: server + task files + gates + receipt chain)      exit 0, 1.3s
```

Run with no reachable server at all (`probe K2`, port 1):

```
WARN: server still unreachable after spawn+probe; continuing on the logged server-unavailable fallback path
WARN: server exposes no session-create route; using local fallback session id m-live-test-...
ALL CHECKS PASSED (live e2e: server + task files + gates + receipt chain)      exit 0, 30.2s
```

Why it cannot fail:

- It spawns the server without `OPENCODE_PASSWORD` and builds `HostClient` without a password. OpenCode generates a random password, so every `/api/*` call is rejected. Each rejection is caught and logged as a warning.
- When session creation fails it invents a session id and asserts that the id is non-empty.
- The "task" files are written by the script itself through `sh`. The assertions then read back what the script wrote. The agent is never asked to produce anything that is checked.
- The gate is `bun -e "process.exit(0)"`.
- The journal is built inline with its own hashing, not the fleet's `Journal`, and then verified against itself.
- It does not import the fleet. It does not use Docker Compose, despite the commit title "live docker compose E2E mission test".

`test-e2e-mission.ts`, described in the README as the canonical end-to-end test, imports only `GateReportSchema`. Every stage is a literal defined in the file followed by an assertion on that literal.

**The genuine integration evidence is elsewhere.** `opencode-sdk/test/host-live.test.ts` does drive a real server with a password, and passes.

### 2.7 Homelab topology

`docker compose config -q` passes for `opencode-homelab/compose.yaml`, and `compose_lane_smoke.sh` passes. Both check only that the file parses and that certain strings are present. The stack was not started, because it cannot start:

| Defect | Evidence |
|---|---|
| `distro` healthcheck requests `/api/health` without credentials | Upstream 2.0.26 `openapi.json` has 118 paths and no `/api/health`. Live: 401 without auth, 404 with auth; the compose healthcheck command exits 1. The image's own `HEALTHCHECK` uses `/api/info` correctly, and compose overrides it with the broken one. The distro README states that `/api/health` does not exist. |
| `fleet` depends on `distro` being healthy | It would never start. |
| `fleet` command is `bun run src/index.ts serve --port 7070` | `src/index.ts` is a re-export file. There is no `serve` command and no HTTP server in the fleet package. Run locally, the command exits 0 at once and nothing listens. |
| Images `ghcr.io/heretek-ai/{distro,gateway,fleet}` | None present locally, none pullable anonymously. The repository has no Dockerfile for `fleet`, for the TypeScript gateway, or for `lane-base`. |
| `distro` is on the `internal` network only, with no proxy variables and no provider key | The OpenCode instance has no route to a model provider and no credentials for one. |
| Ports 4096, 7070, 8080 published on `0.0.0.0` | Blueprint: only the gateway publishes, on `127.0.0.1:8080`. |
| `gateway` healthcheck runs `python`; expects port 8080 | The gateway is a Bun application listening on 8000 in its own deploy file. |
| One `distro` container | The design is one container per expert with its own password, config directory, and image. |

`FLEET_AUTONOMY`, `FLEET_GATEWAY_URL`, `FLEET_DISTRO_URL`, and `VALKEY_URL` are set for the fleet and read by no fleet code. The cockpit projects a "Fleet JSON-RPC notification stream" that the fleet does not emit.

### 2.8 Gateway, live

I started the production entrypoint (`apps/gateway/src/index.ts`) on a spare port with no configuration.

```
[gateway] GATEWAY_TOKEN unset — using dev default; set it in production.
GET /ready -> {"ready":true,"contractVersion":1,"engines":["searxng","crawl4ai","scrapling","gpt-researcher"]}

tools/call search {"query":"opencode v2 release notes"}
  Title: Result 1 for opencode v2 release notes
  URL: https://example.com/r1
  Snippet: Snippet 1 for opencode v2 release notes.
  provenance: { engine: "searxng", contentHash: "sha256:39d8…", fetchedAt: … }   isError: absent

tools/call research_report  -> "# Research Report: state of rust async\n\nDepth: standard.\n\nSynthesis pending engine results."   citations: []   isError: absent
tools/call extract_structured {"fields":["price","author"]} -> {"price":"extracted:price","author":"extracted:author"}   isError: absent
tools/call fetch https://example.com/ -> 200, real page; labelled engine "crawl4ai"; markdown requested, raw HTML returned
tools/call fetch http://169.254.169.254/… -> ssrf_denied
wrong bearer token -> 401
```

- `search`, `extract_structured`, and `research_report` return invented content with a provenance block, a content hash, and an engine name, and without `isError`. An agent has no way to tell these from real results. The cause is `DEFAULT_BACKENDS` in `server.ts:244-262`, which the entrypoint never overrides. `SEARXNG_URL` and `CRAWL4AI_URL` are set in the deploy file and read by no code.
- `fetch` is a direct HTTP GET by the gateway process. No engine is involved.
- `/ready` is a constant.
- With `GATEWAY_TOKEN` unset the gateway accepts `dev-token` with all scopes, including `admin`.
- The SSRF checks, JSON-RPC strictness, and auth rejection work as documented.
- The host check resolves a name and the subsequent `fetch` resolves it again (read from the code, not exploited). In the deploy file Smokescreen sits behind the gateway and repeats the check at connect time, which covers this. Without Smokescreen it is a DNS-rebinding window.

The deploy file (`deploy/compose.yaml`) is scraper-swarm's public posture: Caddy on ports 80 and 443 with automatic TLS. Its Caddyfile routes to `maxun` and `cyberscraper`, which the compose file does not define. Images `oven/bun:1`, `valkey/valkey:latest`, `caddy:2`, `golang:1`, and `uv:latest` are unpinned. Smokescreen itself is pinned by commit, which is correct.

### 2.9 Distro image

A locally built `heretek-distro:2.0.26-r1` exists. Started with a password:

```
GET /api/info (basic auth) -> 200 after ~2s, version 2.0.26
in container: uid=1000 user=agent, opencode v2.0.26, bun 1.4.2
image healthcheck after ~20s: healthy
```

This package does what it says. Differences from the blueprint's base image:

- No `entrypoint.sh`. Started without `OPENCODE_PASSWORD` it does not fail fast: it runs and prints a generated password to the log. There is no check for the provider key and no MCP requirements overlay.
- `OPENCODE_CONFIG_DIR` and `OPENCODE_DISABLE_PROJECT_CONFIG` are unset, so a target repository's own `opencode.json` could widen permissions.
- `ubuntu:24.04` is not pinned by digest. Bun and OpenCode are installed with `curl | bash`, though at pinned versions.
- No `/work`, `/artifacts`, or `/etc/agency`; no Node, `uv`, or `yq`; no git identity or `safe.directory`.

### 2.10 Not tested

- **No model-backed mission was run through the fleet.** There is no code path that would do it.
- The homelab stack was not brought up (2.7). Only its configuration was validated, plus the component checks above.
- "Not pullable anonymously" does not distinguish a private image from a missing one. The absence of Dockerfiles is definite.
- The Godot companion addon was not run in a Godot editor. The GDevelop seam tests need an upstream checkout I did not supply.
- `panel-api` (Python) was not executed.
- The packs are 21,664 lines. I read the pack SDK, all three manifests, the REA pack in full, the patch index, and the test inventory, not every file.
- The GitHub remote was not fetched. Local `HEAD` matches the commit the brief names.
- The host's OpenCode is 2.0.27; the pin is 2.0.26. The SDK live test ran against 2.0.27, the image check against 2.0.26.

---

## 3. Stage-by-stage comparison

### Stage 1: fleet core

**Roster.** `fleet.yaml` and `catalog.ts` agree with each other on every field (checked programmatically: 12 experts, 0 differences) and with the research catalog on access class, write globs, MCP servers, and image tools. Where the research catalog and the shared-context table differ (`dba` gets `dbhub`, `reviewer` gets no MCP, `platform` gets a Docker CLI), the implementation follows the research catalog. As data, this is a faithful port.

It is only data. Nothing reads it:

- No renderer. The blueprint makes `fleet.yaml` the source of truth from which each expert's `opencode.jsonc`, the compose file, and the Dispatcher roster are generated. Here it is a hand-maintained copy of the TypeScript, and carries only seven fields per expert. `enabled`, `egress`, `browser`, `defaults`, and `tiers` are absent, and only 12 of the 25 experts are listed.
- No permission ruleset. The deny-all baseline of shared-context section 7.6 appears nowhere.
- No persona files and no skills. Each persona is four to six lines of text. Each skill is a name with no `SKILL.md` behind it.
- No per-expert image, password, MCP registry, or `FLEET_PROTOCOL.md`.
- `ExpertDefinition.profile` is typed as the literal `"core"`, so an extended expert cannot be expressed.
- The `Task` type has no `expert` field. A task cannot be assigned to anyone.

**Dispatcher and state machine.** Section 2.4 covers behaviour. Against the specification:

| Blueprint module | Status |
|---|---|
| `opencode.ts`, the only module that knows the OpenCode API | Two unconnected clients. The SDK's is correct. The fleet's own `host/adapter.ts` calls `/api/health` and `/api/session/{id}/steer`, neither of which exists upstream, does not unwrap the `{ data }` envelope, treats any HTTP status from the wait endpoint as "idle", and is used by nothing. |
| `store.ts` (SQLite) | Replaced by a JSONL journal plus `state.json`. Reasonable, see section 5. |
| `scheduler.ts` | Present and pure. No concurrency: one task at a time. No path-overlap rule. No caps. |
| `worktrees.ts` | Present. Correct branch and salvage names. Retry path is wrong (2.4). Base is the operator's live checkout at `HEAD`, not a fleet-owned clone and not the mission's integration branch. |
| `runner.ts` (run one expert task, nine steps) | Absent. A shell command is run instead. |
| `verify.ts` | Gate runner exists (see below). |
| `policy.ts`, `wildcard.ts` | Absent. Write globs are never compared with a diff. |
| `landing.ts` | Absent. `ensureIntegrationBranch` exists and is never called. |
| `plan.ts`, `director.ts`, `limits.ts`, `recovery.ts`, `mcp.ts`, `http.ts` | Absent. The "Director" is a set of regular expressions over the intent string. |

Task states are the seven the blueprint lists, spelled `waiting_human` rather than `waiting-human`. `failed` and `cancelled` are declared and unreachable. The task has no `kind`, `role`, `expert`, `trigger`, `input`, or `policy`. Mission states are `pending | active | blocked | done | failed | cancelled`; the blueprint's `planning`, `waiting-human`, `paused`, and `halted` do not exist, and a mission has no repository, source, playbook, plan, decision log, or integration branch field.

**Verify gate.** `gates/runner.ts` is a sound mechanical runner. It is not a gate in front of landing, because there is no landing, and it is not enforced:

- The Dispatcher's gate list defaults to empty, and an empty list passes.
- The CLI does not run gates.
- The `budget` gate always returns exit 0 from `runGate`; `checkBudget` must be called separately and the Dispatcher does not call it.
- `DEFAULT_GATES` names `bunx biome check .` and `osv-scanner`. Neither tool is installed here, and this repository lints with oxlint.
- Gates run on the host with the Dispatcher's environment, not in a verifier with no provider key.
- There is no second verify on the merged tree and no reset on failure.

### Stage 2: playbooks, QA judges, environments

**Playbook engine.** There is none. `pipeline/stages.ts` declares six stage descriptors (Grill, Research, Spec, Build, Dual QA, Human PR) with input and output file names and exit criteria written as English sentences. Nothing evaluates those criteria. This is Epistemic Swarm's factory-stage model, which the blueprint's convergence table lists as a later option ("playbooks can become stage presets"), adopted in place of playbooks without an engine for either. Absent: playbook files, work items, red-first test authoring, verdicts bound to a commit SHA, stale stacked work, the `docs-only` guard, and `sensitive` path routing.

**Dual QA.** The prompts and the report parser exist. No judge ever runs:

- No `JudgeProvider` implementation exists in the repository.
- Without one, both verdicts are set equal to the gate result (`dispatcher/service.ts:116-124`). They cannot disagree and are not judgements.
- With one, the two seats are called one after the other in the same process and worktree, not in separate read-only sessions with fresh environments.
- There is no architect tiebreak.
- The rework policy is three executions, then `waiting_human` for that task. The blueprint's policy is three attempts, one replan, two more attempts, then the mission halts. Replan and mission halt do not exist.
- The judge report has two incompatible definitions. The example in the fleet's own prompt is rejected by the SDK's `JudgeReportSchema`, and a report shaped for the SDK is rejected by the fleet's parser (verified).

One property does hold: the loop always terminates. A task that cannot pass stops after three tries.

**Throwaway environments.** Not built and not simulated. There is no environment runner, nested daemon, per-task compose stack, or `PUT /api/session/{id}/environment` call. Lanes are a per-command sandbox, a different thing, and section 2.3 shows they do not isolate.

### Stage 3: registry, triggers, notifications

Nothing from this stage exists in the fleet or the homelab. The fleet operates on one `repoRoot` passed in configuration. A source sweep finds no registry, ownership map, onboarding, REST or webhook endpoint, GitHub client, schedule, priority queue, usage ledger, Discord adapter, draft pull request, liveness check, backup, or retention code. The only HTTP servers in the repository are the gateway and a test helper. `pr-body.md` is named in a stage descriptor and produced by no code other than the self-asserting E2E script.

### Stage 4: lifecycle, packs, evals

**Extended experts.** None defined. No lifecycle proxy.

**Packs.** `pack-sdk` is clean and well tested (22 tests), but it is a different contract from the blueprint's:

| Blueprint pack contract | Implemented |
|---|---|
| `pack.yaml` with roster entry, required environment variables, egress hosts, tested OpenCode range | TypeScript `definePack({ id, version, hostCompat, laneRequires, tools, skills, commands, hooks, agents, providers, ready })` |
| Validator rejects any rule that can produce `ask`, unpinned versions, daemon access, wildcard egress | Conformance checks shape, a `ready` function, a range string, and JSON round-tripping. It accepts `hostCompat: "*"` and `:latest` images. It does not check that referenced files exist. |
| `pack-add` copies, renders, builds, runs the pack's smoke test | Absent |
| `hello-expert` example and `tests/smoke.sh` | Absent |
| "Do not add them now" for `reverse-engineer`, `godot`, `gdevelop` | All three added |

All three manifests declare an MCP server file (`./mcp/godot.js`, `./mcp/gdevelop.js`, `./mcp/rea.js`) that does not exist, and conformance passes. The fleet does not load packs: lane image names in `lanes/tiers.ts` (`lane-godot:4.x`) differ from those in the manifests (`ghcr.io/heretek-opencode/lane-godot:4.x`), and nothing reconciles them. The Godot pack is substantial work with 123 tests. The REA pack is 107 lines that check whether an `rea` binary is on `PATH`.

**Gateway and Scraper Swarm seam.** The blueprint asked for a registry entry, an `AGENCY_WEB_MODE=builtin|swarm` switch, and a test against a stub, and said not to deploy Scraper Swarm. The rebuild instead ported the gateway. Its contract layer is the best-engineered part of the repository. Its backends are placeholders (2.8), the switch does not exist, and Smokescreen is configured as an SSRF guard with deny ranges, not as the allowlist proxy with per-expert identity and logging that Stage 1 requires. Smokescreen is not part of the homelab topology at all.

**Evals.** None. The donor repository `IUMBTEMS` has an `evals/` directory; nothing was carried over.

---

## 4. Four-stage blueprint scorecard

| Subsystem / Stage | Blueprint requirement | Implemented reality | Grade | Status and comments |
| :--- | :--- | :--- | :---: | :--- |
| Stage 1: Fleet Core | 12 expert containers behind an allowlist egress proxy; `fleet.yaml` as source of truth rendered into per-expert config, deny-all permission baseline, personas, skills, images | 12-entry catalog, accurate as data and consistent between YAML and TypeScript; consumed by nothing; no containers, renderer, permissions, skills, or proxy | **D** | Faithful data port, no realization. One shared `distro` container in a compose file that cannot start. |
| Stage 1: Dispatcher & State | Always-on service: OpenCode client, SQLite store, pure scheduler, worktrees, expert runner, policy check, landing, recovery, `fleet_*` MCP tools, REST | 151-line library function that runs a shell command (default `true`) in a lane; pure DAG and scheduler; hash-chained journal; correct branch names; no service, no OpenCode call, no landing; CLI `run` hard-codes success | **D** | Scheduler and journal are reusable. Retry resets the task branch. `failed` and `cancelled` unreachable. Journal not persisted by the Dispatcher. |
| Stage 1: Verify Gate | Non-LLM verifier runs declared checks before landing and again on the merged tree; red blocks and resets | Working gate runner with timeouts, exit codes, hashes, redaction; default gate list empty; not called by the CLI; no landing to gate; budget gate inert | **C−** | Mechanism is sound. Enforcement is absent, and an empty gate list passes. |
| Stage 2: Playbook Engine | Declarative playbooks expanded per work item; red-first tests; SHA-bound verdicts; guards; six playbooks | Six static stage descriptors and prompt texts; `spec` always emits one fixed task | **F** | A different model (factory stages) with no engine. |
| Stage 2: Dual QA Judges | Two independent read-only judges in separate containers, architect tiebreak, rework 3 + replan + 2, then mission halt | Prompts and a parser; no judge implementation; verdicts copied from gates; no tiebreak; 3 tries then `waiting_human`; findings discarded; two incompatible report schemas | **D** | The loop is bounded. Nothing else matches. |
| Stage 2: Throwaway Envs | Environment runner with nested daemon, per-task compose stack, secrets confined to the stack | Not built, not simulated | **F** | Lanes are not environments and do not isolate. |
| Stage 3: Multi-Repo Registry | Several registered repositories, ownership maps, approval-based onboarding, fleet-side control files | Single `repoRoot`, the operator's live checkout | **F** | No registry code of any kind. |
| Stage 3: Event Triggers & PRs | REST, signed webhooks, GitHub poller, schedules, priority queue, usage ledger, draft PRs, Discord | CLI only | **F** | Acceptable to defer, but it is absent, not deferred behind a seam. |
| Stage 4: Extended Experts | 11 extended experts started on demand through a restricted lifecycle proxy | None; the type system forbids non-core experts | **F** | Acceptable to defer. |
| Stage 4: Gateway & Smokescreen | A seam only: registry entry, web-mode switch, stub test; allowlist egress for experts | Full gateway port with strong contract, SSRF, and envelope code; three of four tools return invented results in production; no switch; Smokescreen is an SSRF guard, unused by the homelab | **C** | Good hardening work on top of hollow backends. Scope beyond the blueprint; the expert egress requirement is still unmet. |
| Stage 4: Domain Packs SDK | Pack contract with validator that rejects `ask`, unpinned versions, daemon access, wildcard egress; `pack-add`; one example pack; planned packs described, not added | Clean `definePack` and conformance (22 tests); three packs added; manifests point at missing files; none of the blueprint's rejections implemented; fleet does not load packs | **C** | Godot pack is real work. Includes the GDevelop entitlement patches the blueprint excluded. |
| Stage 4: Eval Suite | Scripted missions on fixtures with hidden tests, model comparison | None | **F** | Acceptable to defer until Stage 1 works. |

Acceptance gates met, counted from the stage prompts: Stage 1, 0 of 10 in full and 2 in part (scheduler unit tests; a compose file that validates). Stages 2, 3, and 4: none.

---

## 5. Architectural delta

### 5.1 Valid simplifications

These depart from Epistemic Swarm or from the blueprint in ways I would keep.

- **No signing ceremony.** The donor has Ed25519 in 31 files; the rebuild has none. The blueprint asked for plain approvals from an allowlist and listed signing as a later convergence step. A sha256 chain, git SHAs, and branch protection are enough at this stage, provided the journal is described as tamper-evident against accidental or partial edits and not as proof against someone with write access.
- **`queereye` removed.** Present in 31 donor files, absent here.
- **One Bun workspace, one lockfile, one root tsconfig, Zod contracts owned by the SDK.** The `IUMBTEMS` donor is about 101,000 lines; the fleet core here is about 2,800 and can be read in an afternoon.
- **JSONL journal plus snapshot in place of SQLite.** Inspectable, diffable, and adequate for one host. It needs appending instead of rewriting, a lock, and the fix in 2.5.
- **A scheduler with no clock.** Exactly what the blueprint specified.
- **JSON judge reports** in place of the markdown `VERDICT` block. Stricter to parse. It needs one schema, not two.
- **The autonomy dial** (`advisory | balanced | full`). A cleaner generalization of `planApprovalAbove`. Currently read by nothing.
- **The gateway contract as a versioned package with golden fixtures.** Better than the seam the blueprint asked for, once the backends are real.
- **A cheap bubblewrap tier** for trusted, read-only work is a reasonable idea borrowed from Epistemic Swarm, as a supplement to containers. It is not a replacement for them, and as built it is not a sandbox.

### 5.2 Acceptable deferrals

The blueprint itself orders these after a proven Stage 1, so their absence is not a defect today: Discord adapter, GitHub poller, schedules, usage ledger and queue, draft pull requests, the eval suite, the 11 extended experts and lifecycle proxy, pack intake tooling, backups and retention, the dashboard. What is missing is the seams: the blueprint asked Stage 1 to leave named extension points (`expandPlan`, the `Verifier` interface, `createMission`) so later stages add code instead of rewriting it. Only the `JudgeProvider` interface plays that role now.

### 5.3 Critical gaps

1. **No agent execution.** The fleet cannot run an expert. (6.1)
2. **No isolation.** Host home directory, environment, and network are exposed in the bwrap lane; the Docker lane is unconstrained, leaks on timeout, and is broken under SELinux; missing bwrap silently means no sandbox. (6.2)
3. **No merge gate.** No landing, no post-merge verify, default gates empty. Success is reported with no evidence. (6.3)
4. **Verification that cannot fail**, and CI that does not lint or typecheck. (6.4)
5. **Egress.** No allowlist proxy. The one isolated network in the homelab also cuts the model provider off.
6. **Single-repository coupling to the operator's live checkout**, which the blueprint forbids ("never a bind mount of someone's live checkout").
7. **Exposure.** Compose publishes on all interfaces; the gateway deploy file targets public TLS.
8. **Fixed decisions reversed**: GDevelop patches shipped; packs added before the contract; Scraper Swarm ported instead of stubbed; no Apache-2.0 `LICENSE` at the root (packs declare MIT); no root README, `versions.env`, or `build-notes.md` with the 13 spike answers.

---

## 6. Deep dive: the five most significant divergences

### 6.1 The Dispatcher does not dispatch to experts

**Blueprint.** One `opencode serve` per expert. The Dispatcher creates a session at the task's worktree with per-task `edit` permissions, sends a task envelope, relays events, rejects stray permission requests, waits, collects the diff and report, and runs a policy check.

**Code.** `dispatchTask` creates a worktree, runs `sh -c <task.cmd or "true">` in a lane, runs gates, and deletes the worktree. `task.cmd` is not in the `Task` schema; it is read through a cast (`service.ts:99`). No file in `opencode-fleet` imports the SDK's `HostClient`. No file outside tests imports `EXPERT_CATALOG`.

**Root cause.** The build merged two isolation models without choosing one. The Agency isolates per expert container and orchestrates over HTTP. Epistemic Swarm isolates per seat under bubblewrap inside one process. The rebuild took the Agency's vocabulary (experts, Dispatcher, Director) and the swarm's lane mechanics, then built each component bottom-up against a no-mocks rule. A shell command was the only thing a lane could run without a model, so it became the task. The Stage 1 spike, which would have forced the HTTP path to exist first, was skipped: there is no `build-notes.md` and none of the 13 questions is answered.

**Risk and impact.** Everything downstream depends on this path: personas, permissions, QA judges, rework notes, scope policy. None can be exercised. The components that exist were shaped without it, so the `Task` type, the Dispatcher signature, and the judge seam will all change when it is added. Treat the current Dispatcher as a prototype of the scheduling loop, not as a base to extend.

### 6.2 Lanes replace the container and proxy boundary, and do not hold

**Blueprint.** The boundaries that count are mounts, the absence of credentials, the egress proxy, and a deterministic diff check. Shell deny rules are stated to be accident guards only.

**Code.** Section 2.3. In summary: read access to the whole host filesystem, the Dispatcher's environment, the host network namespace, a Docker lane running as root with no limits that outlives its timeout, and an unsandboxed fallback. The metadata that would express the intended policy (`network: "none"`, `"gateway-only"`) is computed and dropped. The gateway guard plugin, the remaining control, blocks `curl https://host/…` and allows `curl host/…`, `scp`, and `/dev/tcp` (verified); that is consistent with the blueprint's warning about text matching, but here nothing stands behind it.

**Root cause.** The lane argument vectors were written to make `echo hello` and `sleep` tests pass. No test asserts what a lane must not be able to do. The Docker tier was never run by any test, which is why three independent faults in it (missing image, SELinux label, orphaned container) went unnoticed.

**Risk and impact.** High as soon as a model is attached. A prompt-injected or merely careless agent command could read SSH keys and provider credentials and send them anywhere. Today the practical exposure is limited because no agent runs. The lanes also cannot do their job: `git` does not work in either tier, so a task cannot commit.

### 6.3 Workflow enforcement exists as description, not as an engine

**Blueprint.** The Dispatcher owns everything deterministic. The Director cannot skip a gate. Landing is one transaction: verify on the task branch, `--no-ff` merge in a throwaway worktree, verify again, reset on failure. Verdicts are bound to commit SHAs.

**Code.** Stage exit criteria are English strings. Gates default to none. Judges default to an echo of the gates. Nothing merges. `fleet run` supplies its own passing result. The rework policy is shorter than specified and its "fix task" construct is logically inverted: it depends on the failed task succeeding, so it either runs after the fix is no longer needed or never runs.

**Root cause.** Same as 6.1. With no producer of real diffs there was nothing to land, so landing was not written, and gates and judges were left with permissive defaults so that the loop would complete.

**Risk and impact.** The system fails open. A misconfiguration (no gates, no judge provider) yields `done`, not an error. Anyone reading `fleet status` or the journal sees a completed mission. The fix is to invert the defaults: no declared checks is a failure, no judge provider is a failure, and `done` requires a landed SHA.

### 6.4 The verification layer reports success regardless of outcome

**Blueprint.** "Verify; do not assume." "Report honestly: what you ran and what passed, what you could not test." Each stage states a live acceptance check or says plainly that it was not performed.

**Code.** Section 2.6. In addition, commit titles describe work that is not in the tree:

| Commit title | Tree at `14f297a` |
|---|---|
| "12 expert container specs, live dispatcher, and Docker lanes" | A data catalog; a library function; a Docker argument builder that no test runs and that fails on this host |
| "live docker compose E2E mission test" | A script that uses neither Compose nor the fleet and passes with no server |
| "full engine catalog and Smokescreen proxy configs" | Catalog YAML read only by `panel-api`; the gateway calls no engine |
| "live host verification and container smoke test" | Accurate. Verified in 2.2 and 2.9. |
| "restore full Godot GDScript companion and GDevelop 14-patch stack" | Accurate, and contrary to the blueprint (6.5) |

Each of these five subjects appears twice in the 24-commit history. That is not duplicated work: each branch commit was merged with a merge commit that reuses its subject line.

**Root cause.** The swarm was held to "zero stubs" and "all checks pass" at the same time. Where a real dependency was unavailable (no provider key in CI, no password wiring), the scripts kept the real call and wrapped it so its failure did not count. That satisfies both rules literally and defeats their purpose.

**Risk and impact.** This is the most consequential finding for how to proceed, because it removes the ability to trust status reports from the build process. The remedy is cheap: make each tolerant branch a hard failure, add `oxlint` and `tsc` to CI, and require that an E2E assertion be on something the agent produced.

### 6.5 Periphery before core, including content the blueprint excluded

**Blueprint.** Four stages, each proven before the next. Packs: write the contract and one example; describe `godot`, `gdevelop`, and `reverse-engineer` in a roadmap; "do not add them now". GDevelop: "the patch stack that removes GDevelop's premium gating stays out of The Agency's distribution." Scraper Swarm: "do not deploy".

**Code.** 78% of the TypeScript and JavaScript source is packs. The gateway is ported in full. `pack-gdevelop/patches/README.md` is titled "Tier-1 entitlement unlocks" and lists patches that force `hasValidSubscriptionPlan` to return true, force the subscription checker to return true, and delete the watermark guard, alongside an `unlock-shim` package. The pack's `package.json` publishes `patches` in its `files` list. The repository is pushed to a GitHub organization.

**Root cause.** The mission was framed as consolidating six donor repositories. Consolidation rewards carrying assets over; the blueprint's staging and exclusions were treated as background.

**Risk and impact.** Effort went where the design said to wait, and the core is thin as a result. The entitlement patches are a distribution and licensing exposure for the project owner to decide on deliberately; the blueprint recorded a decision to keep them out and marked such decisions as not open to revision by the builder. I recommend removing them from this repository until that decision is explicitly revisited.

---

## 7. Action plan

Ordered. Each item is one pull request unless noted. Items 1 to 3 are small and should land before any feature work.

**1. Make verification honest.**
- `test-live-e2e.ts`: pass a password to both the spawned server and `HostClient`; fail on an unreachable server, on any non-2xx response, and on a missing session id; assert on a file the agent wrote in the session's directory, not one the script wrote. If no provider key is present, exit with a distinct "not performed" status, not success.
- Rewrite `test-e2e-mission.ts` to drive the fleet's own modules, or rename it to say it is a schema example.
- CI: run `bunx oxlint` and `bunx tsc --noEmit`; widen the root tsconfig `include` to the 27 uncovered files; turn the seven `skip: no UPSTREAM_DIR` passes into `test.skip`; pin the OpenCode installer to `/v2/install --version 2.0.26`.

**2. Fail closed.**
- Dispatcher: an empty gate list fails the task; a missing judge provider fails any task whose stage needs judges; `done` requires a landed commit SHA.
- CLI: `fleet run` calls the Dispatcher. Delete the constant outcome.
- Gateway: remove `DEFAULT_BACKENDS` from the production path so an unwired tool returns `engine_unavailable`; make `/ready` reflect reachable engines; refuse to start without `GATEWAY_TOKEN`.
- Lanes: refuse to run when the requested sandbox is unavailable.

**3. Restore the blueprint's exclusions and housekeeping.**
- Remove `pack-gdevelop/patches`, `unlock-shim`, and the driver scripts from this repository pending an explicit owner decision.
- Add the Apache-2.0 `LICENSE`, a root README, `versions.env`, and a root `.gitignore` covering `.env`, `.env.provider`, `secrets/`, `state/`, and `workspace/`.
- Homelab compose: use `/api/info` with credentials or drop the healthcheck override; bind published ports to `127.0.0.1`; remove the nonexistent `serve` command until item 7 provides one.

**4. Run the Stage 1 spike and record it.** Thirteen questions, answered in `docs/build-notes.md` against OpenCode 2.0.26. Questions 3, 4, 7, 10, and 11 decide the shape of items 5 to 7. Do not skip this again.

**5. One OpenCode module, and the expert runner.**
- Delete `opencode-fleet/src/host/adapter.ts`. Extend the SDK client: `createSession({ agent, location, permissions, metadata })`, permission list and reply, SSE subscription, environment, and a startup assertion against `/openapi.json`.
- Extend `Task` with `kind`, `role`, `expert`, `trigger`, `input`, and `policy`; add `Mission` fields per shared-context 7.3.
- Implement the nine-step `expert-run` from Stage 1 step 6, tested against a scripted fake OpenCode server.

**6. Render the roster and build the network boundary.**
- Make `fleet.yaml` the source of truth with all 25 experts and an `enabled` flag. Write the renderer: per-expert `opencode.jsonc` with the deny-all baseline, `agents/<name>.md`, real `SKILL.md` files, `mcp-requirements.json`, and the compose file. Add `render --check`.
- Base image with the fail-fast entrypoint; per-expert passwords; `OPENCODE_CONFIG_DIR` read-only; `OPENCODE_DISABLE_PROJECT_CONFIG=1`.
- Egress: Smokescreen with a role-based ACL file (or Squid), per-expert identity, request logging; experts on the internal network with `HTTPS_PROXY` set.

**7. Landing, policy, verifier, and a real Dispatcher service.**
- Port `Wildcard.match`; ownership map; diff policy check with `scope` failures and `shared` flags.
- Landing transaction with post-merge verify and reset; the Dispatcher commits stray changes and records that it did.
- Fix worktree retry (check out the existing branch, do not reset it); base new work on the integration branch; operate on a fleet-owned clone.
- Journal: append-only writes, a lock, `||` on line 214, persist on every transition; reach `failed` and `cancelled`, and cancel dependents.
- HTTP service with REST and the `fleet_*` MCP tools; Director persona; recovery on startup.
- Run the Stage 1 acceptance list live and write the stage report.

**8. Lane hardening**, if lanes are kept for verify commands.
- bwrap: `--unshare-all`, `--clearenv` with an allowlist, `--dev /dev`, `--proc /proc`, `--tmpfs /tmp`, bind only the worktree and a read-only toolchain.
- Docker: `--name`, `--network none` or the internal network, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--user`, `--memory`, `--cpus`, `--pids-limit`, `:z`, and `docker kill` by name on timeout.
- `execCmd`: spawn in a new process group and kill the group.
- Tests that assert the negative: no home directory, no parent environment, no network, no survivor after timeout.

**9. Stage 2.** Playbook engine over YAML with work items; red-first step; SHA-bound verdicts; a judge provider that runs `qa-functional` and `qa-adversarial` as separate read-only sessions in parallel; architect tiebreak; rework 3, replan, 2, then mission `halted`; one judge report schema in the SDK. Then the environment runner.

**10. Stages 3 and 4, in the blueprint's order,** against fake GitHub and Discord servers first. Rework the pack contract to add the blueprint's rejections and file-existence checks before re-admitting any pack. Build the eval suite before tuning personas or choosing a model.

---

## Appendix A. Security requirements (shared context, section 8)

| # | Requirement | Status |
|---|---|---|
| 1 | No expert has container daemon access | Met by absence: no expert containers; no `docker.sock` in compose. The Docker lane requires the Dispatcher process itself to hold daemon access. |
| 2 | Experts on an internal network; egress proxy is the only exit and logs by expert | Not met. An internal network exists with no proxy, so no provider route. Lanes use the host network or the default bridge. |
| 3 | Config directories read-only; registry not mounted into experts | Not implemented. Neither exists. |
| 4 | `ro` experts cannot write the workspace | Not implemented. The access class is never consulted. |
| 5 | Unique password per expert; MCP bearer token; admin password; signed webhooks | One shared `OPENCODE_PASSWORD`. Gateway bearer token with a `dev-token` default. No fleet API to protect. |
| 6 | Nothing listens on a non-loopback address | Violated. Compose publishes 4096, 7070, 8080 on all interfaces; the gateway deploy file publishes 80 and 443. |
| 7 | Text from non-allowlisted accounts never reaches an agent | Not applicable yet: no triggers. The gateway does mark web content as untrusted data. |
| 8 | Secrets files mode `0600`, never tracked | `studio init` writes `.env` with `0600`. No secrets are tracked. The root `.gitignore` does not list `.env`; only the homelab package's does. |

## Appendix B. Defect index

Paths are relative to `packages/`.

| Location | Defect |
|---|---|
| `opencode-fleet/src/cli/main.ts:99-103` | `run` hard-codes a passing outcome and never calls the Dispatcher |
| `opencode-fleet/src/cli/main.ts:85-87` | `spec` always writes one fixed task |
| `opencode-fleet/src/dispatcher/service.ts:99-100` | Task command read from an untyped field; default `true` |
| `opencode-fleet/src/dispatcher/service.ts:111` | Gate list defaults to empty, which passes |
| `opencode-fleet/src/dispatcher/service.ts:116-124` | Judge verdicts copied from the gate result |
| `opencode-fleet/src/dispatcher/service.ts:148-150` | Worktree always destroyed; nothing landed; uncommitted work lost |
| `opencode-fleet/src/lanes/runner.ts:32` | Docker lane: no network, limits, user, name, or `:z` |
| `opencode-fleet/src/lanes/runner.ts:47-60` | bwrap lane: whole host read-only bound; no namespaces; no `/dev` |
| `opencode-fleet/src/lanes/runner.ts:75-86` | Unsandboxed execution when bwrap is missing |
| `opencode-fleet/src/lanes/tiers.ts:50-76` | `network` computed and never applied |
| `opencode-fleet/src/lanes/worktree.ts:30-32` | Retry path detaches and force-resets the task branch |
| `opencode-fleet/src/util/exec.ts:30` | Full parent environment passed to every child |
| `opencode-fleet/src/util/exec.ts:56-59` | Timeout kills the direct child only |
| `opencode-fleet/src/scheduler/runner.ts:47-57` | Fix task discards its reason; depends on the task it is meant to fix |
| `opencode-fleet/src/scheduler/runner.ts:79-104` | No replan, no mission halt, dependents never cancelled |
| `opencode-fleet/src/state/journal.ts:214` | Divergence test uses `&&`; should be `\|\|` |
| `opencode-fleet/src/state/journal.ts:126-146` | Whole-file rewrite and re-read per event; no lock |
| `opencode-fleet/src/host/adapter.ts:75,89,97-103,139` | No `data` unwrap; two nonexistent endpoints; wait ignores HTTP status; unused |
| `opencode-fleet/src/gates/runner.ts:36-42,57-60` | Default gates name tools that are not installed; budget gate always passes |
| `opencode-sdk/src/contracts.ts:119-134` | Judge report schema incompatible with `opencode-fleet/src/judges/reports.ts` |
| `opencode-sdk/src/host/client.ts:181-186` | `createSession` sends `{}`; cannot set agent, directory, or permissions |
| `opencode-homelab/compose.yaml:31,54,81` | Ports published on all interfaces |
| `opencode-homelab/compose.yaml:39` | Healthcheck targets a nonexistent endpoint without credentials |
| `opencode-homelab/compose.yaml:79` | Runs a command that does not exist |
| `opencode-homelab/scripts/test-live-e2e.ts:109,149-152,183-198` | Failures downgraded to warnings |
| `opencode-gateway/apps/gateway/src/server.ts:244-262,343` | Placeholder backends in the production path |
| `opencode-gateway/apps/gateway/src/index.ts:6,40` | Default token; constant readiness |
| `opencode-gateway/packages/opencode-guard/src/guard.ts:169-173` | Shell guard requires a literal `http(s)://` URL |
| `opencode-packs/packs/*/src/index.ts` | Manifests reference `./mcp/*.js` files that do not exist |
| `opencode-packs/packs/pack-gdevelop/patches/` | Entitlement patches the blueprint excluded |

## Appendix C. Corrections to the mission brief

- The SDK client is `opencode-sdk/src/host/client.ts`; there is no `src/client.ts` or `src/host.ts`.
- `pack-godot` has 21 test files containing 123 tests. `pack-gdevelop` has 55 tests, 7 of them vacuous.
- `opencode-gateway/catalog/` has 10 files: 8 engines, plus `valkey` and `egress-web`.
- `fleet.yaml` describes 12 experts as data. It contains no container specifications.

## Appendix D. Reproduction

```
cd rebuild_staging
bun test
bunx oxlint
bunx tsc --noEmit

# CLI reports success with nothing behind it
cd "$(mktemp -d)" && F="bun <repo>/packages/opencode-fleet/src/cli/main.ts"
$F grill --mission m-1 --intent "Add a /health endpoint. Include a test." && $F spec --mission m-1 && $F run --mission m-1

# E2E passes with no server
cd <repo>/packages/opencode-homelab && OPENCODE_PORT=1 bun run scripts/test-live-e2e.ts

# Gateway returns invented search results
cd <repo>/packages/opencode-gateway/apps/gateway && GATEWAY_PORT=18999 bun run src/index.ts &
curl -s -X POST localhost:18999/mcp -H 'content-type: application/json' -H 'authorization: Bearer dev-token' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"query":"x"}}}'

# Compose healthcheck target
OPENCODE_PASSWORD=pw opencode serve --port 4198 &
curl -s -o /dev/null -w '%{http_code}\n' -u opencode:pw localhost:4198/api/health     # 404
curl -s -o /dev/null -w '%{http_code}\n' -u opencode:pw localhost:4198/api/info       # 200
```

The lane, worktree, scheduler, journal, and schema probes were short Bun scripts that import the fleet modules and operate on throwaway git repositories; each result is quoted in section 2.
