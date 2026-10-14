# Stage 1d — verification

Commit: ac5fa3c74968cbb4e90291b2e695c0f2499a7656 Branch: stage-1d-service Date: 2026-10-14 UTC Verifier: Muse Spark 1.3 (drift reviewer)

VERDICT: PASS

## Summary

The stage holds. From a clean state I re-ran `make check` (exit 0, 253 pass / 0 fail), `make down` / `make up` (both exit 0), and `make accept STAGE=1d`: 8 pass, 8 skip, 0 fail — a table identical to the builder's final run and QA's independent run, with skips only where the stage prompt allows them (06–10, 12–14, no provider key). I read all 16 acceptance scripts plus `rest.inc`: each is fail-closed, with no `|| true`, catch-and-warn, fallback, or unallowed SKIP on any judged command (the two `|| true` occurrences guard `pipefail` on parsing greps followed by explicit `fail`). Five independent sabotage samples (03, 04, 05, 11, 15), each different from builder/QA sabotage, all went red (exit 1) and came back green after byte-verified restores. The QA-incident residue is gone: HEAD does not touch `docker-compose.yml`, no `19998` remains anywhere, and the running verifier publishes nothing. The gateway fixes (`cap_add NET_BIND_SERVICE`, dual-homed gateway, `DISPATCHER_HOSTNAME=0.0.0.0`, `shutdownService`) are real code with tests. One minor finding: the report misdescribes the builder's own 04 red proof (the substantive proof exists in QA evidence and my S5, so the red-proof requirement itself is met).

## Starting state

- Branch `stage-1d-service`, HEAD `ac5fa3c74968cbb4e90291b2e695c0f2499a7656` (the post-incident amended HEAD).
- `git status --short`: clean at start; clean at end (only my 4 allowed untracked files under `docs/evidence/1d/verify/`).
- Bun 1.4.2, Docker 29.9.0, Compose 5.6.0, OpenCode v2.0.29 (binary present, used only by live-test skip logic).
- Provider key: ABSENT (`.env.provider` holds the documented `disabled-no-key` marker; grep count 1). Live checks 06–14 correctly skip.
- Running at start: all 16 fleet containers healthy (`agency-director/scout/architect/product/frontend/backend/dba/platform/security/qa/reviewer/docs/egress/verifier/dispatcher/gateway`), plus unrelated host stacks (deploy-\*, vtt-postgres) that check 03 correctly ignores (it scopes to `docker compose ps`).

## Claims

| Claim (source)                                                                             | Where evidence should be                                           | Found                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 MCP tools, tests pass                                                                   | `dispatcher/src/mcp.ts`, `dispatcher/test/mcp.test.ts`, make check | EXISTS, WIRED (`http.ts:16` imports `handleMcpHttp`), unit tests green in my `make check`                                                                                                                      |
| S2 REST/SSE/auth/chat proxy, tests pass, Dispatcher healthy                                | `dispatcher/src/{auth,http,main}.ts`, checks 02/04/05              | EXISTS, WIRED (`main.ts` imports auth/director/http), checks PASS in my run                                                                                                                                    |
| S3 Director session/wake-ups, persona, 5 skills; Accept check 06                           | `dispatcher/src/director.ts`, `experts/director/...`, check 06     | EXISTS (all 8 persona sections; every skill names `fleet_*` tools); 06 SKIP, allowed                                                                                                                           |
| S4 gateway routing, loopback-only publish, make targets; Accept healthz + director UI      | `gateway/Caddyfile`, `scripts/render.ts`, check 02                 | EXISTS; check 02 PASS in my run (healthz `"ok":true` via `agency.localhost`, director `/api/info` 200)                                                                                                         |
| S5 live checks 07–12 through REST with real key                                            | `scripts/accept/1d/07–12`, `rest.inc`                              | IMPLEMENTED, fail-closed (read each); 11 PASS without key; rest SKIP, allowed                                                                                                                                  |
| S6 e2e, `make e2e` exit 0 with real key                                                    | `scripts/e2e.sh`, check 13                                         | EXISTS; 13 SKIP via `e2e: SKIP` marker mapping, allowed                                                                                                                                                        |
| 01-make-check                                                                              | accept log                                                         | PASS (builder, QA, mine)                                                                                                                                                                                       |
| 02-up-healthy                                                                              | accept log                                                         | PASS (builder, QA, mine)                                                                                                                                                                                       |
| 03-only-gateway-published                                                                  | accept log                                                         | PASS (builder, QA, mine); fix verified (see incident)                                                                                                                                                          |
| 04-credentials-required                                                                    | accept log                                                         | PASS (builder, QA, mine); real gate re-proved (S5)                                                                                                                                                             |
| 05-auth-and-roles                                                                          | accept log                                                         | PASS (builder, QA, mine)                                                                                                                                                                                       |
| 06-director-scout                                                                          | accept log                                                         | SKIP no key (all three runs); allowed                                                                                                                                                                          |
| 07-scout-completes                                                                         | accept log                                                         | SKIP no key (all three); allowed                                                                                                                                                                               |
| 08-docs-lands                                                                              | accept log                                                         | SKIP no key (all three); allowed                                                                                                                                                                               |
| 09-linter-break-fails-verify                                                               | accept log                                                         | SKIP no key (all three); allowed                                                                                                                                                                               |
| 10-joint-breakage-resets                                                                   | accept log                                                         | SKIP no key (all three); allowed                                                                                                                                                                               |
| 11-scope-refusal                                                                           | accept log                                                         | PASS (all three; needs no model)                                                                                                                                                                               |
| 12-restart-collects                                                                        | accept log                                                         | SKIP no key (all three); allowed                                                                                                                                                                               |
| 13-e2e                                                                                     | accept log                                                         | SKIP no key (all three); allowed                                                                                                                                                                               |
| 14-director-chat-proxy                                                                     | accept log                                                         | SKIP no key (all three); allowed                                                                                                                                                                               |
| 15-audit-chain                                                                             | accept log                                                         | PASS (all three)                                                                                                                                                                                               |
| 16-stage-1-register                                                                        | accept log                                                         | PASS (all three)                                                                                                                                                                                               |
| Built: engine additions (`listMissionIds`, `updatePlan`, `shutdownService`, …)             | `dispatcher/src/engine.ts`, `main.ts`                              | EXISTS; `shutdownService` + `updatePlan` guard covered by unit red proofs                                                                                                                                      |
| Built: `POST /api/tasks/:id/decide`, `fleet_wait` semantics, Host-header clients           | `http.ts`, `mcp.ts`, `rest.inc`                                    | EXISTS (deviations 3, 4, 7, openly recorded)                                                                                                                                                                   |
| Guards D-01,02,03,05,06,07,08,09,10,11(1c),12,14,15,16,17,18,19,20,21,22,24,25,28,29,30,31 | check 16 + unit tests                                              | All run inside check 16, PASS in my run (24 `run_guard` names incl. D-24 credential test, D-31 newest-first test; static 1c/03, 1c/04, 1c/09, 0/07, 0/06; D-07 compose probe; D-19/20/21 binding+health probe) |
| Guards D-04, D-13, D-26 (stage 2a/4b)                                                      | —                                                                  | NOT DUE this stage; correctly absent from check 16                                                                                                                                                             |

## Checks

| Check                        | Builder | Verifier | Evidence                                                                          |
| ---------------------------- | ------- | -------- | --------------------------------------------------------------------------------- |
| 01-make-check                | PASS    | PASS     | `docs/evidence/1d/verify/verify-drift-make-check.log` (EXIT:0, 253 pass / 0 fail) |
| 02-up-healthy                | PASS    | PASS     | `docs/evidence/1d/verify/verify-drift-accept-20261014T215935Z.log`                |
| 03-only-gateway-published    | PASS    | PASS     | same log; verifier `{}` / gateway `127.0.0.1:8081` confirmed live                 |
| 04-credentials-required      | PASS    | PASS     | same log + S5                                                                     |
| 05-auth-and-roles            | PASS    | PASS     | same log + S2                                                                     |
| 06-director-scout            | SKIP    | SKIP     | same log (no provider key; allowed)                                               |
| 07-scout-completes           | SKIP    | SKIP     | same log (allowed)                                                                |
| 08-docs-lands                | SKIP    | SKIP     | same log (allowed)                                                                |
| 09-linter-break-fails-verify | SKIP    | SKIP     | same log (allowed)                                                                |
| 10-joint-breakage-resets     | SKIP    | SKIP     | same log (allowed)                                                                |
| 11-scope-refusal             | PASS    | PASS     | same log + S3                                                                     |
| 12-restart-collects          | SKIP    | SKIP     | same log (allowed)                                                                |
| 13-e2e                       | SKIP    | SKIP     | same log (allowed)                                                                |
| 14-director-chat-proxy       | SKIP    | SKIP     | same log (allowed)                                                                |
| 15-audit-chain               | PASS    | PASS     | same log + S4                                                                     |
| 16-stage-1-register          | PASS    | PASS     | same log                                                                          |

My accept table is byte-for-byte the same result as the builder's `accept-20261014T214839Z.log` and QA's `verify-qa-accept-20261014T214819Z.log` (8 pass / 8 skip / 0 fail). My run's canonical log was moved to `docs/evidence/1d/verify/verify-drift-accept-20261014T215935Z.log` to keep tracked dirs clean; full output in `verify-drift-accept.log`. (`make accept` surfaces the harness's 77 as `Error 77`; per 4.3 the harness result is 8/8/0 → exit 77 with only allowed skips.)

## Sabotage sample

Full per-step log: `docs/evidence/1d/verify/verify-drift-sabotage.log`. Builder red proofs (`docs/evidence/1d/red/`) reviewed: 01, 02, 03, 05, 11, 15, 16 and both unit proofs are real, correctly targeted sabotage with green re-confirmation. QA proofs (`red-proofs-qa.log`) likewise real, including the 39da70b incident note. Exception: builder's own 04 log (see Finding 1).

| Check | What I broke (different from builder/QA)                                                                                 | Result                                                                                                     | Restored                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 03    | `ports: 127.0.0.1:19997:8080` on **dispatcher** (not verifier:19998) + recreate                                          | FAIL naming `/agency-dispatcher(...19997...)`, exit 1                                                      | compose restored md5 `b47d09…`, binding `{}` after recreate, PASS exit 0                                             |
| 05    | `docker stop agency-verifier` (not ROLE_RANK demotion)                                                                   | FAIL `agency-verifier is not healthy`, exit 1                                                              | started, waited healthy, PASS exit 0                                                                                 |
| 11    | docs writes `[]` in ignored `ownership.yaml` + restart (not grant widening)                                              | dispatcher refuses startup (`invalid ownership.yaml…at least 1 element`); check FAIL `not healthy`, exit 1 | backup restored md5 `db58c2…`, healthy, PASS exit 0                                                                  |
| 15    | byte-flip of middle entry (line 26/50), dispatcher left running (not appended line + stopped dispatcher)                 | FAIL `audit log holds a malformed entry`, exit 1                                                           | backup restored md5 `1031d7…`, PASS exit 0 (50 entries verified)                                                     |
| 04    | `dispatcherCredentials()` FLEET_MCP_TOKEN via `optionalEnv` default + rebuilt image (real gate; builder log lacked this) | FAIL `FLEET_MCP_TOKEN: exit 1 without naming the variable`, exit 1                                         | source restored md5 `d6bb42…`, image rebuilt, PASS exit 0; running dispatcher recreated from restored image, healthy |

## Findings

1. **Report misdescribes the builder's 04 red proof (minor).**
   - Where: `docs/reports/stage-1d.md` §3 bullet `04-credentials-required` vs `docs/evidence/1d/red/04-credentials-required.log` (2 lines).
   - What: the report claims the sabotage was an `optionalEnv` default in `dispatcherCredentials()` (with a story about a first incomplete attempt on `fleetMcpToken()`); the log's first line records a different, weaker sabotage — "pointed the check at agency-base:2.0.26" — which breaks the harness's image selection rather than the credential gate, and the log records no restore step.
   - Why it matters: 4.1.1 requires a recorded run breaking the _condition_; the builder's own 04 log does not show the gate broken. The requirement is nevertheless met: QA's `red-proofs-qa.log` §04 proves the real gate (optionalEnv default + rebuild → exit 1), and my S5 re-proved it on this HEAD.
   - Fix: amend the report bullet to describe what `red/04-credentials-required.log` actually records, and cite `docs/evidence/1d/verify/red-proofs-qa.log` §04 plus my S5 as the gate-breaking proofs (or replace the log with a real-gate run). Does not block PASS; the substantive proof exists twice.

## Claims compared with the tree

- Commit subjects (`ac5fa3c` back through `f71f89c`): each diff contains what its subject says; no `live`/`verified`/`complete`/`all` overclaims. `f101342` (prompts sync) is on `main`, not this branch's work.
- Every Built item exists and is wired: `mcp.ts` ← `http.ts:16`; `auth.ts`/`director.ts` ← `http.ts:11–12`, `main.ts:2,12,14`; `http.ts` ← `main.ts:14`; `director.ts:101`, `http.ts:488` call `client.prompt` through `opencode.ts` (no raw `/api/session` paths outside `opencode.ts` — the refined 1c/04 guard passes). Nothing new is test-only; "Not built: nothing" is accurate.
- "Not performed" lists exactly the 8 allowed skips (06–10, 12–14); check 11 running without a key is stronger than required and correctly recorded as deviation 5.
- QA incident: confirmed fixed — HEAD `ac5fa3c` touches only docs/reports/evidence (6 files, no compose), `grep 19998` is clean across `docker-compose.yml` and `scripts/`, running verifier publishes `{}`.
- Gateway fixes are real: `render.ts:548` `cap_add: [NET_BIND_SERVICE]` (with `cap_drop: [ALL]` kept), `render.ts:453,540` dual-homed gateway, `render.ts:480` `DISPATCHER_HOSTNAME=0.0.0.0` with `config.ts:175` refusing empty, `main.ts:169` exported `shutdownService` with 3 unit tests. No stubs.

## Fail-closed probes

| Situation                                       | Expected                      | Observed                                                                                             |
| ----------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Dispatcher credential unset (each of 15)        | exit non-zero naming variable | 04 PASS; S5: defaulted build exits 1 without naming → check FAILs (gate real)                        |
| Empty writes grant in ownership.yaml            | refuse, no silent default     | refuses startup: `invalid ownership.yaml…at least 1 element(s)` (S3)                                 |
| Verifier unreachable                            | check fails, no pass          | 05 prerequisite FAIL (S2); no fallback values in `rest.inc`                                          |
| Audit log tampered (append or mid-file flip)    | verification fails            | 15 FAIL both ways (builder log + S4)                                                                 |
| Empty check list                                | `no-checks`, never success    | 16 guards (`empty check list is an error`, `no-checks`, `checks.yaml rejects empty`) PASS            |
| Wrong-role mutation                             | 403, and GC admin-only        | 05 asserts 401/403/200 matrix incl. approver-GC 403, anon-GC 401, PASS                               |
| Out-of-grant plan                               | refused naming grant          | 11 asserts refusal matches `outside`, PASS; widened-grant sabotage accepted → FAIL (builder/QA logs) |
| Live-test binary/key absent                     | skip-as-failure, never pass   | `opencode.live.test.ts:39-40` throws `SKIP-as-failure`                                               |
| Task/command on host or in Dispatcher container | none                          | only `spawn` is `util/exec.ts:66` (verifier path); no `docker run/exec` in `dispatcher/src`          |

## Not verified

- Checks 06, 07, 08, 09, 10, 12, 13, 14: not runnable here — no provider key (same absence as builder and QA; skips explicitly allowed by the stage prompt). Their scripts were read and are fail-closed; none ran green in this environment, so no red proofs are possible for them by anyone here. A keyed re-run of 06–14 remains the one live gap.
- `make e2e` beyond its `SKIP` marker path: same reason.

## Notes

- `engine.live.test.ts:116,166` early-returns on `ENGINE_LIVE_SCOPE` are an env-controlled test matrix (default `"both"` runs everything), not absence-driven skips; pre-existing, not introduced in 1d.
- Check 05's ephemeral `agency-dispatcher-test` has `--name` and trap cleanup but no resource limits: justified test-scaffolding exception (removed on exit; 4.6/D-07 target composed task services, which all carry limits, `cap_drop: [ALL]`, `:z`).
- Builder deviation 6 (concurrent sessions in one worktree) is self-disclosed; my from-clean re-runs show no contamination.
- `process.env` occurs only in `config.ts` (lint-enforced); `optionalEnv` defaults apply solely to non-credentials (port/hostname/paths; empty hostname refuses). CI runs `make check`. No hard-coded verdicts/health; `probeHealth` returns `healthy` only after `client.info()` succeeds.
