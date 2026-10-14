# Stage 1c — verification

Commit: 71c97fe Branch: stage-1c-engine Date: 2026-10-14T20:16:33Z Verifier: Muse Spark 1.3 (OpenCode drift reviewer)

VERDICT: PASS

## Summary

All builder claims hold. `make check` re-ran green (198 pass / 0 fail) and a full
`accept.sh 1c` re-run with ACCEPT_TIMEOUT=1800 passed 10/10 with 0 skips. Every
Built item exists and is exercised; every defect-register guard due by 1c
(D-01, D-02, D-05, D-11, D-12, D-16, D-31) names a real test that runs green.
My own sabotage sample (07, 08, 09, 10) turned every check red and each was
restored exactly, with 09/10 re-run green and 07/08 restored to healthy without
burning extra model runs. Section 4.6 scans are clean; the two apparent hits are
justified exceptions documented below. No findings.

## Checks

| Check                            | Builder | Verifier | Evidence                                                                                                                 |
| -------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1c/01-make-check                 | PASS    | PASS     | docs/evidence/1c/accept-20261014T201313Z.log; docs/evidence/1c/verify/make-check.log                                     |
| 1c/02-register-guards-present    | PASS    | PASS     | docs/evidence/1c/accept-20261014T201313Z.log                                                                             |
| 1c/03-scheduler-pure             | PASS    | PASS     | docs/evidence/1c/accept-20261014T201313Z.log                                                                             |
| 1c/04-single-opencode-module     | PASS    | PASS     | docs/evidence/1c/accept-20261014T201313Z.log                                                                             |
| 1c/05-verifier-live              | PASS    | PASS     | docs/evidence/1c/accept-20261014T201313Z.log                                                                             |
| 1c/06-verifier-isolated          | PASS    | PASS     | docs/evidence/1c/accept-20261014T201313Z.log                                                                             |
| 1c/07-engine-live-scout          | PASS    | PASS     | docs/evidence/1c/accept-20261014T201313Z.log                                                                             |
| 1c/08-engine-live-docs-lands     | PASS    | PASS     | docs/evidence/1c/accept-20261014T201313Z.log                                                                             |
| 1c/09-no-task-exec-in-dispatcher | PASS    | PASS     | docs/evidence/1c/accept-20261014T201313Z.log                                                                             |
| 1c/10-audit-chain-intact         | PASS    | PASS     | docs/evidence/1c/accept-20261014T201313Z.log (549 entries, tip a0f54a5d…, branch fleet/integration/m-live-docs-mv8jn66u) |

Builder column is the QA green run docs/evidence/1c/accept-20261014T163148Z.log
(10 pass, 0 skip, 0 fail), which agrees with the programmer's prior
docs/evidence/1c/accept-20261014T162518Z.log. Verifier column is my re-run from
the clean committed tree (commit 71c97fe, `git status` clean at start).

Accept-line claims from the stage prompt: steps 1–4, 6–8 accept on unit tests
(re-run green inside `make check` and check 02, which runs each guard test
individually asserting ≥1 pass and 0 fail); step 5 accepts on checks 05/06
(re-run green live); step 9 accepts on checks 07/08 (re-run green live against
the Stage 1b fleet with the provider key present — no skips, as the prompt
requires for completeness).

## Sabotage sample

| Check                         | What I broke                                                                                                         | Result                                                           | Restored                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 07-engine-live-scout          | `docker pause agency-scout` (builder paused scout; QA paused docs — mine matches builder's target but is my own run) | FAIL exit 1: `make up` refuses paused container, no model called | Yes: unpause + `make up`; scout/docs/verifier all healthy. Not re-run green (no extra model burn; green proven by my full run minutes earlier) |
| 08-engine-live-docs-lands     | `docker pause agency-docs`                                                                                           | FAIL exit 1: same fail-fast path, no model called                | Yes: unpause + `make up`; all healthy; live-docs audit log byte-untouched. Not re-run green, same reason                                       |
| 09-no-task-exec-in-dispatcher | appended dead `execShell("verify-sabotage");` to dispatcher/src/engine.ts                                            | FAIL exit 1: caller allowlist names engine.ts                    | Yes: `git checkout --`; re-run PASS exit 0                                                                                                     |
| 10-audit-chain-intact         | corrupted one hex char of the entry hash at line 250 of /tmp/opencode/1c-live-docs/audit/audit.jsonl                 | FAIL exit 1: `audit chain broken at line 250: hash mismatch`     | Yes: byte-exact copy-back verified by `cmp`; re-run PASS exit 0                                                                                |

`git status` shows only untracked evidence files and `git diff` is empty after
every restore. Builder red proofs (10 accept + 8 unit logs) and QA red proofs
(10 logs, deliberately different sabotages) were reviewed and are real,
correctly targeted, and all restored.

## Findings

None. No rule or requirement is broken.

## Claims compared with the tree

- Commit subjects (`git log` merge-base with main..HEAD, 14 commits): each
  describes its diff. No subject uses "live", "verified", "complete", or "all"
  untruthfully ("QA green run and per-check red-proof evidence" ships exactly
  that evidence; "acceptance harness for engine, verifier, and live proofs"
  ships exactly that).
- Every "Built" item in docs/reports/stage-1c.md exists at the stated path
  (checked all 19 files). `engine.ts` has no non-test importer, but the report
  explicitly lists the Engine surface as "Not built: not wired" with tests and
  the live script as its only callers — disclosed, and rule 4.1.9 is satisfied
  by that disclosure. `landing`/`runner`/`store`/`opencode` are imported by
  engine/runner/tests, so the engine core is wired to its callers.
- "Not performed: None" is accurate — my re-run also had 0 skips (key
  present, so 07/08 ran live as the prompt requires).
- "Not built" correctly lists the Stage 1d surface (HTTP/REST/SSE, fleet_*
  MCP, Director hook wiring, gateway, dashboard, CLI).

## Fail-closed probes

| Situation                           | Expected                                           | Observed                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty check list to verifier        | `no-checks` failure, never success                 | Check 05 asserts `ok:false` + `reason:no-checks` live; unit test `defect: empty check list is an error` passes                                                                 |
| Wrong/missing verifier token        | 401 refusal                                        | Checks 05 (wrong token → 401) and 06 (tokenless expert call → 401) live                                                                                                        |
| Verifier env carries provider key   | must not                                           | Check 06 greps verifier env, fails if `OPENCODE_API_KEY` present — green                                                                                                       |
| Task command execution location     | only verifier/git paths, never Dispatcher host env | Check 09: raw spawn only in `util/exec.ts`; callers exactly `{git.ts, exec.ts, run-checks.ts}`; `git.ts` runs only `git`; `run-checks.ts` takes explicit env, no `process.env` |
| Task with no RESULT after follow-up | fail `no-block`                                    | Runner tests cover no-block-then-block (done) and no-block-twice (`no-block`); D-31 transcript-order test passes                                                               |
| Task/mission marked done            | needs landed SHA                                   | `mission is not done without landedSha` passes (also red-proven); landing tests assert `--no-ff`, four trailers incl. `Agency-Audit-Tip`, reset on red post-merge verify       |
| Expert/verifier unreachable         | fail `unreachable` / check red                     | Runner `unreachable` test; checks 05/06 go red with containers stopped; my 07/08 pauses fail fast                                                                              |
| Timeout                             | whole process group killed, confirmed gone         | Check 05 backgrounds `sleep 297` with 2s timeout, then polls 15×2s for survivors — green                                                                                       |
| Permission request to Dispatcher    | rejected, never `ask`                              | No `"ask"` string in dispatcher source or generated expert configs; runner rejects pending requests with the exact headless message (tested)                                   |
| Credential empty                    | service refuses, names variable                    | `config.ts` is the only non-test `process.env` reader; `config-1c.test.ts` covers missing-credential throws; secrets 0600, untracked, no secret patterns in evidence           |

## Not verified

Nothing the verdict depends on. 07/08 were not re-run green _after_ my
sabotage (deliberate: no extra model burn); their green state was proven by my
own full accept run on the identical tree minutes before, and post-sabotage
restore was confirmed by all three engine containers healthy plus the live
state dirs (`/tmp/opencode/1c-live-scout`, `/tmp/opencode/1c-live-docs` incl.
the byte-identical audit log) intact.

## Notes

- My first attempt at sabotaging check 10 (truncating the last audit line) did
  not turn it red: the check requires the landed tip to be _a member_ of a valid
  chain, and post-landing entries are not the anchor, so PASS was the correct
  answer. The effective sabotage (mid-chain hash corruption) went red with a
  precise reason. This is check behaving correctly, not a weakness.
- `scripts/accept/1c/engine-live.inc` runs its proof container with `--name`
  and `--rm` but without CPU/memory limits. Justified exception: it is harness
  code the stage prompt requires to start containers (same allowance the D-06
  guard records for `scripts/accept/**`), not a fleet-started task container;
  nothing is left running.
- `make check` prints one `fatal: ambiguous argument 'refs/heads/fleet/docs-a1'`
  line from a git-behaviour test probe; the run is green (198 pass, 0 fail).
- Evidence written: docs/evidence/1c/verify/{make-check,accept-verify,
  sabotage-07,sabotage-08,sabotage-09,sabotage-10}.log plus the accept-harness
  timestamped log docs/evidence/1c/accept-20261014T201313Z.log. Nothing committed.
