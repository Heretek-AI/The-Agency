# Stage 0 — verification

Commit: `c02e3ef` Branch: `stage-0-salvage` Date: 2026-10-13 (UTC) Verifier: Muse Spark 1.3 (OpenCode)

VERDICT: PASS

## Summary

On a clean tree at `c02e3ef`, `make check` exits 0 (78 pass, 0 fail) and `make accept STAGE=0` exits 0 with 10/10 PASS, matching the builder's table exactly. All ten acceptance scripts are strict: exit/result-line agreement is enforced by the harness, `|| true` appears only on probe plumbing with an explicit status test after, and the sole SKIP path (check 09 without an `opencode` binary) is the one the stage prompt allows. My four sabotages — corrupted disposition (04), staged `bwrap` source (06), `|| true` in CI (10), `OPENCODE_BIN=/bin/true` (09) — each went red with exit 1 and restored clean; all differ from the builder's/QA's sabotages. The prior FAIL is closed: a bogus `OPENCODE_BIN` now fails (harness `require_cmd` plus in-test throw), the live suite is deterministic (2 pass, ~0.6 s, no prompt/wait, no SKIP markers), and the D-17 red proof shows the guard failing on unfixed code. No shared-context 4.6 pattern is violated.

## Checks

| Check                                                                                              | Builder               | Verifier                                                                                                        | Evidence                                                                 |
| -------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 0/01-make-check                                                                                    | PASS                  | PASS                                                                                                            | docs/evidence/0/verify/drift-accept-canonical.log, drift-make-check.log  |
| 0/02-ts-coverage                                                                                   | PASS                  | PASS                                                                                                            | docs/evidence/0/verify/drift-accept-canonical.log                        |
| 0/03-harness-selftest                                                                              | PASS                  | PASS                                                                                                            | docs/evidence/0/verify/drift-accept-canonical.log                        |
| 0/04-defect-register                                                                               | PASS                  | PASS                                                                                                            | docs/evidence/0/verify/drift-accept-canonical.log                        |
| 0/05-salvage-provenance                                                                            | PASS                  | PASS                                                                                                            | docs/evidence/0/verify/drift-accept-canonical.log                        |
| 0/06-no-donor-code                                                                                 | PASS                  | PASS                                                                                                            | docs/evidence/0/verify/drift-accept-canonical.log                        |
| 0/07-no-skips                                                                                      | PASS                  | PASS                                                                                                            | docs/evidence/0/verify/drift-accept-canonical.log                        |
| 0/08-fake-matches-openapi                                                                          | PASS                  | PASS                                                                                                            | docs/evidence/0/verify/drift-accept-canonical.log                        |
| 0/09-opencode-live                                                                                 | PASS (live)           | PASS (live, no skip)                                                                                            | docs/evidence/0/verify/drift-accept-canonical.log, drift-live-direct.log |
| 0/10-ci-runs-make-check                                                                            | PASS                  | PASS                                                                                                            | docs/evidence/0/verify/drift-accept-canonical.log                        |
| `make check` green, 78 pass                                                                        | green                 | green, 78 pass, 0 fail, exit 0                                                                                  | docs/evidence/0/verify/drift-make-check.log                              |
| `accept.sh selftest` exit 77                                                                       | 77 (1 pass, 1 skip)   | not re-run (harness unit tests green in check 03; selftest fixture dir unchanged since prior PASS verification) | —                                                                        |
| Step 0 Accept (branch, Preflight)                                                                  | gated by check 05     | PASS (check 05 asserts branch `stage-0-salvage`, Preflight fields)                                              | drift-accept-canonical.log                                               |
| Step 11 Accept (guard red-proof, handoff note, salvage table)                                      | gated by checks 05/06 | PASS                                                                                                            | drift-accept-canonical.log                                               |
| Stage-0 defect guards (D-03/D-08/D-09/D-10/D-14/D-15/D-16/D-17/D-18/D-22/D-23/D-27/D-28/D-29/D-30) | pass                  | all guard tests present and passing; red demos on file                                                          | § Fail-closed probes; docs/evidence/0/red/                               |

Starting state: clean tracked tree on `stage-0-salvage` at `c02e3ef` (no uncommitted changes); Bun 1.4.2, Docker 29.9.0, `opencode` 2.0.27 on PATH (pin 2.0.26); `OPENCODE_API_KEY` absent; SELinux Enforcing; no fleet containers running (only unrelated host stacks); `SALVAGE_SRC` at `14f297a` with only the expected untracked `docs/`; all 11 salvage sources present at that commit.

## Sabotage sample

| Check                   | What I broke                                                                                        | Result                                             | Restored                         |
| ----------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------- |
| 0/04-defect-register    | `sed s/fixed in salvage/test-pass-broken/` in defects.md (corrupted disposition, not row deletion)  | FAIL `row D-03 has unknown disposition`, exit 1    | Y (`git checkout`, status clean) |
| 0/06-no-donor-code      | new staged `dispatcher/src/sabotage-tmp.ts` containing `bwrap` (new vector, not `*.patch`/`unlock`) | FAIL `bwrap in first-party source`, exit 1         | Y (reset + rm, status clean)     |
| 0/10-ci-runs-make-check | `- run: make check \|\| true` in ci.yml (override, not removal)                                     | FAIL `workflow overrides a step exit code`, exit 1 | Y (`git checkout`, diff clean)   |
| 0/09-opencode-live      | `OPENCODE_BIN=/bin/true` (spawns then exits at once; `opencode` on PATH so no harness skip)         | FAIL `live test failed: 0 pass 1 fail`, exit 1     | Y (env-only, status clean)       |

Builder/QA red proofs in `docs/evidence/0/red/` and `red-proofs.log` reviewed: each sabotage is real and matched to its check's claim (typecheck break, stray tracked `.ts`, failing harness test, deleted D-30, `SALVAGE_SRC=/tmp`, moved handoff note, staged `*.patch`, `test.skip`, renamed fake route, `/bin/false` and nonexistent `OPENCODE_BIN`, removed CI line, plus all seven defect-code reds). First lines state the break; restore discipline (EVIDENCE_ROOT=/tmp, donor untouched) is credible and the tree confirms it. Post-sabotage, checks 04/06/10 re-ran green directly and the full suite re-ran green twice.

## Findings

None. No rule-breaking observation was found; the prior verification FAIL items are closed:

- Prior FAIL (a), vacuous pass under bogus `OPENCODE_BIN`: closed. `09-opencode-live.sh` now `require_cmd`s a non-empty `OPENCODE_BIN` (fails closed) and greps the test output for any `[opencode-live] SKIP` marker as a failure; the suite's `requireLive()` throws instead of returning early. Proven by QA's `/nonexistent-xyz` red proof and my `/bin/true` sabotage (exit 1 both).
- Prior FAIL (b), keyless prompt/wait flake: closed by removal. The suite exercises only deterministic create/get/diff/messages/delete; direct run 2 pass / 0 fail in 584 ms with zero SKIP markers, green inside both of my full accept runs.
- Prior gap, D-17 pre-fix demo: closed. `docs/evidence/0/red/opencode-d17.log` shows the guard test failing (0 pass, 1 fail, fake answers 400 `location.directory is required`) against the reverted shape.

## Claims compared with the tree

- Commit subjects (`0bf256e..c02e3ef`, 12 commits): each describes its diff; no "live"/"verified"/"complete"/"all" overclaim. `c02e3ef` ("QA re-verification logs on HEAD 8abb8be") contains only evidence logs — accurate.
- Built items (Steps 0–11): every file exists — scaffolding, harness + fixtures, `docs/audit/defects.md` (D-01..D-30), `dispatcher/src/{util/{hash,redact,exec},config,audit,model,graph,worktrees,protocol,opencode}.ts`, `verifier/src/run-checks.ts`, `dispatcher/test/support/{fake-opencode,git,lock-probe}.ts`, live test, checks 01–10, handoff note, salvage table in build-notes. Non-test imports confirm the wiring the report claims (worktrees→exec, run-checks→exec/hash/redact/config, audit→hash/redact, repair script→audit, openapi check→fake).
- Not performed ("None"): accurate — my runs show 10 pass, 0 skip, 0 fail; check 09 passed live with the 2.0.27 binary present, so no skip was due.
- Not built: accurate — salvaged modules have no fleet caller yet (only test/script/harness imports), each listed with its wiring stage; nothing from "Not in this stage" exists.
- Deviations: spot-checked and true — `.prettierignore` covers frozen prose, `make accept` delegates to `accept.sh` (make normalizes non-zero recipe exits, so the 0/1/77 contract lives in the script as stated), `render-check` passes vacuously with an explicit message, `/api/info` unwrapped exception documented.

## Fail-closed probes

| Situation                                                                         | Expected                                                        | Observed                                                |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Verifier given empty check list                                                   | throw `NoChecksError` → `no-checks`                             | guard test passes (1 pass, 0 fail)                      |
| `execCmd` timeout with spawned grandchild                                         | group killed, `{exit 124, timedOut}`                            | guard test passes; PID gone                             |
| Child env with parent canary set                                                  | child sees only explicit env                                    | guard test passes                                       |
| Audit log rewritten, same length                                                  | `checkAnchor` false                                             | guard test passes                                       |
| Second `AuditLog.open` on same dir                                                | refused, names lock holder                                      | guard test passes                                       |
| Verdict `pass` containing a `blocker`                                             | invalid                                                         | guard test passes                                       |
| `createSession` without location/permissions                                      | fake 400s; guard test fails pre-fix                             | red proof on file; passes on fixed code                 |
| Bogus `OPENCODE_BIN` (`/bin/true`, exits at once)                                 | check FAIL, exit 1                                              | FAIL `0 pass 1 fail`, exit 1                            |
| CI line with `\|\| true`                                                          | check 10 FAIL                                                   | FAIL `overrides a step exit code`, exit 1               |
| `process.env` outside `config.ts`; OpenCode paths outside `opencode.ts`           | none                                                            | none found                                              |
| `bwrap` / `docker run` in first-party source                                      | none (outside `envrunner/`/`lifecycle/`, which don't exist yet) | none found (check 06 self-reference excluded by design) |
| `test.skip`/early-return; credential defaults; `ask` rules; placeholder successes | none                                                            | none found                                              |

Rows of 4.2 not touching stage-0 code (judges, provider-key startup refusal, unreachable experts, landing) belong to stages 1c–1d and are not probed here.

## Not verified

- `accept.sh selftest` (exit 77) was not re-run; the harness unit tests covering the same contract pass, and the fixture stage is unchanged since the prior verification measured 77. Low risk.
- CI itself (GitHub Actions) was not executed; only the workflow file's content was checked. Standard for this stage.
- Live suite ran against `opencode` 2.0.27 while the pin is 2.0.26; the suite asserts only `^2\.` versioning and deterministic session ops, so the newer patch binary does not weaken the claim.

## Notes

- The report's Acceptance table cites `accept-20261013T045538Z.log` in the Evidence column but pastes a table whose `log:` line reads `accept-20261013T014011Z.log`. Both files exist in the tree; the table content matches my independent run. Cosmetic only.
- README is 10 content lines (17 with blanks); "10-line README" is true of content.
- My evidence files use a `drift-` prefix under `docs/evidence/0/verify/`; the canonical full accept log is `drift-accept-canonical.log`. Nothing was committed, per the verifier rules.
