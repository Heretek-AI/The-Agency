# Stage 3a — Repositories, onboarding, triggers, and draft pull requests

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** `docs/reports/stage-2b.md` and its verification report exist with a PASS verdict. Read `docs/build-notes.md`. Work on branch `stage-3a-registry`.

## Goal of this stage

Turn the single-repository fleet into one that serves several registered repositories, each admitted through an approval-based onboarding, and that starts missions from REST calls, signed webhooks, schedules, and GitHub as well as chat, ending in draft pull requests.

## Not in this stage

The priority queue, the usage ledger, notifications, Discord, liveness, backups (Stage 3b). Until then missions start in arrival order under the Stage 1 concurrency cap. Extended experts, evals, packs (stage 4). Cross-repository missions. Anything listening on a public address.

## Ask the user

- A GitHub token for the bot identity, scoped to the repositories to register (contents, pull requests, and issues: read and write). Only the Dispatcher holds it.
- Optionally a separate read-only GitHub token for experts' `github` MCP server.
- The allowlist: GitHub logins and API clients that may trigger and approve.

Without these, build and test everything against the fake server described below and say in the report that live GitHub was not exercised.

## Step 1 — Repository registry and onboarding

**Registry layout** under `state/registry/`:

```
allowlist.yaml                 # github logins, discord ids, API clients
<repoId>/repo.yaml             # id, url, defaultBranch, planApprovalAbove, testCheck, sensitivePaths, docsPaths,
                               # maxConcurrentMissions, triggers: { github: {...}, schedules: [...] }
<repoId>/ownership.yaml
<repoId>/checks.yaml
<repoId>/env.compose.yml
<repoId>/secrets.env
```

Extend `dispatcher/src/registry-schema.ts` to cover every file. `dispatcher/src/registry.ts` is the only module that reads or writes the registry.

**Lifecycle of a repository:** `pending → onboarding → awaiting-approval → active`, or `disabled`.

1. `POST /api/repos { id, url }` (also `make repo-add`) clones it into `/work/<repoId>/repo` with the bot's read access.
2. The Dispatcher runs an internal `onboarding` playbook: the `scout` maps the repository and proposes `ownership.yaml`, starting from each expert's `proposed_writes` and correcting them against the real layout; the `platform` expert reads the repository's scripts, CI files, and compose files and proposes `checks.yaml` and `env.compose.yml`. Experts cannot write the registry, so proposals go to `/artifacts` and the Dispatcher picks them up and validates them against the schemas.
3. The Dispatcher runs the proposed checks on the default branch in a fresh stack. Checks that are already red there cannot gate anything; list them for the human.
4. The dashboard shows the proposals with the baseline results. A human edits and approves. Only then are the files written to the registry and the repository becomes `active`.
5. Any later change to a control file goes through the same proposal and approval. No mission can change the rules it is judged by.

A repository cannot become `active` unless its approved `checks.yaml` has at least one check that is green on the default branch. Approving an empty or all-red check list is refused with the reason.

Before each mission the Dispatcher fetches the repository and records the default branch's tip as the mission's `baseSha`.

Tests with the fake OpenCode server: the lifecycle transitions; an invalid proposal is rejected and the repository stays in `onboarding`; nothing is enforceable before approval; approval with no green check is refused; a control-file change after activation needs a new approval.

**Accept:** registering `fixtures/demo-db-repo` from a local git URL produces proposals, a baseline result, and an approval request; nothing is enforceable until approval; after approval a mission runs against it; a second registered repository runs a mission at the same time without sharing worktrees, stacks, or branches.

## Step 2 — Triggers

All sources end in one internal `createMission({ repo, source, sourceRef, requestedBy, playbook?, text })`. For every source except chat, the Dispatcher creates the Director session itself and gives it the request as quoted data.

**Untrusted text.** One function, `quoteUntrusted(text, source)` in `dispatcher/src/untrusted.ts`, wraps every piece of text that came from a person through GitHub, the API, a webhook, or a schedule definition before it enters any prompt. It marks the text as data, names its source, and neutralizes anything that could close the wrapper. No trigger builds prompt text any other way.

| Source | Mechanism |
|---|---|
| Chat | Unchanged: a person talks to the Director, which calls `fleet_mission_create`. |
| REST | `POST /api/missions` with an API token from `allowlist.yaml` (stored hashed, scoped to repositories). |
| Webhook | `POST /api/hooks/<clientId>` with an HMAC signature over the raw body, compared in constant time. For systems inside the private network, such as a CI server reporting a failure. |
| Schedule | Cron expressions in `repo.yaml`, each with a playbook and an objective. Missed runs are not backfilled. The scheduler takes its time from the injected clock. |
| GitHub | A poller, described below. |

**GitHub poller.** `dispatcher/src/github.ts` is the only module that knows the GitHub API. For each active repository with the GitHub trigger on, poll issues, pull requests, and their comments with conditional requests, staying inside the API's rate limits. There is no inbound webhook.

- A mission starts when an allowlisted account adds the configured label, or comments `/agency [playbook] <request>`.
- Commands from allowlisted accounts on a mission's issue or pull request: `/agency approve`, `/agency reject <reason>`, `/agency answer <text>`, `/agency resume <note>`, `/agency cancel`.
- Everything written by an account that is not on the allowlist is ignored and is never included in any prompt. That includes an issue body written by someone else: the allowlisted person's own comment is the request.
- The fleet posts back: the plan when it needs approval, questions, halts, pauses, and the final report.
- **Draft pull request.** When every work item of a GitHub-triggered or API-triggered mission has landed, the Dispatcher pushes the integration branch to the remote as `agency/<missionId>-<slug>` with the bot token and opens a **draft** pull request against the default branch. The body contains the Director's report, a table of gate results per work item with the SHA each applies to, and the audit log's tip hash. The Dispatcher never marks it ready, never merges, and never pushes to the default branch. For chat missions the same happens when the person asks for a pull request.
- A `/agency <request>` comment on a pull request the fleet opened starts a follow-up mission based on that branch.
- The bot token reaches git through a credential helper fed from the environment. It never appears in a remote URL, a log line, an audit entry, or an error message.

**Fake GitHub.** `dispatcher/test/support/fake-github.ts` implements the endpoints `github.ts` uses, with conditional-request and rate-limit headers, and records every call. A git remote backed by a bare repository stands in for pushes.

Tests against the fakes: an allowlisted label starts a mission; an allowlisted `/agency` comment starts one with the named playbook; a comment from a non-allowlisted account starts nothing; a canary string placed in that comment and in a stranger's issue body appears in no recorded prompt; the plan is posted and `/agency approve` releases it; a draft pull request is opened when the mission is green, with the gate table and audit tip in its body; the fake records no call to a merge endpoint, no "ready for review" call, and no push to the default branch; a schedule fires at its time on the injected clock and a missed one is not backfilled; a signed webhook is accepted; an unsigned one, a wrongly signed one, and one for an unknown client are refused; an API token for repository A cannot start a mission on repository B; the bot token appears in no log, audit entry, or recorded request header other than `Authorization` to the fake.

**Accept:** the tests pass.

## Step 3 — Live GitHub, if tokens were supplied

On a private test repository the user names: an allowlisted label on an issue leads to a plan comment, an approval by comment, a mission through the `feature` playbook, and a draft pull request with the gate table. Afterwards confirm through the API that the pull request is a draft, that nothing was merged, and that the default branch did not move.

**Accept:** the run completes; or, without tokens, it is reported as not performed.

## Acceptance checks for this stage

Under `scripts/accept/3a/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` exits 0. |
| `02-trigger-tests` | Every test named in step 2 exists and passed. |
| `03-onboarding-live` | Step 1's Accept line, on the running fleet. Skips only without a provider key. |
| `04-two-repos-isolated` | Two active repositories run missions at once with disjoint worktrees, stacks, and branches. Skips only without a provider key. |
| `05-untrusted-single-path` | Every call site that puts trigger text into a prompt goes through `quoteUntrusted` (grep on the trigger modules plus the canary test). |
| `06-registry-not-in-experts` | No expert container has the registry mounted; an onboarding expert's attempt to write a registry path fails. |
| `07-no-merge-capability` | `github.ts` contains no merge, "ready for review", or default-branch push call, and the fake recorded none across the whole test run. |
| `08-token-confined` | The bot token's value appears in no log, audit entry, artifact, or expert environment. |
| `09-live-github` | Step 3. Skips without a GitHub token. |

Red proofs worth the effort: add a non-allowlisted login to the allowlist and watch the canary test fail; sign a webhook with the wrong secret; approve a repository whose checks are all red.

## Report

Write `docs/reports/stage-3a.md` in the format of shared context 4.4. State which checks ran against fake servers and which against live services. Then stop.
