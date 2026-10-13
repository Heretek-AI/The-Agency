# Stage 1a — verification

Commit: `8131dcdb985d854bb90e7f22c584428a01c407b8` Branch: `stage-1a-spike` Date: 2026-10-13 (UTC) Verifier: DeepSeek V4.1 Flash (OpenCode), fresh session

VERDICT: FAIL

Reason: the stage is incomplete (no provider key exists; `make accept STAGE=1a` exits **1** with `01-preflight` and `06-spike-answers-complete` failing honestly and `05-spike-end-to-end` skipping), and for the model-dependent claims verification is incomplete — the full `spike.sh` flow, the `SPIKE PASS` marker and questions 1/9/10/11 cannot be run. Exactly what is needed to finish is in **Not verified**. Findings F2–F5 are separate defects to fix on the re-run.

## Summary

On a clean tree at `8131dcd`, `make check` exits 0 (78 pass, 0 fail) and `make build-base` rebuilds `agency-base:2.0.26` green. `bash scripts/accept.sh 1a` exits 1 with the same honest split the builder reported — 5 pass, 1 skip, 2 fail — and nothing in my re-run differs from the builder's table. The two stage-goal claims hold concretely: a variant build with `AGENT_UID=2000` runs as `agent` uid 2000 (and the default image as uid 1000), the `FROM` is digest-pinned and matches `versions.env`, and the transcript parser genuinely rejects the user-role prompt echo rather than passing vacuously. Seven sabotage runs (checks 01, 02, 03, 05, 06, 07, 08) each went red with exit 1 and restored clean. The stage-0 register guard `0/06-no-donor-code` passes, but a probe shows it still fails **open** when its `git ls-files` source fails (F4); the preflight table is missing from build notes (F2), and check 06's negative-case requirement is a word-grep (F3). The verdict is FAIL on the letter of `verify-stage.md` section 9: accept exits 1, and the model-dependent Accept lines are not met.

## Checks

| Check                                          | Builder                                     | Verifier                                                            | Evidence                                                                                   |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1a/01-preflight                                | FAIL (no key)                               | FAIL (same; green with dummy key 0600, red at mode 0644)            | docs/evidence/1a/verify/v2-03-accept-1a.log, v2-12-sabotage-01.log, v2-22-final-accept.log |
| 1a/02-base-image-pinned                        | PASS                                        | PASS (red with floating FROM)                                       | v2-03, v2-11-sabotage-02.log, v2-22                                                        |
| 1a/03-entrypoint-fails-closed                  | PASS                                        | PASS (red with API-key refusal deleted + rebuild)                   | v2-03, v2-16-sabotage-03.log, v2-22                                                        |
| 1a/04-healthy-nonroot                          | PASS                                        | PASS (uid wiring proven with AGENT_UID=2000 variant)                | v2-03, v2-08-agent-uid-wiring.log, v2-22                                                   |
| 1a/05-spike-end-to-end                         | SKIP (no key; prompt says stage incomplete) | SKIP (same; keyed-invalid run fails closed, keyless exits 77)       | v2-03, v2-17-sabotage-05.log, v2-22                                                        |
| 1a/06-spike-answers-complete                   | FAIL (4 NOT PERFORMED)                      | FAIL (same; negative-case row is a word-grep — F3)                  | v2-03, v2-13-sabotage-06.log, v2-22                                                        |
| 1a/07-no-secret-leak                           | PASS                                        | PASS (both branches red under sentinels; scan failure fails closed) | v2-03, v2-14-sabotage-07.log, v2-18-failclosed-probes.log, v2-22                           |
| 1a/08-no-containers-left                       | PASS                                        | PASS (red with docker-ps shim and decoy container)                  | v2-03, v2-15-sabotage-08.log, v2-22                                                        |
| register guard 0/06-no-donor-code (D-06, D-27) | PASS                                        | PASS on run; fail-open under ls-files failure — F4                  | v2-06-accept-0.log, v2-18, v2-19-probe-06-git-lsfiles.log                                  |

Harness logs from this pass: `docs/evidence/1a/verify/1a/accept-20261013T190339Z.log` (authoritative), `.../1a/accept-20261013T190410Z.log` (`make accept`), `.../1a/accept-20261013T191500Z.log` (final), `docs/evidence/1a/verify/0/accept-20261013T190438Z.log` (stage 0). `EVIDENCE_ROOT` was pointed into `verify/` to honor the verifier write scope; the check scripts do not read it (grep: no usage).

Starting state: branch `stage-1a-spike`, commit `8131dcd`, tree clean except this pass's untracked evidence dir; Bun 1.4.2, Docker 29.9.0, Compose 5.6.0, host `opencode` v2.0.28; `.env.provider` **absent**, `OPENCODE_API_KEY` and `AGENCY_MODEL` unset; no `agency-*` containers; image `agency-base:2.0.26` present and its entrypoint sha256 matches the tree (`e520f6c1…`). Full record: `v2-00-starting-state.log`.

## Sabotage sample

| Check | What I broke                                                                    | Result                                                                                        | Restored                                             |
| ----- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1a/02 | `FROM` pin removed → `FROM ubuntu:24.04 AS base`                                | FAIL exit 1 "FROM is not digest-pinned"                                                       | yes; `git checkout`, re-run PASS                     |
| 1a/01 | dummy key in `.env.provider` (green), then `chmod 644` (red)                    | PASS exit 0; FAIL exit 1 "provider-file FAIL mode=644"                                        | yes; file deleted, standing FAIL                     |
| 1a/06 | four answer rows rewritten to `yes` and word `negative` stripped from `q10.log` | FAIL exit 1 "q10.log shows no negative case"; fabricated rows alone PASS (limitation, F3)     | yes; `git checkout`, standing FAIL                   |
| 1a/07 | keyed: dummy value written under `docs/evidence/1a/verify/`                     | FAIL exit 1 "key value found under docs/evidence/1a"; PASS before and after                   | yes; sentinel removed, `.env.provider` deleted       |
| 1a/07 | no-key: staged sentinel with an `OPENCODE_API_KEY` assignment                   | FAIL exit 1 naming the file (value redacted in my log); PASS after                            | yes; unstaged and deleted                            |
| 1a/08 | `docker ps -a` PATH shim; then decoy container `agency-spike-verify-decoy`      | FAIL exit 1 both ("cannot prove no container is left behind"; "leftover container(s)")        | yes; shim removed, decoy removed, PASS               |
| 1a/03 | `OPENCODE_API_KEY` refusal block deleted from `entrypoint.sh`, image rebuilt    | FAIL exit 1 "no-key container still running"                                                  | yes; restored, rebuilt, PASS; image sha matches tree |
| 1a/05 | invalid dummy key present                                                       | FAIL exit 1 at the structural transcript assertion (never passes); keyless run → SKIP exit 77 | yes; `.env.provider` deleted, no container left      |

All restorations confirmed with `git diff --exit-code` clean and `git status --short` showing only this pass's evidence dir; no container from any probe remained (`v2-11`…`v2-22`).

## Findings

**F1 — Stage incomplete; Accept lines not met (verdict driver).**

- Where: checks `1a/01-preflight`, `1a/06-spike-answers-complete`; stage prompt Accept lines for Step 0, Step 2 and the acceptance table.
- What: no provider key exists anywhere, so `scripts/preflight.sh` cannot exit 0, `scripts/spike.sh` exits 1 and check 05 skips, and questions 1, 9, 10, 11 are `NOT PERFORMED`. `bash scripts/accept.sh 1a` exits 1 (5/1/2) and `make accept STAGE=1a` exits 2 (GNU make's normalization of the recipe's 1).
- Why it matters: `verify-stage.md` section 9 requires accept to exit 0, or 77 with only skips the prompt allows; the stage prompt says plainly that a skip of 05 means the stage is not complete. The report itself states this at the top, so the claim comparison matches — the defect is the incomplete stage, not a false claim.
- Fix: user places a real `OPENCODE_API_KEY` in `.env.provider` (mode 0600, never pasted into chat) and sets `AGENCY_MODEL`; then run `scripts/spike.sh` to `SPIKE PASS`, answer Q1/9/10/11 with `q<nn>.log` evidence, re-run `scripts/accept.sh 1a` to exit 0, and re-verify.

**F4 — `0/06-no-donor-code` fails open when `git ls-files` fails (high; green under relevant sabotage).**

- Where: `scripts/accept/0/06-no-donor-code.sh:12,15,18,21` (the four `git ls-files` list sources) and the `scan()` loop fed by line 21.
- What: with a PATH shim where `git ls-files` exits 128 but `git rev-parse` works, the check exits **0** — four shim invocations, empty lists, zero files scanned (`v2-19-probe-06-git-lsfiles.log`). The close-out hardened `docker ps`, `git grep` and the per-file grep, but not the file-list source; lines 15/18 compound it with `|| true`.
- Why it matters: a check that stays green under a relevant sabotage is a finding of the highest severity (verify-stage step 5); the audit's D-06 guard is meant to fail closed (the file's own comment insists "any other exit means the file could not be read, so the guard must not pass").
- Fix: capture and test the exit status of every `git ls-files` (fail on rc≠0) before the emptiness tests; drop the `|| true` on lines 15/18 in favour of explicit rc handling.

**F3 — Check 06 enforces "negative case" as a word grep.**

- Where: `scripts/accept/1a/06-spike-answers-complete.sh:24-27` (`grep -qi 'negative' "$ev/q$n.log"`) and the line it legitimises, `docs/evidence/1a/spike/q10.log:25` ("Negative case: none obtainable without a key — no proxy egress was attempted.").
- What: the check passes q10 on a sentence that states no negative case exists. My sabotage proved the word is the only enforcement (stripping it → FAIL); a completed stage could pass this row without any negative case for a keyless question.
- Why it matters: the stage prompt requires Q3/4/7/10/14/15 evidence to show both a positive and a negative case; the check cannot distinguish an observed negative case from a denial that one was obtainable.
- Fix: require a structured marker for observed negatives (e.g. `Negative case:` followed by an observation on the same line) and make q10's "none obtainable" wording not count; or assert the negative row per question with expected content.

**F2 — Stage-1a preflight table not recorded in `docs/build-notes.md`.**

- Where: `docs/prompts/stage-1a-spike-and-base-image.md:37` ("record the table in `docs/build-notes.md`") vs `docs/build-notes.md:6-14` (only the Stage-0 preflight section; no stage-1a rows anywhere — search for `provider-file`, `http-port`, `compose`, `selinux` matches nothing).
- What: the requirement is met only as a standing FAIL line inside the accept log; the build notes have no table. The report's "Not performed" and "Not built" sections do not list the omission and §5 says "Nothing the stage asked for is missing as an artifact".
- Why it matters: a stage-prompt requirement with no acceptance check is a finding (`verify-stage.md` step 2); "Not performed/Not built" must be complete.
- Fix: add the Stage-1a preflight table (runtime, compose, selinux, provider-file FAIL, install-url, AGENCY_HTTP_PORT=8081, userns, kernel) to `docs/build-notes.md`, and note the omission in the report's sections 4/5.

**F5 — Report wording: `docker history` is not "clean".**

- Where: `docs/reports/stage-1a.md:36-37`.
- What: `docker history --no-trunc` contains one matching line (the HEALTHCHECK metadata with the literal `${OPENCODE_PASSWORD}` placeholder) and `docker inspect` contains the same; neither contains a value. The report claims "docker history clean; the single docker inspect hit…".
- Why it matters: report claims must match the tree literally (`verify-stage.md` step 7). No secret value leaks either way (`v2-20-image-metadata.log`).
- Fix: reword to "history and inspect each show the HEALTHCHECK's `${OPENCODE_PASSWORD}` variable-name reference once; no value appears anywhere".

## Claims compared with the tree

- **Commit subjects vs diffs**: all 18 commits from `4721f11..HEAD` checked; each subject matches its diff. No subject claims "live", "verified" or "complete". Notable matches: `ba64e84` adds the role-aware parser and rewires `spike.sh`; `0501a09` scopes the D-06 scan and updates the register row; `382aa7e`/`3ccfd64`/`7e572d1` harden fail-closed paths; `3f05923`/`8131dcd` refresh evidence only.
- **"Built" items**: preflight, Dockerfile/entrypoint/`make build-base`, spike runner/config, the eight checks, the parser, `.env.example` port 8081, `versions.env` pins — all exist, are wired (run by checks/Makefile/spike), and are exercised. The one Built-side gap is the build-notes table (F2).
- **"Not performed" / "Not built"**: accurate for the key-dependent items (check 05 skip, Q1/9/10/11, model-dependent Accepts, code-reviewed-only docker-ps path in 05); not complete because of F2. The "Not built" claim "Nothing the stage asked for is missing as an artifact" does not survive F2.
- **Register guards due by this stage**: stage-0 rows (D-03, D-06, D-08, D-09, D-10, D-14…D-18, D-22, D-23, D-27…D-30) are guarded by stage-0 checks/tests, re-run green except the branch-name row; `0/06` (D-06/D-27) passes on this branch and its register text now matches the sanctioned stage-1a harness exemption. F4 shows the guard is not yet fail-closed on its list source.

## Fail-closed probes

| Situation                                                     | Expected                                                                        | Observed                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Empty `OPENCODE_PASSWORD` / empty `OPENCODE_API_KEY` at start | exit 64 naming the variable                                                     | check 03 PASS both cases (accept log); entrypoint code read; container logs name the variable |
| `.env.provider` absent                                        | preflight exit 1 naming provider-file; `spike.sh` exit 1 naming the missing key | observed (v2-09, v2-12, v2-22)                                                                |
| `.env.provider` wrong mode (0644)                             | preflight exit 1                                                                | observed, provider-file FAIL mode=644 (v2-12)                                                 |
| Unreadable/malformed `/etc/agency/mcp-requirements.json`      | refuse to serve, exit 64 naming the file                                        | observed exit 64 (v2-10)                                                                      |
| `docker ps -a` fails in check 08                              | check exit 1, never a vacuous pass                                              | observed (v2-15)                                                                              |
| `git grep` fails in check 07                                  | check exit 1                                                                    | observed (v2-18)                                                                              |
| Unreadable scanned file in 0/06                               | check exit 1                                                                    | observed (v2-18)                                                                              |
| `git ls-files` fails in 0/06                                  | check must exit 1                                                               | **check exited 0 — F4** (v2-19)                                                               |

## Not verified

- `scripts/spike.sh` to green and its `SPIKE PASS` line; the keyed success path of check 05; and check 05's `docker ps` fail-closed branch (only reachable after a successful keyed run). Blocked by the absent provider key.
- Questions 1, 9, 10, 11, and every model leg (Q7 model-driven edit allow/deny, Q15 model shell tool, Q8 real-run fill-in) — no key, no `AGENCY_MODEL`.
- Check 07's keyed branch with a real key: only a dummy value could be used (mechanism is value-independent; the real-key case is the user's to trigger).
- Cold-cache registry pull of the pinned `ubuntu:24.04` digest: the build is docker-cache-satisfied on this host; the digest pin and its match with `versions.env` are verified textually and by check 02, and the image was rebuilt from the restored tree.
- `make up`/`make down` deliberately are not stage targets (stubs exit 2 by design; recorded in v2-05).

To finish stage 1a: place a real key in `.env.provider` (mode 0600) and set `AGENCY_MODEL`, run `scripts/spike.sh` to `SPIKE PASS`, record Q1/9/10/11 evidence under `docs/evidence/1a/spike/`, re-run `scripts/accept.sh 1a` to exit 0, then run this verification again.

## Notes

- Host `opencode` is now v2.0.28 (the previous pass recorded 2.0.27); the image pins and checks 2.0.26 as required — no impact.
- `agent` keeps the supplementary groups of the renamed uid-1000 `ubuntu` user (including `sudo` on paper). The image installs no `sudo` and the account has a locked password; the fleet-level `cap_drop`/no-new-privileges contract is Stage 1b's (D-07). Observation, no rule broken.
- Dev-harness containers (`scripts/spike.sh:81`, `scripts/accept/1a/03:28,42`, `04:27`) are started without CPU/memory/PID limits or `cap_drop`. Classified as a justified exception: the stage prompt mandates these direct starts, every container is named and torn down by trap (verified), and the limits contract is bound to the generated compose in Stage 1b per the register (D-07). No `agency-*` container was left behind at any point.
- `|| true` sites: only teardown (`spike.sh:35`, `03:14,26,40`, `04:14,26`) and the two `ls-files | grep` lines now reported under F4. All `2>/dev/null` sites on judged paths are paired with fail-closed fallbacks (`?`/`unknown` → fail, empty → FAIL row, rc checks in 07).
- `process.env` first-party: only `dispatcher/src/config.ts` (allowed) and the stage-0 harness self-test fixture `scripts/accept/test/accept.test.ts:59,63` (outside the lint guard's `dispatcher/src`+`verifier/src` scope) — justified.
- OpenCode API paths outside `dispatcher/src/opencode.ts`: only `scripts/spike.sh` (the stage-mandated harness the D-06 scan explicitly exempts) and a parser docstring — justified.
- The interrupted pass's partial logs (`00-…` through `21-…` under `docs/evidence/1a/verify/`) are superseded by this pass's `v2-*` files and are not cited.
- Evidence hygiene: because this evidence will be committed, my logs contain no non-empty `OPENCODE_API_KEY` assignment line (check 07 would otherwise fail on them); one command echo in `v2-10` was redacted and the check-07 regex re-run is clean.

VERDICT: FAIL — `docs/reports/stage-1a-verification.md`
