# Stage 3b — Queue, usage window, notifications, and operations

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** `docs/reports/stage-3a.md` and its verification report exist with a PASS verdict. Read `docs/build-notes.md`, in particular the answers to spike questions 8 and 9. Work on branch `stage-3b-service`.

## Goal of this stage

Make the fleet an always-on service a person can leave running: a priority queue that respects the provider's usage window, notifications and approvals through the dashboard, GitHub comments, and Discord, and the operational basics of liveness, backups, and retention. This completes Stage 3 of the original design (issue #3).

## Not in this stage

Extended experts, on-demand start, evals, expert packs (stage 4). Cross-repository missions. Anything listening on a public address.

## Ask the user

- A Discord bot token and the channel to post in.
- The Discord user ids that may trigger and approve, for `allowlist.yaml`.

Without these, build and test against the fake gateway described below and say in the report that live Discord was not exercised.

## Step 1 — Queue and the usage window

`dispatcher/src/queue.ts`. Decide what starts next with a pure function of the queue, the caps, the ledger, and the current time passed in as an argument.

- **Priority:** chat, then GitHub, then API and webhooks, then schedules. Within a priority, oldest first.
- **Caps:** a global `maxConcurrentMissions` and one per repository.
- **Usage ledger.** Record what each session used (cost if OpenCode reports it for the model, otherwise tokens and requests; see spike question 9) in rolling 5-hour, weekly, and monthly windows. The window sizes and caps are configuration, defaulting to OpenCode Go's published limits ($12, $30, $60); they can be turned off for a pay-as-you-go key.
- **Headroom.** A scheduled mission starts only while usage in the current 5-hour window is below a configurable fraction (default one half). Other sources are not held back by the ledger.
- **Limit reached.** The Stage 1 pause still applies and is the authority: the provider's refusal pauses everything, and missions resume at the reset time. The ledger only improves the estimate of that time and feeds the headroom rule.
- Show the ledger, the queue, and any pause with its expected end on the dashboard.

Tests: with missions queued from all four sources, start order follows the priority; both caps hold; a scheduled mission is deferred when the ledger is above the threshold and starts when it falls below, on the injected clock; a simulated limit error pauses every running mission and they resume after the simulated reset; the ledger's windows roll correctly across their boundaries; the queue function is pure.

**Accept:** the tests pass.

## Step 2 — Notifications, approvals, and questions

- **Event bus.** The Dispatcher emits mission events: `plan-needs-approval`, `question`, `halted`, `paused`, `resumed`, `stuck`, `done`, `failed`. Each goes to every enabled channel. A channel that fails to deliver is retried and then reported; a failed delivery never blocks the mission or another channel.
- **Dashboard inbox.** Approvals, questions, and halts waiting for a person, with approve, reject, answer, and resume actions.
- **GitHub.** As in Stage 3a, for missions that came from GitHub.
- **Generic webhook.** Outbound events as signed JSON to a configured URL, and a signed inbound callback endpoint for `approve`, `reject`, `answer`, and `resume`. Any chat system can be attached through this.
- **Discord adapter** (`adapters/discord/`). A small separate service that connects out to Discord's gateway (no inbound path), keeps one thread per mission in the configured channel, posts each event, and offers approve and reject buttons and thread replies as answers. It accepts actions only from allowlisted Discord user ids and talks to the Dispatcher only through the generic webhook and callback. It attaches to `outside` and never sees a provider key or the registry. Its container has limits and hardening like every other.
- **Questions.** When an expert reports `blocked` with a question, the Director answers it if it can. If it cannot, the mission becomes `waiting-human` with the question, and the person's answer goes back to the Director through `quoteUntrusted`.
- **Who approved.** Every approval, rejection, answer, and resume records the channel and the account, in the decision log and the audit log.

**Autonomy dial.** Wire the salvaged `autonomy.ts` (shared context 2.3) to plan approval. `AGENCY_AUTONOMY` takes one of three values; any other value stops the Dispatcher at startup.

| Value | Effect |
|---|---|
| `advisory` | Every plan needs approval, and every work item also waits for a human release before its `land` step. |
| `balanced` (default) | The rules in shared context section 6: plans above `planApprovalAbove`, and every GitHub-triggered mission. |
| `full` | The `planApprovalAbove` threshold is ignored. GitHub-triggered missions still need plan approval. |

Merging is human-only at every setting.

**Fake Discord.** `adapters/discord/test/support/fake-discord-gateway.ts` plays the gateway and REST endpoints the adapter uses and records what it receives.

Tests: each event reaches all enabled channels; a failing channel does not block the others; approving from the dashboard, from a GitHub comment, and from a Discord button each release a waiting plan, and each records the channel and account; an action from a non-allowlisted Discord user is refused; an unsigned callback is refused; a `blocked` question reaches the inbox and the answer returns to the Director as quoted data; each autonomy value behaves as the table says, and an unknown value refuses to start.

**Accept:** the tests pass.

## Step 3 — Audit, liveness, and operations

- **Audit log.** The log from shared context 9.12 has recorded transitions since Stage 1. Complete its coverage: every trigger, approval, decision, gate result, landing, push, and pull request, each with who or what caused it. Mirror it in a database table for querying; the JSONL file remains the record.
- **Liveness.** A running task with no events for a configurable time is `stuck`: notify, and after a second interval interrupt it so its failure policy applies. Report paused and halted missions the same way.
- **Backups.** A nightly copy of the Dispatcher's database, the audit log, and the registry into `state/backups/` with a retention count. A backup is taken with SQLite's online backup, not by copying a live file.
- **Retention.** Worktrees, artifacts, and stacks of finished missions are removed after a configurable period; merged task branches stay.
- **`docs/operations.md`:** registering a repository, the allowlist, tokens and where each one lives, reaching the dashboard over a private network such as Tailscale or WireGuard, what to do when the fleet is paused, halted, or stuck, restoring from a backup, repairing a torn audit log, and the reminder that nothing may be exposed publicly.

Tests: a task scripted to hang is reported as stuck and then interrupted, on the injected clock; a backup restored into a fresh Dispatcher shows the same missions and its audit log verifies; retention removes what it should and keeps merged branches; the audit log holds the full chain for one mission from trigger to pull request, each entry naming its cause.

**Accept:** the tests pass.

## Step 4 — End to end

If the user supplied tokens: on a private test repository, an allowlisted label on an issue leads to a plan comment, an approval by comment, a mission through the `feature` playbook, a draft pull request with the gate table, and a Discord thread that followed it. Otherwise run the same flow against the fake servers and report the live run as not performed.

**Accept:** the flow completes against the fakes, and live if tokens were supplied.

## Acceptance checks for this stage

Under `scripts/accept/3b/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` exits 0. |
| `02-queue-tests` | Step 1's tests exist and passed. |
| `03-notify-tests` | Step 2's tests exist and passed. |
| `04-ops-tests` | Step 3's tests exist and passed. |
| `05-autonomy-refuses-unknown` | The Dispatcher container exits non-zero with `AGENCY_AUTONOMY=maybe`. |
| `06-discord-confined` | The adapter's container has no provider key, no registry mount, and no route to the `fleet` network other than the Dispatcher's callback endpoint. |
| `07-backup-restore-live` | On the running fleet: take a backup, restore it into a second Dispatcher with an empty state directory, and compare mission lists and audit tips. |
| `08-stuck-live` | A task sent to a paused expert container is reported stuck, then interrupted, with short intervals configured for the check. |
| `09-e2e-fakes` | Step 4 against the fake GitHub and Discord. |
| `10-e2e-live` | Step 4 live. Skips without the GitHub and Discord tokens. |
| `11-operations-doc` | `docs/operations.md` has every section listed in step 3, and each command in it that can run without credentials was run and exited 0. |

Red proofs worth the effort: swap two priorities in the queue; let a non-allowlisted Discord id through; corrupt one line of a backup's audit log and watch the restore check fail.

## Report

Write `docs/reports/stage-3b.md` in the format of shared context 4.4. State which checks ran against fake servers and which against live services. Then stop.
