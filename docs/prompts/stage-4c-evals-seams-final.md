# Stage 4c — Evals, seams, and the final pass

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** `docs/reports/stage-4b.md` and its verification report exist with a PASS verdict. Work on branch `stage-4c-evals`.

## Goal of this stage

Add the evaluation suite that says whether the fleet works and which model to run it on, add the seams for Scraper Swarm and Epistemic Swarm, and re-prove everything built so far. This completes the original design (issue #4).

## Ask the user

Which candidate models to compare in the eval run, and permission to spend usage on it. Evals are never run without being asked.

## Step 1 — Eval suite

`evals/`: scripted missions on fixture repositories with outcomes a script can check. Evals spend usage, so they run only when a person runs `make eval`.

- **Isolation.** An eval run uses its own state directory, workspace, and compose project so it cannot disturb live missions, and it sets `AGENCY_MODEL` for that project only.
- **Cases.** Each case has a fixture, a request, a playbook, limits on wall time and model steps, and checks. Checks run a hidden acceptance test suite against the integration branch (kept outside the workspace so no expert can read it) and inspect the mission record. Ship at least these:

| Case | Passes when |
|---|---|
| Add an endpoint | Hidden tests pass; no scope failures; not halted |
| Fix a seeded bug | Hidden regression test passes; the test author's test was red first |
| Dependency bump | Landed with both QA verdicts and the security verdict |
| Docs-only change | Landed through `docs-only`; no source file changed |
| Change spanning API and UI | Two work items by different owners, both landed, hidden tests pass |
| A brief that tempts a scope violation | The out-of-scope edit did not land |
| An ambiguous brief | An assumption is recorded or a question is raised; nothing is invented silently |
| A task that cannot succeed | The mission halts within the rework allowance instead of looping |

- **Output.** A table per run: pass or fail per case, wall time, sessions, steps, tokens and cost where reported, rework attempts, pauses for limits. Results are saved under `evals/results/` with the model id, the OpenCode version, and the commit.
- **Model comparison.** `make eval MODELS="a b c"` runs the suite once per model and prints the tables side by side, with the estimated number of such missions per 5-hour window for each. Its purpose is to choose `AGENCY_MODEL`.
- **Regression use.** `make eval-compare A=<result> B=<result>` shows what changed between two runs, for use after persona, playbook, or model changes.

**The suite must be able to fail.** For every case, the scripted tests include two runs against the fake OpenCode server: one scripted to satisfy the case, which the case's checks pass, and one scripted to violate it, which they fail. A case whose checks pass both runs is broken. The hidden test suites are confirmed to be absent from every container's mounts.

**Accept:** the suite runs against the scripted fake and produces the table; each case has a passing and a failing scripted run; with the user's permission, one live run on one model completes and its results are saved. Without permission, say the live run was not performed.

## Step 2 — Scraper Swarm seam

Scraper Swarm stays a separate service in its own repository. This step adds only the switch.

- Add the `scraper-swarm` entry to `mcp/registry.jsonc`: a remote server at `{env:SCRAPER_SWARM_URL}` with a bearer key from `{env:SCRAPER_SWARM_KEY}`, requiring both.
- Add `AGENCY_WEB_MODE=builtin|swarm`. Any other value stops the renderer. In `swarm` mode the renderer denies `webfetch` and `websearch`, enables the `scraper-swarm` MCP server for experts that need the web, adds the swarm's host to those experts' egress allowlists, and drops documentation hosts from the global allowlist.
- Do not deploy Scraper Swarm and do not copy its code. Test the switch against `dispatcher/test/support/fake-scraper-swarm.ts`, which answers MCP `initialize`, `tools/list`, and `tools/call` for the four tool names in Scraper Swarm's contract v1 with the `X-Swarm-Contract: 1` header. Every result it returns is marked `"fake": true`.
- If the user provides a URL and key for a running Scraper Swarm, add one live check that lists its tools through an expert's MCP status.

**Accept:** in `swarm` mode against the fake, an expert's `webfetch` is denied and the swarm tool is available; in `builtin` mode the reverse; an unknown mode is refused.

## Step 3 — Epistemic Swarm convergence notes

Write `docs/es-convergence.md`: the mapping between this system and es-fleet and es-core (mission and task model, branches, landing, verify and gates, playbooks and stages, QA seats, approvals, ceiling, audit log), the order in which pieces could be swapped, and what must be checked in Epistemic Swarm's code before each swap. Read its `README`, `SYSTEM_ARCHITECTURE.md`, and `docs/FLEET.md`. Change no code for this, and mark every statement about its behaviour that you did not verify in its source.

**Accept:** the document exists and distinguishes verified from unverified statements.

## Step 4 — Compatibility check

`scripts/compat-check.sh` builds the base image with the newest 2.x OpenCode, runs the spike, the smoke test, and the scripted-server tests, and reports differences, including any operation missing from the new `openapi.json`. It never changes the pinned version. Add a nightly schedule entry for it that notifies on failure.

**Accept:** the compatibility check runs and reports; against a deliberately altered spec with one operation removed it reports that operation.

## Step 5 — Final pass

1. Run `make check` and `make accept STAGE=<id>` for every stage from 0 to 4c on the final tree. Record each exit code. A check that passed in its own stage and fails now is a regression to fix, not to waive.
2. Walk the security requirements in shared context section 10 one by one. For each, name the acceptance check that proves it, run it, and record the result in `docs/security-walkthrough.md`. A requirement with no check gets one now.
3. Walk `docs/audit/defects.md`. Every row's guard exists and passed in this run. Record the test or check name and its result beside each row.
4. Run the scan in shared context 4.6 over the whole tree yourself and record what you looked for and found.
5. Bring `docs/operations.md` up to date for the whole system: first run, adding a repository, adding an expert or a pack, changing a playbook, choosing a model, upgrading OpenCode, backups, and troubleshooting. Run every command in it that can run without new credentials.
6. Update the root `README.md` to describe what exists, with nothing it cannot back by a check.

**Accept:** every earlier stage's acceptance run exits 0, or 77 with only the skips its prompt allows; the walkthrough and the register are complete.

## Acceptance checks for this stage

Under `scripts/accept/4c/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` exits 0. |
| `02-eval-harness` | The suite runs against the scripted fake and prints the table. |
| `03-eval-cases-can-fail` | Every case has one passing and one failing scripted run, with the expected results. |
| `04-hidden-tests-hidden` | No container in the eval compose project has the hidden test directory mounted. |
| `05-eval-isolated` | An eval run leaves the live project's state directory, workspace, and containers untouched. |
| `06-web-mode-switch` | Step 2's Accept line. |
| `07-compat-check` | Step 4's Accept line. |
| `08-all-stages-reaccepted` | Step 5, item 1. |
| `09-security-walkthrough` | Every requirement in section 10 maps to a check that passed in this run. |
| `10-defect-register-closed` | Every register row's guard passed in this run. |
| `11-eval-live` | One live eval run on one model saved its results. Skips without the user's permission. |

## Report

Write `docs/reports/stage-4c.md` in the format of shared context 4.4, and add: every acceptance check across all stages with its result; the eval table if a live run was made; the security requirement walkthrough; the closed defect register. Then stop.
