# Stage 0 report — Migrate and salvage

## 1. Built

- Step 0, preflight (`7004f9f` and below): branch `stage-0-salvage`; `SALVAGE_SRC=/home/john/Projects/Heretek-AI-opencode/rebuild_staging/` verified at `14f297a`; `docs/build-notes.md` "Preflight" records Bun 1.4.2, git 2.56.0, Docker 29.9.0, SELinux Enforcing, opencode 2.0.27 on PATH (pin 2.0.26).
- Step 1, scaffolding (`7004f9f`): `.gitignore`, `LICENSE` (Apache-2.0, Heretek-AI), 10-line `README.md`, `versions.env` (BUN 1.4.2, OPENCODE 2.0.26, typescript 5.9.2, oxlint 1.87.0, prettier 3.6.2, @types/bun 1.4.3, zod 3.25.76), `.env.example`, root + `dispatcher`/`verifier` `package.json` with `bun.lock`, `tsconfig.json` (strict, noUncheckedIndexedAccess, Bundler, noEmit), `.oxlintrc.json` (unused vars/imports/params are errors), `.prettierrc`/`.prettierignore`, `Makefile` (`check` in 9.13 order plus `accept`; stubs exit 1), `scripts/check-ts-coverage.ts`, `scripts/check-no-skips.sh`, `.github/workflows/ci.yml` (checkout, Bun 1.4.2, frozen install, `make check`, nothing else), build-notes skeleton, `docs/reports/.gitkeep`, `docs/evidence/.gitkeep`. Five `make check` red runs recorded.
- Step 2, acceptance harness (`7004f9f`): `scripts/accept/lib.sh`, `scripts/accept.sh` (0/1/77 contract, timeout, table, evidence log), 8 harness unit tests in `scripts/accept/test/accept.test.ts`, `scripts/accept/selftest/` fixtures (exit 77).
- Step 3, defect register (`c2f41ea`): `docs/audit/defects.md` rows D-01..D-30 with audit locations, dispositions, guards, stages.
- Step 4, utilities (`c2f41ea`): `dispatcher/src/util/hash.ts`, `redact.ts` unchanged; `exec.ts` fixed (explicit env, process-group kill, 124/timeout, 127/missing); `dispatcher/src/config.ts` owns `process.env` (`baseEnv` returns PATH+LANG only). Red evidence for both defect tests.
- Step 5, audit log (`c2f41ea`): `dispatcher/src/audit.ts` (lock file, O_APPEND+fsync, OR-divergence via anchor, torn-tail fail-closed), `scripts/audit-repair.ts`. Red evidence for D-14/D-15.
- Step 6, model and graph (`c2f41ea`): `dispatcher/src/model.ts` (9.3 Zod schemas, sole owner of status lists), `dispatcher/src/graph.ts` (validation, deterministic topo order, no scheduler helpers).
- Step 7, worktrees (`c2f41ea`): `dispatcher/src/worktrees.ts` (`allocate`/`release`/`salvage`/`inspect`, retry keeps the branch, base-supplied creates, salvage anchors then deletes, slug validation, `AllocationRegistry` hook). Red evidence for D-10.
- Step 8, check runner (`c2f41ea`): `verifier/src/run-checks.ts` (no defaults, `NoChecksError`, setup reason, all checks reported, artifact logs, explicit env). Red evidence for D-03.
- Step 9, protocol (`c2f41ea`): `dispatcher/src/protocol.ts` (one RESULT/VERDICT schema, last heading wins, raw always kept, consistency rules). Red evidence for D-18.
- Step 10, client and fake (`1292068`): `dispatcher/src/opencode.ts` (`OpenCodeClient`, full session ops, `info`, `createSession` body, method/path/status errors), `dispatcher/test/support/fake-opencode.ts` (Basic auth, `{data}` wrap, 7 script step types with real git effects, blocking wait, real diff, SSE, recording, openapi self-check), `dispatcher/test/support/git.ts`, `dispatcher/test/live/opencode.live.test.ts` (passes live against 2.0.27, 8.3 s).
- Step 11, guards and handoff (this commit): `scripts/accept/0/06-no-donor-code.sh`, `docs/handoff/heretek-opencode-archive.md`, salvage table in `docs/build-notes.md`, checks `01`–`10`.
- This report (this commit): `docs/reports/stage-0.md`.

## 2. Acceptance

| Check                     | Result | Evidence                                    |
| ------------------------- | ------ | ------------------------------------------- |
| 0/01-make-check           | PASS   | docs/evidence/0/accept-20261013T014011Z.log |
| 0/02-ts-coverage          | PASS   | docs/evidence/0/accept-20261013T014011Z.log |
| 0/03-harness-selftest     | PASS   | docs/evidence/0/accept-20261013T014011Z.log |
| 0/04-defect-register      | PASS   | docs/evidence/0/accept-20261013T014011Z.log |
| 0/05-salvage-provenance   | PASS   | docs/evidence/0/accept-20261013T014011Z.log |
| 0/06-no-donor-code        | PASS   | docs/evidence/0/accept-20261013T014011Z.log |
| 0/07-no-skips             | PASS   | docs/evidence/0/accept-20261013T014011Z.log |
| 0/08-fake-matches-openapi | PASS   | docs/evidence/0/accept-20261013T014011Z.log |
| 0/09-opencode-live        | PASS   | docs/evidence/0/accept-20261013T014011Z.log |
| 0/10-ci-runs-make-check   | PASS   | docs/evidence/0/accept-20261013T014011Z.log |

Final run (`bash scripts/accept.sh 0`, exit 0):

```text
CHECKS for stage 0
0/01-make-check              PASS
0/02-ts-coverage             PASS
0/03-harness-selftest        PASS
0/04-defect-register         PASS
0/05-salvage-provenance      PASS
0/06-no-donor-code           PASS
0/07-no-skips                PASS
0/08-fake-matches-openapi    PASS
0/09-opencode-live           PASS
0/10-ci-runs-make-check      PASS
stage 0: 10 pass, 0 skip, 0 fail (10 checks)
log: docs/evidence/0/accept-20261013T014011Z.log
```

`make check` is green (format, lint, typecheck, ts-coverage, render-check, 78 unit tests pass). `bash scripts/accept.sh selftest` exits 77 with 1 pass + 1 skip (log `docs/evidence/selftest/accept-20261013T014011Z.log`).

## 3. Red proofs

Every check has a sabotage run under `docs/evidence/0/red/` (first line states the break; each was restored and re-confirmed green):

- `01-make-check.log`: bogus import in `hash.ts` → make check fails at typecheck.
- `02-ts-coverage.log`: staged `workspace/stray.ts` → coverage fails.
- `03-harness-selftest.log`: always-failing test appended → self-test fails.
- `04-defect-register.log`: row D-30 removed → register fails.
- `05-salvage-provenance.log`: `SALVAGE_SRC=/tmp` → provenance fails.
- `06-no-donor-code.log`: staged `evil.patch` → guard fails.
- `07-no-skips.log`: `test.skip` appended → no-skips fails.
- `08-fake-matches-openapi.log`: fake route renamed to `/api/INFOES` → self-check fails.
- `09-opencode-live.log`: `OPENCODE_BIN=/bin/false` → live test fails.
- `10-ci-runs-make-check.log`: `make check` line removed from CI → check fails.
- `make-check-{format,lint,typecheck,ts-coverage,no-skips}.log`: the five Step-1 red runs.
- Defect reds on unchanged salvaged code: `exec-defects.log` (D-08/D-09), `audit-divergence.log` (D-14, `&&` reports no divergence), `audit-rewrite.log` (D-15, no lock + rewrite destroys bytes), `worktrees-retry.log` (D-10, reset + detach), `run-checks-empty.log` (D-03, empty list returns `[]`), `protocol-schemas.log` (D-18, neither schema accepts the 9.8 shape).

## 4. Not performed

None. Every check ran to a verdict. Check 09 passed live (an `opencode` 2.0.27 binary is installed, so no skip was taken); the skip path (exit 77 without a binary) is unit-proven by the harness tests and by `require_cmd --optional` in check 09.

## 5. Not built

Per the stage brief the salvaged modules are libraries with no caller yet. Not wired, with the wiring stage from the salvage map:

- `dispatcher/src/util/hash.ts`, `util/redact.ts`, `util/exec.ts`, `config.ts` — wired into worktrees/run-checks/audit where needed; fleet-wide use in 1c.
- `dispatcher/src/audit.ts` — not wired; Dispatcher startup verification and transition logging in 1c.
- `dispatcher/src/model.ts`, `graph.ts` — not wired; scheduler and store in 1c (`graph` finished 0/1c).
- `dispatcher/src/worktrees.ts` — not wired; expert runner and landing in 1c (allocation register backed by the store).
- `verifier/src/run-checks.ts` — not wired; landing gate in 1c.
- `dispatcher/src/protocol.ts` — not wired; expert runner follow-ups in 1c, judges in 2a.
- `dispatcher/src/opencode.ts` — not wired; expert runner in 1c (permission/env/SSE operations extended there).
- `dispatcher/test/support/fake-opencode.ts` — test-only; first consumer is the 1c engine suite.
- Everything in "Not in this stage" (images, roster, renderer, services, playbooks, packs) is untouched.

## 6. Deviations

- `.prettierignore` also covers pre-existing prose (`docs/prompts/*.md`, `docs/research/`, `LAUNCH_WAVE_SWARM.md`, `swarm_prompts/`): running `prettier --write` over the frozen spec docs would churn contracts this stage does not own. Every file authored in this or later stages stays covered.
- `make accept` cannot exit 77: GNU make normalizes any failing recipe to exit 2 (verified). The 0/1/77 contract lives in `scripts/accept.sh` (proven by the unit tests and the selftest run, exit 77); `make accept` exits 0 iff `accept.sh` exits 0.
- `render-check` passes vacuously with an explicit message (nothing to render until 1b); every other `make` stub for unbuilt targets prints `not built until stage X` and exits 1.
- Verifier artifact logs store the full output redacted, not raw: "full" (complete, untruncated) is kept; secrets are not written to disk.
- `salvage()` fails closed while a worktree still uses the branch (release-first order) instead of force-removing it.
- `GET /api/info` is served and parsed unwrapped (verified against the real 2.0.27 server); all session operations keep the `{data}` envelope.

## 7. Proposed corrections

- Shared context 5.2 says JSON responses are wrapped as `{data}`: true for session operations, but `GET /api/info` returns `{version, ...}` unwrapped (verified live, `curl -u opencode:... /api/info`). Note the exception.
- The fake must serve `GET /openapi.json` (the spec file) although that path is not listed among the spec's own 118 paths; the route self-check exempts exactly that route (recorded in build-notes).
- Defect table vs Step 3 text: D-28/D-29 mandate the disposition `fixed`, which is narrower than the three allowed values (`fixed in salvage` / `not carried over` / `guarded`). Kept the mandated wording; suggest accepting `fixed` as shorthand for `fixed in salvage` where the guard is a stage-0 check.

## 8. Next

- Stage 1a needs nothing from the user: the salvage path default resolved and the binary is present. It will need network access to pin and verify the base-image toolchain, and a free host port for `AGENCY_HTTP_PORT`.
- This branch is ready for its `verify-stage.md` pass. After a PASS verdict, a human merges into `main` and archives `heretek-opencode` per `docs/handoff/heretek-opencode-archive.md` (human steps; not run here).
