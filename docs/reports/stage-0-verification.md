# Stage 0 — verification

Commit: `66b21bc` Branch: `stage-0-salvage` Date: 2026-10-13 (UTC) Verifier: Muse Spark 1.3 (OpenCode)

VERDICT: FAIL

## Summary

On a clean re-run, `make check` is green (78 pass, 0 fail) and `bash scripts/accept.sh 0` exits 0 with the same 10/10 PASS table as the builder's report. The harness (`accept.sh`/`lib.sh`), the defect register check, provenance, donor-code, no-skips, fake-vs-openapi, and CI checks are strict: they fail on mismatch, enforce exit/result-line agreement, and my three sabotages (bad disposition, `unlock` path, removed salvage destination) each went red with exit 1 and restored clean. The stage fails on check `0/09-opencode-live`: pointing `OPENCODE_BIN` at a nonexistent binary makes the live suite skip both tests via early return, yet `bun test` reports "2 pass" and the check prints PASS with overall exit 0 — a vacuous pass (shared context 4.1.4, pattern 4.6 "passes with the service stopped"). Separately, check 09 proved flaky: with no tree change it later timed out and failed when the keyless `prompt` step hung. A minor gap: the D-17 guard test has no pre-fix failure demo.

## Checks

| Check                                                                          | Builder             | Verifier                                                                      | Evidence                                                                                                |
| ------------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 0/01-make-check                                                                | PASS                | PASS                                                                          | docs/evidence/0/verify/accept-0.log                                                                     |
| 0/02-ts-coverage                                                               | PASS                | PASS                                                                          | docs/evidence/0/verify/accept-0.log                                                                     |
| 0/03-harness-selftest                                                          | PASS                | PASS                                                                          | docs/evidence/0/verify/accept-0.log                                                                     |
| 0/04-defect-register                                                           | PASS                | PASS                                                                          | docs/evidence/0/verify/accept-0.log                                                                     |
| 0/05-salvage-provenance                                                        | PASS                | PASS                                                                          | docs/evidence/0/verify/accept-0.log                                                                     |
| 0/06-no-donor-code                                                             | PASS                | PASS                                                                          | docs/evidence/0/verify/accept-0.log                                                                     |
| 0/07-no-skips                                                                  | PASS                | PASS                                                                          | docs/evidence/0/verify/accept-0.log                                                                     |
| 0/08-fake-matches-openapi                                                      | PASS                | PASS                                                                          | docs/evidence/0/verify/accept-0.log                                                                     |
| 0/09-opencode-live                                                             | PASS                | PASS on clean run; FAIL (timeout) on later rerun; PASS-vacuous under sabotage | docs/evidence/0/verify/accept-0.log, live-direct.log, live-bogus-bin.log, probe-09-bogus-bin-accept.log |
| 0/10-ci-runs-make-check                                                        | PASS                | PASS                                                                          | docs/evidence/0/verify/accept-0.log                                                                     |
| `make check` green, 78 pass                                                    | green               | green, 78 pass                                                                | docs/evidence/0/verify/make-check.log                                                                   |
| `accept.sh selftest` exit 77                                                   | 77 (1 pass, 1 skip) | 77 (1 pass, 1 skip)                                                           | harness output, table matches                                                                           |
| Targeted defect tests (exec, audit, worktrees, run-checks, protocol, opencode) | pass                | 46 pass, 0 fail                                                               | rerun during verification                                                                               |
| Live suite direct run                                                          | 2 pass, 8.3 s       | 2 pass, 8 expects, 8.61 s                                                     | docs/evidence/0/verify/live-direct.log                                                                  |

Starting state: clean tree on `stage-0-salvage` at `66b21bc`; Bun 1.4.2, Docker 29.9.0, `opencode` 2.0.27 on PATH (pin 2.0.26); `OPENCODE_API_KEY` absent; no fleet containers (only unrelated host stacks). `SALVAGE_SRC` verified at `14f297a`, donor untouched (read-only). Step-0 preflight facts in `docs/build-notes.md` confirmed (Bun/git/Docker/SELinux/salvage commit). All 11 salvage sources exist at `14f297a`; all table destinations exist.

## Sabotage sample

| Check                   | What I broke                                                                                                   | Result                                                                                                                                | Restored                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 0/04-defect-register    | Changed D-24 disposition `guarded: no credential default` to `pending` (different from builder's row deletion) | FAIL `row D-24 has unknown disposition: pending`, 9 pass/1 fail                                                                       | Yes, `git checkout -- docs/audit/defects.md`, status clean |
| 0/06-no-donor-code      | Staged `docs/unlock-sabotage-note.md` (different from builder's `.patch`)                                      | FAIL `paths containing unlock`, accept exit 1, 9 pass/1 fail                                                                          | Yes, reset + rm, status clean                              |
| 0/05-salvage-provenance | Moved `dispatcher/src/opencode.ts` to /tmp during the run (different from builder's `SALVAGE_SRC` override)    | FAIL `salvage destination missing`, accept exit 1 (4 fail incl. cascading 01/02/08)                                                   | Yes, moved back, `git diff` empty, status clean            |
| 0/09-opencode-live      | `OPENCODE_BIN=/nonexistent-xyz` (binary IS on PATH, so no harness skip)                                        | **Stayed green**: suite printed two `[opencode-live] SKIP` warnings, `bun test` reported `2 pass`, check printed PASS, overall exit 0 | Env-only, no tree change                                   |

Builder red proofs under `docs/evidence/0/red/` reviewed: every check has a first-line sabotage statement, each sabotage is real and matched to the check's claim, plus five `make check` red runs and six defect reds on unfixed code. All credible.

## Findings

- Where: `scripts/accept/0/09-opencode-live.sh` + `dispatcher/test/live/opencode.live.test.ts:27-33,130,138` (`skipOrLive()` early return)
  What: With `OPENCODE_BIN` pointing at a nonexistent path while `opencode` is on PATH, no server is ever started, both tests early-return, `bun test` exits 0 with "2 pass", and the check prints `CHECK 0/09-opencode-live: PASS` (overall accept exit 0). Proven twice: direct run (`docs/evidence/0/verify/live-bogus-bin.log`) and full accept run (`docs/evidence/0/verify/probe-09-bogus-bin-accept.log`). The `require_cmd --optional opencode` gate only inspects the literal `opencode` name, not `$OPENCODE_BIN`, and passing-test output (including the SKIP warnings) is discarded by the check.
  Why it matters: A skip is counted as a pass (shared context 4.1.4); a check that prints PASS with the service stopped (4.6, highest severity). It breaks verify-stage section 9: a sabotaged check did not go red. This alone forces FAIL; it is the D-22/D-29 failure class the stage was built to exclude.
  Fix: make the check fail when test output contains a SKIP (e.g. grep for `\[opencode-live\] SKIP` and `fail` on match), or validate `${OPENCODE_BIN:-opencode}` resolvability with `require_cmd` before running, or convert the in-test early return into a throw so an unrunnable suite cannot report pass.
- Where: check `0/09-opencode-live`, `dispatcher/test/live/opencode.live.test.ts:137-166`
  What: The lifecycle test is not reproducibly green on an unchanged tree. After two green runs (accept 10/10 exit 0; direct 2 pass in 8.61 s), three consecutive runs failed with no tree change: harness `timeout after 120s`, then a standalone `1 pass 1 fail in 123.54 s`, then the same with a fresh `HOME` (ruling out state-dir pollution from my process cleanup). Expect counts (4 vs 8) show the hang is in the keyless `prompt` step: `createSession` succeeds, the prompt request never answers. The prompt-then-`wait` flow depends on server-internal drain timing with no provider key, i.e. timing-dependent in exactly the environment CI/devs will run it in.
  Why it matters: Section 9 requires `make accept` to exit 0; a check that flips red without any change breaks reproducibility of the verdict and will gate every later stage that re-runs it.
  Fix: remove the model-adjacent `prompt`+`wait` from the keyless live path (keep create/diff/messages/delete, which are deterministic), or pin generous, documented timeouts plus a retry with a red (not silent) outcome, and record the keyless-timing assumption in build notes.
- Where: `docs/audit/defects.md` D-17, `dispatcher/test/opencode.test.ts:82`
  What: The guard test `createSession sends agent, location, permissions, metadata` exists and passes, but there is no red demo: no log under `docs/evidence/0/red/` and no commit-order proof (steps 4–10 share commits `c2f41ea`/`1292068`). Shared context 4.3 requires each defect test be shown failing pre-fix. The report claims no D-17 red, so this is a gap, not a false claim.
  Why it matters: 4.3 compliance for one of eleven salvaged fixes is unproven.
  Fix: append a red log running the test against the unfixed `createSession`, or record why commit order already demonstrates it.
- Where: stage prompt Step 0 Accept (branch + `docs/build-notes.md` Preflight) and Step 11 handoff note
  What: Neither has a dedicated acceptance check (verify-stage procedure 2). I verified both manually: branch `stage-0-salvage` exists, Preflight section holds all required facts, `docs/handoff/heretek-opencode-archive.md` is tracked.
  Why it matters: Procedure 2 names unguarded requirements as findings; both hold today but can drift silently.
  Fix: extend check 04/05 coverage or add one small check asserting branch name, Preflight fields, and handoff-note presence.

## Claims compared with the tree

- Commit subjects (`7004f9f`, `c2f41ea`, `1292068`, `6ac5070`, `66b21bc`) each match their diffs; no `live`/`verified`/`complete`/`all` overclaims. `66b21bc` holds exactly the red-proofs log and green accept log.
- All 13 "Built" items exist. "Not wired" is accurate with one nuance: `audit.ts` is imported by the human-run `scripts/audit-repair.ts` and `model.ts` by `graph.ts` — library-level use the report already describes as "wired where needed"; no fleet service imports any salvaged module, and `opencode.ts` (client), `graph.ts`, `worktrees.ts`, `run-checks.ts`, `protocol.ts` have no non-test importers. Justified, no violation.
- "Not performed: none" is accurate for the builder's environment (09 passed live; skip path exists only via `require_cmd`). "Not built" is complete.
- Deviations verified true, not violations: `make accept STAGE=selftest` exits 2 (`Error 77`, make normalizes) while `bash scripts/accept.sh selftest` exits 77 — reproduced exactly; the 0/1/77 contract provably lives in `accept.sh`. `GET /api/info` unwrapped confirmed by the passing live assertion on `version`. Redacted (not raw) verifier logs are a documented, reasonable reading of "full".
- All 16 stage-0 register guards resolve to existing, passing tests/checks/scans.

## Fail-closed probes

| Situation                                         | Expected                              | Observed                                                               |
| ------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| Empty verifier check list                         | Error / `no-checks`                   | `NoChecksError` unit test passes (46-test targeted run green)          |
| Torn audit tail                                   | Refuse to open with byte offset       | Unit test passes                                                       |
| Second audit writer                               | Refused (lock holder named)           | Unit test passes                                                       |
| Missing `opencode` binary                         | Check-level skip (77), not pass       | By design via `require_cmd --optional`; not triggered (binary present) |
| Unrunnable binary override (`OPENCODE_BIN` bogus) | FAIL or SKIP, never PASS              | **PASS with exit 0 (Finding 1)**                                       |
| Unbuilt `make` targets                            | Exit 1 with `not built until stage X` | `make build` → `Error 1` as required                                   |
| Credential-less service start                     | Refuse, naming variable               | N/A in stage 0 (no service; guard due in 1d)                           |

## Not verified

- Execution of `.github/workflows/ci.yml` on GitHub runners (pushing is forbidden to this role); the workflow file is statically verified to install pinned Bun, frozen lockfile, and run bare `make check` with no exit-code override.
- Nothing else material is unverified. Donor and `review/` trees were read only.

## Notes

- Harness timeout kills only the direct child: on the two hung 09 runs, `timeout` terminated `bash` but left `bun test`'s `opencode serve` orphaned on port 4199; both orphans ignored SIGTERM and needed SIGKILL (upstream `serve` behavior worth knowing for stage 1c lifecycle kills). Strays were confirmed gone afterwards; this path only triggers on hangs.
- `review/opencode` is absent inside the worktree but check 08 resolves the real spec via the main checkout (`/home/john/Projects/The-Agency/review/opencode/...`, verified present); `OPENCODE_SPEC_PATH` override exists.
- Cosmetic: `docs/build-notes.md` Salvage table ends with an empty `| ... |` row (lines 35–36).
- Probe method note: sabotage accept runs used `EVIDENCE_ROOT=/tmp/verify-sab` so the tree stayed clean; stray harness logs I generated were deleted. Only `docs/evidence/0/verify/` and this report were added.
