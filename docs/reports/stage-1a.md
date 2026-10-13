# Stage 1a report — Spike and base image

Date: 2026-10-13 (UTC). Branch: `stage-1a-spike`. Image: `agency-base:2.0.26`.

**This stage is NOT complete.** There is no provider key anywhere
(`.env.provider` absent, `AGENCY_MODEL` unset), and the stage prompt says
this stage cannot complete without the key. `scripts/preflight.sh` cannot
exit 0 (check 01 fails), `scripts/spike.sh` exits 1 without a key and check
05 skips it (the only prompt-allowed skip), and questions 1, 9, 10, 11 are
NOT PERFORMED (check 06 fails). Everything that can be settled without a
key is settled with real container evidence; nothing model-dependent is
fabricated. A close-out session then fixed the known transcript-assertion
weakness and swept the stage diff for tolerated errors (section 6); none of
that changes the keyless facts above.

## 1. Built

- **Step 0 — Preflight** (`scripts/preflight.sh`, commit `3d9ffec`, kept
  unchanged). Fail-closed table: runtime, Compose ≥ 2.24, SELinux,
  `.env.provider` mode `0600` with non-empty `OPENCODE_API_KEY` (present /
  absent only, never the value), install-URL reachability, free loopback
  port from 8080, user-namespaces/kernel as info. Exits 1 on any failed
  requirement.
- **Step 1 — Base image** (`images/base/Dockerfile`,
  `images/base/entrypoint.sh`, `make build-base`; base commit `6160d08`
  plus the fixes below). Digest-pinned `ubuntu:24.04` (digest recorded in
  `versions.env` as `UBUNTU_DIGEST`), pinned apt set plus pinned yq / Node
  LTS / uv with sha256 checks against `versions.env`, `agent` user from
  `AGENT_UID`/`AGENT_GID` with collision rename, `/work` `/artifacts`
  `/etc/agency` + XDG dirs owned by `agent` (follow-up fix: `/etc/agency`
  is now chowned too — it was created by the user-setup layer but left
  root-owned), OpenCode at `OPENCODE_VERSION` in `/usr/local/bin` with a
  `--version` build check, `safe.directory '*'`, `HEALTHCHECK` on
  `/api/info`, `tini` entrypoint, `USER agent`, no secret in any layer /
  arg / `ENV` (`docker history --no-trunc` and `docker inspect` each show
  the HEALTHCHECK's literal `${OPENCODE_PASSWORD}` variable-name reference
  once; no value appears in either), no `latest`, single pinned `FROM`.
  Entrypoint: fail-closed exit 64 naming the variable, git identity
  `<expert> (The Agency)` / `agency.invalid`, MCP overlay disabling
  servers with unmet requirements (full entry carried), Dispatcher-side
  fallbacks noted (comment now names Q6 keep-salvaged-client and Q8
  probe-on-timer so it does not contradict build notes), `exec opencode
serve --hostname 0.0.0.0 --port 4096`.
- **Step 2 — Spike** (`scripts/spike.sh`, `spike/config/opencode.jsonc`
  with the 9.6 deny-all baseline + one `spike` agent,
  `spike/config/agents/spike.md`, `spike/config/mcp-requirements.json`).
  The script builds nothing, starts one named container, exercises
  `/api/info`, `/openapi.json`, session create with a `permissions` array,
  a permission request that is listed then rejected, prompt, wait,
  messages, diff; tears down by name on `EXIT` including failure; exits
  non-zero on the first unexpected response; exits 1 with no key (never
  SKIP — the skip lives in the acceptance check only). Its EXIT-trap
  `docker rm -f ... || true` is kept with the explanatory comment:
  teardown tolerance, while every assertion under test fails closed.
- **Close-out session** (commits `ba64e84`, `0501a09`, `382aa7e`,
  `3ccfd64`, `7e572d1`). Task 1: the vacuous transcript greps in
  `scripts/spike.sh` are replaced by a role-aware parser
  (`scripts/spike-assert-messages.py`; evidence
  `docs/evidence/1a/spike-parse/`). Task 2: stage-0 `0/06-no-donor-code`
  now exempts exactly the stage-1a harness it contradicted, with an
  in-check comment and a proof
  (`docs/evidence/1a/red/06-no-donor-code-scope-proof.log`), and its scan
  fails closed on unreadable files; D-06's register text matches. Task 3
  sweep: checks `05`/`07`/`08` fail closed on scan/`docker ps` errors
  (`07-keyed-branch-proof.log`, `08-docker-ps-failclosed.log`), the
  entrypoint refuses to serve on an unreadable `mcp-requirements.json`
  (`entrypoint-mcp-requirements-failclosed.log`), the preflight compose
  probe is explicit, 03/04 teardown tolerances are annotated, and
  `spike.sh` checks its own `docker run`.

### Fifteen answers

Evidence: `docs/evidence/1a/spike/q<nn>.log` (commands + trimmed output,
credentials redacted).

| #   | Answer                  | Observation (one line)                                                                                                                                                                                                                                                                  |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | NOT PERFORMED           | Serve reads `OPENCODE_API_KEY` from env (dummy key → provider.auth, not missing-var); `opencode models --standalone` lists nothing keyless; `AGENCY_MODEL` unset.                                                                                                                       |
| 2   | yes                     | Serve logs to stdout (`docker logs`); structured log at `~/.local/share/opencode/log/opencode.log`; `--print-logs` exists for standalone.                                                                                                                                               |
| 3   | yes                     | Create/prompt/wait/messages/diff all 200 on a read-only `/work` mount; snapshots live in the data dir, not `/work`; writes fail EROFS; turn-diff is snapshot-based (host edits invisible by design).                                                                                    |
| 4   | yes                     | Healthy with read-only `OPENCODE_CONFIG_DIR`; writes to it fail EROFS while serving is unaffected.                                                                                                                                                                                      |
| 5   | yes (premise corrected) | v2 has no built-in general/explore agents (observed: build, plan + hidden compaction/title/summary); disabling absent ids is a safe no-op.                                                                                                                                              |
| 6   | yes                     | `@opencode/client@2.0.26` installs under Bun 1.4.2 and drives server.info + agent.list; NOT better (mistypes unwrapped `/api/info`) → keep salvaged client.                                                                                                                             |
| 7   | yes                     | Permission matrix live: session ask pends, baseline shell allows, per-task edit notes.txt allows, edit other.txt denied; list/reject round-trip 204 + disappears. Race: agent rules resolve async per location; early checks fail closed (deny) — Stage 1c must tolerate, never weaken. |
| 8   | yes                     | Invalid key → assistant finish:error `{type:provider.auth,message,status:401,response:{body}}` then idle failed. Quota/rate-limit share the envelope (`provider.quota` / `provider.rate-limit`); schema has NO reset field → probe-on-timer fallback adopted.                           |
| 9   | NOT PERFORMED           | Fields exist (cost 0 + zeroed tokens pre-run); real fill-in untested.                                                                                                                                                                                                                   |
| 10  | NOT PERFORMED           | Only websocket-constructor honors `*_PROXY`; no proxy support found in provider/MCP paths; internal-network test needs a key.                                                                                                                                                           |
| 11  | NOT PERFORMED           | permission.asked/replied carry sessionID (+requestID); MCP tool-output SSE matching untested without a model.                                                                                                                                                                           |
| 12  | no                      | Disabled → repo AGENTS.md not loaded (zero watcher subscriptions vs subscribed when enabled); envelope already tells the expert to read it. Nothing to adopt.                                                                                                                           |
| 13  | yes                     | `?auth_token=base64("opencode:<pw>")` → 200 on `/api/info`; absent/bad → 401. `/` serves the app shell publicly.                                                                                                                                                                        |
| 14  | yes / yes               | Bun (SDK 1.32.1, node:http, per-connection McpServer) Streamable-HTTP server: "mcp connected" tools=1; down → failed ConnectionRefused. bun:sqlite WAL works + reopens; ro dir fails closed; `:z` volume visible as agent. Bun stays; no Node fallback.                                 |
| 15  | yes                     | PUT `{variables}` 204 → session shell sees var; second session UNSET. Model shell tool shares Shell.Service + SessionEnvironment, so covered by construction.                                                                                                                           |

### Fallbacks in force

- Q6: keep the salvaged fetch client (`dispatcher/src/opencode.ts`); do not
  adopt `@opencode/client` (it mistypes the unwrapped `GET /api/info`).
- Q8: treat any repeated provider refusal as a usage limit; the Dispatcher
  probes on a timer. (SessionError has no reset-time field.)
- Q1/Q7-model-leg/Q9/Q10/Q11/Q15-model-leg: no fallback adopted; pending
  provider key. (The client's polling `wait` fallback on 404/501 only is
  specified behavior, not a spike fallback.)
- Q3/Q4/Q5/Q7-keyless-leg/Q12/Q13/Q14/Q15-keyless-leg: no fallback needed
  (answers above).

## 2. Acceptance

Final run (QA re-run of the frozen tree, 2026-10-13, HEAD 3f05923):
`bash scripts/accept.sh 1a` → exit **1**; the same honest split (01/06 fail
for the missing key, 05 skips).
Log: `docs/evidence/1a/accept-20261013T185638Z.log`.

```
CHECKS for stage 1a
1a/01-preflight              FAIL   preflight exited non-zero: kernel           INFO   Linux 7.3.0-0.rc6.261009gaf32da41b032.55.fc46.x86_64 x86_64 (stage 2b info only) preflight: 4 pass, 1 fail
1a/02-base-image-pinned      PASS
1a/03-entrypoint-fails-closed PASS
1a/04-healthy-nonroot        PASS
1a/05-spike-end-to-end       SKIP   .env.provider has no usable OPENCODE_API_KEY
1a/06-spike-answers-complete FAIL   4 question(s) NOT PERFORMED (no provider key); stage incomplete
1a/07-no-secret-leak         PASS
1a/08-no-containers-left     PASS
stage 1a: 5 pass, 1 skip, 2 fail (8 checks)
```

| Check                      | Result                                                | Evidence                                       |
| -------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| 01-preflight               | FAIL (honest: no `.env.provider`)                     | `docs/evidence/1a/accept-20261013T183757Z.log` |
| 02-base-image-pinned       | PASS (image `agency-base:2.0.26` rebuilt green)       | same log                                       |
| 03-entrypoint-fails-closed | PASS (dummy via `$dummy_api_key`; behavior identical) | same log; comment-only change re-run green     |
| 04-healthy-nonroot         | PASS (dummy via `$dummy_api_key`; behavior identical) | same log; comment-only change re-run green     |
| 05-spike-end-to-end        | SKIP (no key; the only prompt-allowed skip)           | same log                                       |
| 06-spike-answers-complete  | FAIL (honest: 4 × NOT PERFORMED)                      | same log                                       |
| 07-no-secret-leak          | PASS (no-key branch; keyed branch proven separately)  | same log; `red/07-keyed-branch-proof.log`      |
| 08-no-containers-left      | PASS (and fails closed when `docker ps` fails)        | same log; `red/08-docker-ps-failclosed.log`    |

Stage-0 re-run on this branch (`bash scripts/accept.sh 0`): exit **1**,
9 pass / 1 fail. `0/06-no-donor-code` now **PASSES** (it failed on the
pre-fix tree, `docs/evidence/0/accept-20261013T175814Z.log`, naming the
stage-1a `docker run` calls); the one failure is `0/05-salvage-provenance`,
which compares the branch name to `stage-0-salvage` — expected when the
stage-0 checks run from the stage-1a branch, unchanged from before, and
unrelated to this stage. Log: `docs/evidence/0/accept-20261013T183818Z.log`.

## 3. Red proofs

One sabotage run per check under `docs/evidence/1a/red/`; the first line
of each file states what was broken. Every check was restored to its
final result afterwards (03/04/07/08 re-confirmed green; 01/06 remain red
for the honest no-key reasons in section 4).

A QA pass on the frozen tree (2026-10-13, HEAD 3f05923) re-ran every
sabotage below and refreshed the canonical `red/01..08` logs plus
`red-proofs.log`; the rows match the refreshed files. The stage-0 `0/06`
sabotage is recorded in `red/0-06-no-donor-code-qa.log`.

| Check | Sabotage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Red log                                               |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 01    | `.env.provider` absent (the fail-closed condition itself) → exit 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `docs/evidence/1a/red/01-preflight.log`               |
| 02    | `versions.env` `UBUNTU_DIGEST` replaced with zeros → digest/record mismatch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `docs/evidence/1a/red/02-base-image-pinned.log`       |
| 03    | `OPENCODE_PASSWORD` refusal block deleted from `images/base/entrypoint.sh`, image rebuilt → no-password container still running                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `docs/evidence/1a/red/03-entrypoint-fails-closed.log` |
| 04    | `USER agent` → `USER root` in `images/base/Dockerfile`, image rebuilt → runs as uid 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `docs/evidence/1a/red/04-healthy-nonroot.log`         |
| 05    | dummy INVALID key in `.env.provider` → `spike.sh` runs and fails at the structural transcript assertion (`spike-assert-messages`: missing shell marker `spike-shell-ok` / `## RESULT` block), never passes; container still torn down                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `docs/evidence/1a/red/05-spike-end-to-end.log`        |
| 06    | `q06.log` moved away → missing-evidence failure (in addition to the standing NOT PERFORMED failure)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `docs/evidence/1a/red/06-spike-answers-complete.log`  |
| 07    | dummy value in `.env.provider` AND a scratch file under `docs/evidence/1a/` (removed after; never committed) → value found, FAIL. F1 rework: dummy literals in 03/04 moved to `$dummy_api_key` (no tracked line assigns a literal to `OPENCODE_API_KEY`; container still gets a non-empty dummy); throwaway dummy strings redacted as `[dummy-value-redacted]`/`[<check>-dummy]` in the QA accept log and `red-proofs.log` (values were never secrets; FAIL file:line refs kept). Re-proof: staged `redproof-07-sentinel.tmp` holding a sentinel assignment line for the provider-key variable (an obviously-fake REDPROOF-SENTINEL value with a random suffix, never committed) → FAIL exit 1 naming the file; unstaged and deleted → PASS exit 0. 07's regex untouched; the close-out session later hardened the scan error handling and proved the keyed branch red/green with a dummy key (close-out proofs below) | `docs/evidence/1a/red/07-no-secret-leak.log`          |
| 08    | leftover decoy container `agency-spike-qa-redproof` → detected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `docs/evidence/1a/red/08-no-containers-left.log`      |

Close-out proofs (tasks 1-3), all under `docs/evidence/1a/red/`:

- `06-no-donor-code-scope-proof.log` — a stray `docker run` and a stray
  `bwrap` appended to the non-exempt `scripts/preflight.sh` each exit 1;
  an unreadable scanned file fails the scan closed (it passed before the
  rewrite); exact reverts return the check to PASS.
- `07-keyed-branch-proof.log` — with a throwaway dummy key, a tracked
  sentinel and an evidence-dir sentinel each exit 1, the dummy key alone
  passes, and removing the key returns to the no-key branch PASS.
  The keyed branch was previously only code-read; it is now exercised.
- `08-docker-ps-failclosed.log` — a PATH shim failing `docker ps -a`
  makes the check exit 1; the real docker passes.

Cycle-2 rework proofs (verification pass 1 findings F2–F5), under `red/`
and `qa/`:

- `red/f4-no-donor-code-lsfiles.log` — a PATH shim failing `git ls-files`
  (exit 128) makes stage-0 `0/06-no-donor-code` exit 1 (it passed before
  the fix); stray `docker run` / `bwrap` / unreadable-file sabotages still
  fail closed; exact revert → PASS.
- `red/f3-negative-marker.log` — stripping a `Negative case:` marker from
  `q03.log` exits 1; replacing its observation with "none obtainable"
  exits 1; q10 marked answered while denial-only exits 1; restore → the
  standing 4-NOT-PERFORMED FAIL.
- `qa/f2-preflight-recorded.log` — the build-notes omission reproduced
  (grep rc=1), the preflight run, and the recorded table byte-identical to
  a fresh run.
- `qa/f5-image-metadata-wording.log` — the image metadata the reworded
  sentence now describes (one `${OPENCODE_PASSWORD}` placeholder in
  history and in inspect, no value).

Behavior evidence added by the same work:
`docs/evidence/1a/spike-parse/run.log` (synthetic echo-only transcript →
exit 1, positive → exit 0, malformed → exit 2; real invalid-key transcript
→ exit 1 with the echo ignored; the old greps match the same file) and
`docs/evidence/1a/entrypoint-mcp-requirements-failclosed.log`
(malformed requirements file → exit 64 naming the file).

## 4. Not performed

- Check 05 SKIP: `scripts/spike.sh` was not run to green — no provider key
  (`.env.provider` absent). The script itself exits 1 keyless (fail-closed);
  only the acceptance check maps that to SKIP, which the stage prompt
  allows while stating plainly the stage is not complete.
- The new fail-closed `docker ps` path inside check 05 is code-reviewed
  only: without a key the check skips before reaching it. Its twin in
  check 08 is proven with a PATH shim (`red/08-docker-ps-failclosed.log`).
- Questions 1, 9, 10, 11 NOT PERFORMED (need a model): Q1 (API key pickup
  beyond dummy-key auth refusal + `AGENCY_MODEL` listing), Q9 (cost/token
  fill-in after a real run), Q10 (proxy + internal network provider/MCP
  test), Q11 (SSE tool-output matching for a model-invoked MCP call).
- Every "Accept" item that needs a model (full `spike.sh` green, fifteen
  complete answers) is therefore not run. No model-driven evidence is
  claimed anywhere in this report.
- The Step-0 close-out omitted the preflight table from
  `docs/build-notes.md` (verification pass 1 finding F2). Corrected in the
  cycle-2 rework: the table and the chosen port `AGENCY_HTTP_PORT=8081`
  are recorded under "Stage 1a preflight" — see Deviations.

## 5. Not built

Nothing the stage asked for is missing as an artifact now: the one gap
verification pass 1 found — the preflight table omitted from build notes
(finding F2) — is recorded under "Stage 1a preflight". Unwired/deferred by
the prompt itself until the key arrives: a green `spike.sh` run and the
four model-dependent answers above. No Dispatcher code, no `fleet.yaml`,
no per-expert images — all explicitly not in this stage.

## 6. Deviations

- `images/base/Dockerfile`: one genuine fix beyond the kept commits —
  `/etc/agency` added to the `chown agent:agent` list. The user-setup layer
  created it but left it root-owned, against the Step 1 requirement that it
  be owned by `agent`.
- `images/base/entrypoint.sh`: fallback comment updated — Q6 and Q8
  fallbacks are Dispatcher-side and need no entrypoint switch (one line
  each), so the file no longer contradicts build notes.
- Checks `02` and `06` fixed for genuine parsing bugs (see section 7);
  both re-verified red-capable after the fix.
- `scripts/spike.sh` messages assertions (commit `ba64e84`): the greps
  could match the user-role echo of the prompt, which contains both
  markers, so those assertions could be vacuous. They are now structural
  and role-aware — the shell marker must come from a shell message's
  `output.output`, the RESULT block from assistant text — and any parse
  problem fails the run closed. Evidence:
  `docs/evidence/1a/spike-parse/` (synthetic echo-only/positive/malformed,
  the real invalid-key transcript, and a full invalid-key run that exits 1
  at the new assertion). The keyed positive run still awaits the user key.
- Stage-0 `0/06-no-donor-code` (commit `0501a09`): scoped the `docker run`
  scan to the prompt-sanctioned stage-1a harness (`scripts/spike.sh`,
  `scripts/accept/**`) with an in-check comment, made the scan fail closed
  on unreadable files, and aligned the D-06 register text. A `docker run`
  in any other scanned file still fails; proof
  `docs/evidence/1a/red/06-no-donor-code-scope-proof.log`.
- Zero-stub sweep (commit `382aa7e`): checks `05`/`07`/`08` now fail closed
  when their scans or `docker ps` fail, instead of treating an error as no
  match; `07`'s keyed branch is proven red/green with a dummy key
  (`red/07-keyed-branch-proof.log`, `red/08-docker-ps-failclosed.log`).
  `03`/`04` cleanup tolerances are annotated as teardown-only.
- Entrypoint addition (commit `3ccfd64`): a malformed
  `mcp-requirements.json` now refuses to start with exit 64 naming the
  file. Step 1's entrypoint spec did not state this case; fail-closed is
  the choice, because serving would leave servers enabled that the overlay
  was to disable. Evidence:
  `docs/evidence/1a/entrypoint-mcp-requirements-failclosed.log`.
- `scripts/preflight.sh` (commit `7e572d1`): the compose probe's tolerated
  `|| true` became an explicit `|| compose_version=""`; behavior is
  unchanged (empty → FAIL row), the intent is just visible. Check `01`
  still fails only for the honest missing-key reason.
- `bash -n` run over every script touched (entrypoint, preflight, spike,
  all acceptance checks touched); `make check` exits 0 after the changes
  (close-out re-run). `git status` of the base repo untouched; no push, no
  merge, no tags.
- Stage-1a preflight table omitted from `docs/build-notes.md` in the
  close-out (verification pass 1 finding F2); resolved via verification
  pass 1 — the exact table and the chosen port `AGENCY_HTTP_PORT=8081` are
  recorded under "Stage 1a preflight", with the reproduction and the
  byte-identical re-run in `docs/evidence/1a/qa/f2-preflight-recorded.log`.
- Cycle-2 rework: verification pass 1 findings F2–F5 addressed — preflight
  table recorded (F2), `Negative case:` marker enforced by check `06` with
  q10 gaining no evidence (F3), stage-0 `0/06-no-donor-code` fails closed
  when `git ls-files` fails (F4), and the image-metadata sentence matches
  `docker history`/`docker inspect` (F5). F1 — the user's provider key —
  remains the blocker; no model-dependent result is claimed. Standing
  accept after the rework: the same honest split (5 pass, 1 skip, 2 fail;
  01 FAIL, 05 SKIP, 06 FAIL 4 NOT PERFORMED) —
  `docs/evidence/1a/accept-20261013T192627Z.log`; stage-0 harness re-run
  with `0/06` PASS — `docs/evidence/0/accept-20261013T192640Z.log`.

## 7. Proposed corrections

(Also recorded in `docs/build-notes.md` under "Proposed corrections".)

- Check `02-base-image-pinned` parsed the FROM digest with
  `${from##*@sha256:}`, which kept the `AS base` stage alias and rejected
  the correct digest in `versions.env`. Fixed with a sed that captures only
  the hex digest; the check still fails on any mismatch (red proof 02).
- Check `06-spike-answers-complete` matched answer rows with
  `^\| <n> \|`, but the answers table pads numbers (`| 1   |`), so no row
  ever matched — and its NOT PERFORMED count used the same rigid pattern,
  counting 0, which would have PASSED a stage with unperformed questions
  once the row loop was fixed. All three patterns now allow padding; the
  check still fails while any question is NOT PERFORMED (red proof 06 and
  the standing honest failure).
- Stage-0 check `06-no-donor-code` and the Stage 1a prompt contradicted
  each other on `docker run` (see Deviations). The scan is now scoped to
  exempt exactly the sanctioned stage-1a harness, the D-06 register row
  describes that scope, and the change is recorded in build notes.
- Prior build-notes corrections stand: `/api/info` unwrapped (not
  `{data}`); no built-in `general`/`explore` agents; turn-snapshot (not
  working-tree) diff semantics; environment PUT shape
  `{"variables": {...}}`; `opencode models` needs a writable config dir
  while serve is fine read-only.

## 8. Next

Stage 1a resumes when the user supplies the provider key: place a real key
in `.env.provider` (mode `0600`, `OPENCODE_API_KEY=...`, never pasted into
chat) and set `AGENCY_MODEL` to the model id. Then: run `scripts/spike.sh`
to green, answer Q1/Q9/Q10/Q11 with evidence, re-run `scripts/accept.sh 1a`
to exit 0 (or 77 with only the prompt-allowed skip), and re-verify. Stage
1b must not start on this branch until that happens. No credential was
copied from host files; none appears in any tracked file, evidence log, or
image metadata (check 07 green).
