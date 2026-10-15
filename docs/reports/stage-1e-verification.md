# Stage 1e — verification

Commit: 0ff90b5c2df73ae12f99eb847c156dd447db50d1 Branch: stage-1e-web-ui Date: 2026-10-15 Verifier: Muse Spark 1.3 Contributor (drift reviewer)

VERDICT: PASS

## Summary

All nine acceptance checks pass on a clean re-run (`make check` green, `make accept STAGE=1e` 9/9, `make accept-ui` 10/10 Playwright tests). Every script under `scripts/accept/1e/` is fail-closed: no `|| true`, no `SKIP` branches, no self-created assertions, and the SSE assertion uses a raw in-page `EventSource` so REST polling cannot mask delivery loss. My own sabotage went red on four checks (02, 03, 04, 05) plus a coarse red on 06, each restored byte-exact with green re-confirmed where rebuilt. Fail-closed probes confirm viewer approve/plan/create return 403, anonymous API returns 401, and bad login returns 401. One minor finding: no automated check clicks the mission-creation form (backend proven live, UI wired, but unclicked).

## Checks

| Check                                | Builder | Verifier | Evidence                                                                                                 |
| ------------------------------------ | ------- | -------- | -------------------------------------------------------------------------------------------------------- |
| 1e/01-make-check                     | PASS    | PASS     | docs/evidence/1e/verify/make-check.log (exit 0, 256 tests pass); docs/evidence/1e/verify/accept-1e.log   |
| 1e/02-web-build                      | PASS    | PASS     | docs/evidence/1e/verify/accept-1e.log; sabotage/restore in verify/sabotage-02.log, verify/restore-02.log |
| 1e/03-auth-and-roles-ui              | PASS    | PASS     | docs/evidence/1e/verify/accept-1e.log; sabotage/restore in verify/sabotage-03.log, verify/restore-03.log |
| 1e/04-director-chat-embedded         | PASS    | PASS     | docs/evidence/1e/verify/accept-1e.log; sabotage in verify/sabotage-04.log                                |
| 1e/05-plan-edit-and-approval         | PASS    | PASS     | docs/evidence/1e/verify/accept-1e.log; sabotage in verify/sabotage-05.log                                |
| 1e/06-live-pipeline-and-diff         | PASS    | PASS     | docs/evidence/1e/verify/accept-1e.log; sabotage in verify/sabotage-06b.log (see Sabotage sample)         |
| 1e/07-mobile-parity-375px            | PASS    | PASS     | docs/evidence/1e/verify/accept-1e.log; QA red proof reviewed                                             |
| 1e/08-accessibility-axe              | PASS    | PASS     | docs/evidence/1e/verify/accept-1e.log (0 violations, 6 routes); QA red proof reviewed                    |
| 1e/09-fleet-view-core-12             | PASS    | PASS     | docs/evidence/1e/verify/accept-1e.log; QA red proof reviewed                                             |
| make accept-ui (10 Playwright tests) | 10/10   | 10/10    | docs/evidence/1e/verify/accept-ui.log                                                                    |

No check skipped (exit 77 never used; the seeded fake-expert harness runs 04–07 offline, stronger than the prompt's allowed skip).

## Sabotage sample

| Check                                          | What I broke                                                                                                                                                         | Result                                                    | Restored                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 04-director-chat-embedded                      | Changed seeded director reply text in scripts/accept/1e/test-server.ts so neither transcript nor raw SSE assertion can match (different from builder's route rename) | FAIL exit 1 (`element(s) not found`)                      | Yes, byte-exact (`diff` clean, `git status` clean)                                                         |
| 05-plan-edit-and-approval                      | Renamed seeded mission `m-wait-2` so no pending plan exists at that route (different from builder's testid rename)                                                   | FAIL exit 1                                               | Yes, tree clean                                                                                            |
| 06-live-pipeline-and-diff (attempt A, INVALID) | Removed the `approve(diffMission.id)` call — later found the single-task mission never needed approval, so the seed was unchanged and PASS was correct               | PASS (sabotage was a no-op; discarded, documented here)   | Yes                                                                                                        |
| 06-live-pipeline-and-diff (attempt B)          | Replaced backend fake's RESULT block with plain text (task fails `no-block`, no diff lands)                                                                          | FAIL exit 1 (seeded server refuses to start, check fails) | Yes, tree clean. Precise UI-level red proof exists in builder/QA logs (parseUnified short-circuit → +0/-0) |
| 03-auth-and-roles-ui                           | Changed `ROLE_LABEL` approver→Supervisor in RequireRole.tsx + rebuilt bundle (different from QA's fail-open)                                                         | FAIL exit 1 (badge/tooltip assertion)                     | Yes + clean rebuild, re-run green (verify/restore-03.log)                                                  |
| 02-web-build                                   | Replaced "The Agency" strings in dispatcher/web/index.html (wrong app shell; build itself still succeeds — different from builder's missing-entry)                   | FAIL exit 1 (`dist index.html is not the app shell`)      | Yes + clean rebuild, re-run green (verify/restore-02.log)                                                  |

Checks 07–09 were sabotaged by the independent QA agent (docs/evidence/1e/red-proofs.log: testid rename, alt-less img, expert slice — all exit 1, all restored, final full accept 9/9). Builder red proofs under docs/evidence/1e/red/ each open with a `Sabotage:` line and record a FAIL line (verified `grep -c FAIL` = 1 per file); sabotages are real and matched to their checks.

## Findings

1. (Minor) Where: Step 5 Accept ("user can create mission…") / `dispatcher/web/src/views/Home.tsx:138-179`. What: no Playwright spec or accept check clicks the new-mission form; mission creation is the only Step-5 capability without an automated check. Why it matters: stage-prompt requirement with no acceptance check. Fix: add one creation round-trip to an existing spec (submit objective, assert mission appears). Mitigation observed: the form is wired to `POST /api/missions` (`api.ts:141`), and I proved the endpoint live (201 as approver with `{"id":"m-mv8u1bmn-1","status":"planning"}`, 403 as viewer). Does not break a verdict bullet — capability exists, is wired, and the server side is fail-closed.

No 4.6 violations found:

- Health/ready rendering is computed from API data (`Fleet.tsx:35`, `chips.tsx:14-27`), not hard-coded.
- No fabricated output: `example.com`/canned results absent; `/api/usage` computes from engine state with an explicit 3b-ledger note (`http.ts:675-693`); placeholders (`placeholders.tsx`) honestly state their stage and are the prompt-allowed 3a/3b deferrals.
- No credential defaults; no `process.env` in web src; auth gates are `viewer`/`approver` with 401/403 proven live.
- No new containers; no host-executed task commands in stage scope; no `test.skip`; CI runs `make check` (`.github/workflows/ci.yml`); `tsconfig.json` covers web sources; every new module is imported by non-test code (chips/status/magic/placeholders verified by import grep).

## Claims compared with the tree

- Commit subjects: `0ff90b5 docs(stage-1e):…` and `e0ce9ab feat(web-1e): unified web UI foundation with embedded director chat and playwright suite` — both literally describe their diffs; no "live/verified/complete/all" claims. Clean.
- Built items (Steps 1–6) all exist, are wired (app shell, auth/RequireRole, Fleet Pulse/Quota/Inbox chips, command palette, Inbox/Kanban/Detail views, SSE chat, plan editor, pipeline/graph/diff/logs tabs, fleet grid, 8 e2e spec files + helpers, test-server harness) and are exercised by checks 01–09, except mission-creation click (minor finding above).
- "Not performed: Nothing" is accurate — 9 pass, 0 skip on my run; provider key present but unneeded (fake-expert harness).
- "Not built: Nothing" is accurate — Repos/Queue placeholders and the Stage-5 Alive layer are explicitly out of scope and honestly labeled in-UI.
- Defect-register guards due by 1e (D-07/D-19/D-20 via 1b, D-21/D-24 via 1d, D-03/D-08/D-09/D-10/D-14/D-15/D-17/D-28 via 0, D-01/D-02/D-05/D-12/D-16/D-18/D-31 via 1c): none regressed — this stage touches no compose/fleet/auth-core paths, and `make check` (256 unit tests) is green.

## Fail-closed probes

| Situation                      | Expected                             | Observed                                         |
| ------------------------------ | ------------------------------------ | ------------------------------------------------ |
| POST approve as viewer         | 403                                  | 403                                              |
| PUT plan as viewer             | 403/4xx                              | 403                                              |
| POST /api/missions as viewer   | 403                                  | 403                                              |
| POST /api/missions as approver | 201 + id                             | 201 `{"id":"m-mv8u1bmn-1","status":"planning"}`  |
| GET /api/fleet anonymous       | 401                                  | 401                                              |
| Login with wrong password      | 401, stays logged out                | 401 (API) + e2e invalid-login spec green         |
| Anonymous /api/auth/me         | 401                                  | 401 (asserted by check 02)                       |
| SSE route broken (sabotage)    | check 04 red, no silent poll-masking | FAIL `sse timeout` via raw EventSource assertion |
| Probe servers after kill       | port closed, no residue              | PORT-CLOSED; `git status` clean of code changes  |

## Not verified

- Nothing the verdict depends on. UI-spec §8.6 (60fps profiler) is not asserted by any stage-1e check, but the stage prompt does not require it (its Step 6 list is exhaustive without perf); left for Stage 5. Cosmetic-only deviations (Radix-direct vs shadcn/ui wrapper, bespoke diff viewer vs Monaco, CSS-keyframe Magic UI vs Framer Motion) meet every behavioral requirement and are documented as proposed corrections.

## Notes

- The seeded-server harness serves `dispatcher/dist/web` (gitignored build output), so web-source sabotages require a rebuild to take effect — QA's red-proofs.log documents this; my 02/03 sabotages confirm it. This is a harness property, not a violation.
- First 06 sabotage attempt was a no-op (single-task mission auto-approved); reported as invalid rather than counted. The valid 06 red is coarse (server refuses to start); precise UI-level red exists in builder/QA proofs.
- Starting state: branch `stage-1e-web-ui`, commit `0ff90b5` on top of `24085ad`; Bun 1.4.2, Docker 29.9.0, OpenCode v2.0.29; provider key present (value never recorded); fleet containers running (several experts `unhealthy`, unrelated to this stage's offline harness).
