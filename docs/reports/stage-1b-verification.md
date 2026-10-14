# Stage 1b — verification

Commit: c0a2813 Branch: stage-1b-roster Date: 2026-10-14 (UTC) Verifier: Muse Spark 1.3 Contributor (OpenCode)

VERDICT: PASS

## Summary

The stage holds. `make check` is green on my run (109 unit tests, render-check current), and `bash scripts/accept.sh 1b` passes 12/12 with 0 skips on a fresh run (log `docs/evidence/1b/accept-20261014T012517Z.log`, copied to `docs/evidence/1b/verify/accept-rerun.log`). Every acceptance script was read and would exit 1 if its condition broke; the builder's and QA's red proofs are genuine (first lines state real sabotages, FAIL lines match), and my own five sabotages — each with a different mechanism than the builder's and QA's — all went red and came back green after exact restores. Fail-closed probes confirm empty credentials refuse with the variable named (exit 64) and empty live passwords get 401. No 4.6 pattern violations; the report's claims match the tree. No flakes occurred on this pass despite the shared-host contention the builder flagged.

## Checks

| Check                         | Builder | Verifier | Evidence                                 |
| ----------------------------- | ------- | -------- | ---------------------------------------- |
| 1b/01-render-check            | PASS    | PASS     | docs/evidence/1b/verify/accept-rerun.log |
| 1b/02-compose-config          | PASS    | PASS     | docs/evidence/1b/verify/accept-rerun.log |
| 1b/03-compose-hardening       | PASS    | PASS     | docs/evidence/1b/verify/accept-rerun.log |
| 1b/04-images-pinned-and-built | PASS    | PASS     | docs/evidence/1b/verify/accept-rerun.log |
| 1b/05-up-healthy              | PASS    | PASS     | docs/evidence/1b/verify/accept-rerun.log |
| 1b/06-smoke                   | PASS    | PASS     | docs/evidence/1b/verify/accept-rerun.log |
| 1b/07-egress-allow-deny       | PASS    | PASS     | docs/evidence/1b/verify/accept-rerun.log |
| 1b/08-no-direct-route         | PASS    | PASS     | docs/evidence/1b/verify/accept-rerun.log |
| 1b/09-unique-passwords        | PASS    | PASS     | docs/evidence/1b/verify/accept-rerun.log |
| 1b/10-protocol-examples-parse | PASS    | PASS     | docs/evidence/1b/verify/accept-rerun.log |
| 1b/11-workspace-demo          | PASS    | PASS     | docs/evidence/1b/verify/accept-rerun.log |
| 1b/12-no-published-ports      | PASS    | PASS     | docs/evidence/1b/verify/accept-rerun.log |
| make check                    | exit 0  | exit 0   | docs/evidence/1b/verify/make-check.log   |

Starting state: branch `stage-1b-roster`, commit `c0a2813`, `git status` clean. Bun 1.4.2, Docker 29.9.0, Compose 5.6.0, OpenCode v2.0.28 (host binary; images carry the pinned `OPENCODE_VERSION` from `versions.env`). Provider key: present (presence only, never shown). `.env` / `.env.provider` mode `0600`, never written by me. 13 project containers running (12 experts + egress), all healthy at start and at end; foreign stacks also present on the shared host (see Notes).

Claim table (stage Accept lines, all 12 acceptance rows, all 9 Built steps, guards due D-07/D-18/D-19/D-20/D-25): every item has evidence above or in the referenced logs; no stage-prompt requirement lacks a check or test. Guard mapping: D-07 via 03 (parsed compose limits/cap_drop/`:z`) + live 05; D-19 via 12 (zero host bindings); D-20 via 05 (`/api/info` healthcheck); D-25 via 07 (non-listed host fails and is logged with the expert name); D-18 second guard via 10. Prior-stage guards (stage 0) were not re-verified per instructions but `make check` (format, lint, typecheck, ts-coverage over 41 files, 109 tests) is green, which exercises them.

Script review (step 4): all 12 scripts use `set -u -o pipefail`, delegate verdicts to `scripts/accept/lib.sh` (`pass`/`fail`/`skip` with the exact `CHECK` line the harness parses), and assert on live behaviour, not self-created artifacts. No `|| true` around a verdict (the one in 11 wraps an expected-to-fail refusal probe whose output is then asserted by grep for `submodule` plus a no-leftover-dir check). No unauthorized SKIP branches (no `skip` calls in any 1b script). 03 delegates to a real parser (`scripts/accept-helpers/compose-hardening.ts`), read in full: it checks every enabled expert for `cap_drop [ALL]`, `no-new-privileges`, `pids_limit`, `cpus`/`mem_limit`, exactly `[fleet]`, no `ports`/`privileged`/`cap_add`, daemon-socket strings, `:z` on binds, exact config-mount and `/work` modes by access class, and egress on exactly `[fleet, outside]` — sound. 04 gates on floating-version greps before building, then asserts all 13 images exist. 05 polls 13 named containers for `healthy`. 07 probes allowlisted (`opencode.ai` → 2xx/3xx) and non-listed (`denied.invalid` → proxy 403) from two experts and requires the exact `TCP_TUNNEL`/`TCP_DENIED` lines with the right expert name (18×5s poll; longer waiting cannot false-pass). 08 requires bypass-with-`--noproxy` to fail and metadata-via-proxy to return 403. 09 requires every expert to accept its own nonempty password (200) and reject all eleven others (401). 11 asserts the demo clone layout, the submodule refusal wording plus no leftover directory, and the registry-schema test. 12 fails on any non-empty `PortBindings` among project containers and fails if there are no containers at all. Timeouts: the harness kills any check at 120s and counts that FAIL, so the 600s loop in 05 and the 36×5s smoke loops are fail-closed, not false-pass risks.

Builder + QA red proofs: genuine. Each log's first line states a real sabotage and the FAIL line matches the check's assertion (spot-checked 07/08/qa-07/qa-08/qa-12; QA's red-proofs.log documents distinct mechanisms per check and honest notes, e.g. the qa-09 first attempt that stayed green for the wrong reason was corrected, not recorded as a proof).

## Sabotage sample

| Check | What I broke                                                                                                                                                | Result                                           | Restored                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| 01    | Appended a line to generated `experts/backend/config/mcp-requirements.json` (different file than builder/QA)                                                | FAIL render-check stale, exit 1                  | Yes, `git checkout`; re-run PASS                           |
| 12    | Added `127.0.0.1:18097:4096` to the backend service in generated `docker-compose.yml`, recreated backend (different service/port/mechanism than builder/QA) | FAIL bindings `/agency-backend ...18097`, exit 1 | Yes, `git checkout` + recreate, bindings `{}`; re-run PASS |
| 07    | Deleted only the `opencode.ai` line from generated `egress/allowlist.txt`, force-recreated egress (surgical; builder stopped egress, QA emptied the file)   | FAIL allowlisted request 403, exit 1             | Yes, `git checkout` + force-recreate, healthy; re-run PASS |
| 08    | Attached `agency-backend` to the project's `agency_outside` network (builder/QA used the default bridge)                                                    | FAIL direct route out exists, exit 1             | Yes, disconnected, fleet-only; re-run PASS                 |
| 06    | Stopped `agency-qa` (builder stopped director, QA stopped scout)                                                                                            | FAIL expert qa not healthy, exit 1               | Yes, started, healthy; re-run PASS first try               |

Detail: `docs/evidence/1b/verify/sabotage.log`. Tracked `git status`/`git diff` clean after every restore (only untracked evidence files remain). One honest correction: my first 07 attempt with plain `docker compose up -d egress` stayed green because compose saw no config change and never recreated the container, so squid never re-read the mounted file — an ineffective sabotage, not a check weakness; re-done with `--force-recreate`, which went red as required.

## Findings

None. No item breaks a rule or requirement.

## Claims compared with the tree

- Commit subjects (`0f7641f`..`c0a2813`): all describe their diffs (`feat`, `fix`, `docs`, `test(evidence-...Changelog...)` for the QA evidence commit). No `live`/`verified`/`complete`/`all` claims; nothing to correct.
- Built items: all exist and are wired/exercised — `fleet.yaml` (25 experts, 12 enabled, confirmed), `fleet-schema.ts` (imported by `render.ts`, tests, hardening helper), `mcp-registry.ts` (imported by `render.ts`), `registry-schema.ts` (see Notes), `FLEET_PROTOCOL.md` (check 10 parses its examples), `render.ts` + 39 current generated files, 12 Dockerfiles (`FROM agency-base:${OPENCODE_VERSION}`, egress `FROM ubuntu:24.04@sha256:…`), 12 personas + zero missing `SKILL.md` (verified by enumeration), Squid proxy with per-user auth/ACL/logging, generated compose, `init-env.sh` (refuses overwrite, random 0600 secrets), `workspace-init.sh` (fail-closed `set -e` + `cp` guard), `smoke.sh` (12/12 live). No missing item absent from "Not built".
- "Not performed": empty — correct, 0 skips on my run too. "Not built": matches the stage prompt's exclusion list; the uninstalled tools (`vale`, `atlas`, Docker CLI, optional toolchains) are documented with reasons in build notes.

## Fail-closed probes

| Situation                                                     | Expected                                 | Observed                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Empty `OPENCODE_PASSWORD` at expert start                     | Refuse, naming the variable              | `entrypoint: refusing to start: OPENCODE_PASSWORD is empty`, exit 64                                            |
| Empty `OPENCODE_API_KEY` at expert start                      | Refuse, naming the variable              | `entrypoint: refusing to start: OPENCODE_API_KEY is empty`, exit 64                                             |
| Empty password against a live expert                          | Refused                                  | HTTP 401                                                                                                        |
| Proxy unreachable / allowlisted host removed                  | Request fails, no silent bypass          | `CONNECT tunnel failed, response 403` (my 07 sabotage); bypass leg covered by 08                                |
| Empty check list / unreachable expert for dispatch / no judge | `no-checks` / `unreachable` / `no-judge` | Not applicable in this stage: no verifier, Dispatcher, or judges exist yet; guards land in 1c/2a per defects.md |

Probe containers were run with `--rm --name verify-*-probe` on `--network none` and left nothing behind (`docker ps -a | grep verify` shows only foreign stacks).

## Not verified

Nothing the verdict depends on. Unit-test internals for steps 1–4 and 8 were covered transitively (`make check`: 109 pass) rather than reverted one by one; the acceptance checks plus five live sabotages establish fail-red behaviour at the level this stage's goal (fleet up, isolated, egress-controlled) requires.

## Notes

- `dispatcher/src/registry-schema.ts` has no non-test importer until the Dispatcher (stage 1c) consumes it — an anticipated seam, not smuggled code: the stage prompt asks only for schemas + tests here, and check 11 exercises it. No action.
- `scripts/smoke.sh` calls `/api/agent`, `/api/skill`, `/api/mcp` directly instead of through `dispatcher/src/opencode.ts`. Justified: the stage prompt's Step 9 mandates exactly these probes, smoke is an ops script rather than the Dispatcher client, and no Dispatcher exists yet.
- `docker compose up -d` does not reload squid when only the mounted `allowlist.txt` changes (found during my 07 sabotage); operations should use `--force-recreate` (or `squid -k reconfigure`) for proxy config changes. Observation only.
- Shared-host contention persists (foreign `drop-verify`, `deploy-*`, `swarm-*` stacks; load noted by the builder). My full accept run still passed 12/12 first try with no flakes and no re-runs.
- I wrote only `docs/reports/stage-1b-verification.md` and files under `docs/evidence/1b/verify/`. Nothing is committed; the report and evidence are left uncommitted as instructed.
