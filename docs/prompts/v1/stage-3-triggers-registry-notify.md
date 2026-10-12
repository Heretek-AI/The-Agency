# Stage 3 — Repositories, triggers, queueing, and notifications

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** the stage 2 report shows its acceptance checks passed. Read `docs/build-notes.md`. Work on branch `stage-3-service`.

## Goal of this stage

Turn the single-repository fleet into an always-on service: several registered repositories with an approval-based onboarding, missions started by REST calls, GitHub, and schedules as well as chat, a priority queue that respects the provider's usage window, draft pull requests, and notifications and approvals through the dashboard, GitHub comments, and Discord.

## Not in this stage

Extended experts, on-demand start, evals, expert packs (stage 4). Cross-repository missions. Anything listening on a public address.

## Ask the user

- A GitHub token for the bot identity, scoped to the repositories to register (contents, pull requests, and issues: read and write). Only the Dispatcher holds it.
- Optionally a separate read-only GitHub token for experts' `github` MCP server.
- A Discord bot token and the channel to post in.
- The allowlist: GitHub logins and Discord user ids that may trigger and approve.

Without these, build and test everything against the fake servers described below and say in the report that live GitHub and Discord were not exercised.

## Step 1 — Repository registry and onboarding

**Registry layout** under `state/registry/`:

```
allowlist.yaml                 # github logins, discord ids, API clients
<repoId>/repo.yaml             # id, url, defaultBranch, planApprovalAbove, sensitivePaths, docsPaths,
                               # maxConcurrentMissions, triggers: { github: {...}, schedules: [...] }
<repoId>/ownership.yaml
<repoId>/checks.yaml
<repoId>/env.compose.yml
<repoId>/secrets.env
```

**Lifecycle of a repository:** `pending → onboarding → awaiting-approval → active`, or `disabled`.

1. `POST /api/repos { id, url }` (also `make repo-add`) clones it into `/work/<repoId>/repo` with the bot's read access.
2. The Dispatcher runs an internal `onboarding` playbook: the `scout` maps the repository and proposes `ownership.yaml`, starting from each expert's `proposed_writes` and correcting them against the real layout; the `platform` expert reads the repository's scripts, CI files, and compose files and proposes `checks.yaml` and `env.compose.yml`. Experts cannot write the registry, so proposals go to `/artifacts` and the Dispatcher picks them up.
3. The Dispatcher runs the proposed checks on the default branch in a fresh stack. Checks that are already red there cannot gate anything; list them for the human.
4. The dashboard shows the proposals with the baseline results. A human edits and approves. Only then are the files written to the registry and the repository becomes `active`.
5. Any later change to a control file goes through the same proposal and approval. No mission can change the rules it is judged by.

Before each mission the Dispatcher fetches the repository and records the default branch's tip as the mission's base.

**Accept:** registering `fixtures/demo-db-repo` from a local git URL produces proposals, a baseline result, and an approval request; nothing is enforceable until approval; after approval a mission runs against it; a second registered repository runs a mission at the same time without sharing worktrees, stacks, or branches.

## Step 2 — Triggers

All sources end in one internal `createMission({ repo, source, sourceRef, requestedBy, playbook?, text })`. For every source except chat, the Dispatcher creates the Director session itself and gives it the request as quoted data.

| Source | Mechanism |
|---|---|
| Chat | Unchanged: a person talks to the Director, which calls `fleet_mission_create`. |
| REST | `POST /api/missions` with an API token from `allowlist.yaml` (stored hashed, scoped to repositories). |
| Webhook | `POST /api/hooks/<clientId>` with an HMAC signature. For systems inside the private network, such as a CI server reporting a failure. |
| Schedule | Cron expressions in `repo.yaml`, each with a playbook and an objective. Missed runs are not backfilled. |
| GitHub | A poller, described below. |

**GitHub poller.** For each active repository with the GitHub trigger on, poll issues, pull requests, and their comments with conditional requests, staying inside the API's rate limits. There is no inbound webhook.

- A mission starts when an allowlisted account adds the configured label, or comments `/agency [playbook] <request>`.
- Commands from allowlisted accounts on a mission's issue or pull request: `/agency approve`, `/agency reject <reason>`, `/agency answer <text>`, `/agency resume <note>`, `/agency cancel`.
- Everything written by an account that is not on the allowlist is ignored and is never included in any prompt. That includes an issue body written by someone else: the allowlisted person's own comment is the request.
- The fleet posts back: the plan when it needs approval, questions, halts, pauses, and the final report.
- **Draft pull request.** When every work item of a GitHub-triggered or API-triggered mission has landed, the Dispatcher pushes the integration branch to the remote as `agency/<missionId>-<slug>` with the bot token and opens a **draft** pull request against the default branch. The body contains the Director's report and a table of gate results per work item. The Dispatcher never marks it ready, never merges, and never pushes to the default branch. For chat missions the same happens when the person asks for a pull request.
- A `/agency <request>` comment on a pull request the fleet opened starts a follow-up mission based on that branch.

**Accept** (against a fake GitHub API server in tests): an allowlisted label starts a mission; a comment from a non-allowlisted account starts nothing, and a canary string placed in that comment and in a stranger's issue body appears in no session transcript; the plan is posted and `/agency approve` releases it; a draft pull request is opened when the mission is green; the fake server records no call to a merge endpoint and no push to the default branch; a schedule fires at its time; a signed webhook is accepted and an unsigned one refused.

## Step 3 — Queue and the usage window

- **Priority:** chat, then GitHub, then API and webhooks, then schedules. Within a priority, oldest first.
- **Caps:** a global `maxConcurrentMissions` and one per repository.
- **Usage ledger.** Record what each session used (cost if OpenCode reports it for the model, otherwise tokens and requests) in rolling 5-hour, weekly, and monthly windows. The window sizes and caps are configuration, defaulting to OpenCode Go's published limits ($12, $30, $60); they can be turned off for a pay-as-you-go key.
- **Headroom.** A scheduled mission starts only while usage in the current 5-hour window is below a configurable fraction (default one half). Other sources are not held back by the ledger.
- **Limit reached.** The stage 1 pause still applies and is the authority: the provider's refusal pauses everything, and missions resume at the reset time. The ledger only improves the estimate of that time and feeds the headroom rule.
- Show the ledger, the queue, and any pause with its expected end on the dashboard.

**Accept:** with missions queued from all four sources, start order follows the priority; a scheduled mission is deferred when the ledger is above the threshold and starts when it falls below; a simulated limit error pauses every running mission and they resume after the simulated reset.

## Step 4 — Notifications, approvals, and questions

- **Event bus.** The Dispatcher emits mission events: `plan-needs-approval`, `question`, `halted`, `paused`, `resumed`, `stuck`, `done`, `failed`. Each goes to every enabled channel.
- **Dashboard inbox.** Approvals, questions, and halts waiting for a person, with approve, reject, answer, and resume actions.
- **GitHub.** As in step 2, for missions that came from GitHub.
- **Generic webhook.** Outbound events as signed JSON to a configured URL, and a signed inbound callback endpoint for `approve`, `reject`, `answer`, and `resume`. Any chat system can be attached through this.
- **Discord adapter** (`adapters/discord/`). A small separate service that connects out to Discord's gateway (no inbound path), keeps one thread per mission in the configured channel, posts each event, and offers approve and reject buttons and thread replies as answers. It accepts actions only from allowlisted Discord user ids and talks to the Dispatcher only through the generic webhook and callback. It attaches to `outside` and never sees a provider key or the registry.
- **Questions.** When an expert reports `blocked` with a question, the Director answers it if it can. If it cannot, the mission becomes `waiting-human` with the question, and the person's answer goes back to the Director as quoted data.
- **Who approved.** Every approval, rejection, answer, and resume records the channel and the account.

**Accept** (against a fake Discord gateway in tests): each event reaches all enabled channels; approving from the dashboard, from a GitHub comment, and from a Discord button each release a waiting plan; an action from a non-allowlisted Discord user is refused; an unsigned callback is refused.

## Step 5 — Audit, liveness, and operations

- **Audit log.** An append-only record (a table plus a JSONL file under `state/`) of every trigger, approval, decision, gate result, landing, push, and pull request, with who or what caused it.
- **Liveness.** A running task with no events for a configurable time is `stuck`: notify, and after a second interval interrupt it so its failure policy applies. Report paused and halted missions the same way.
- **Backups.** A nightly copy of the Dispatcher's database and the registry into `state/backups/` with a retention count.
- **Retention.** Worktrees, artifacts, and stacks of finished missions are removed after a configurable period; merged task branches stay.
- **`docs/operations.md`:** registering a repository, the allowlist, tokens and where each one lives, reaching the dashboard over a private network such as Tailscale or WireGuard, what to do when the fleet is paused, halted, or stuck, restoring from a backup, and the reminder that nothing may be exposed publicly.

**Accept:** a task made to hang is reported as stuck and then interrupted; a backup can be restored into a fresh Dispatcher that then shows the same missions; the audit log contains the full chain for one mission from trigger to pull request.

## Step 6 — End to end

If the user supplied tokens: on a private test repository, an allowlisted label on an issue leads to a plan comment, an approval by comment, a mission through the `feature` playbook, a draft pull request with the gate table, and a Discord thread that followed it. Otherwise run the same flow against the fake servers.

## Report

Reply with: what was built per step and its commit; every acceptance check with the command and result; which checks ran against fake servers and which against live services; deviations and why; anything not tested, stated as not tested.
