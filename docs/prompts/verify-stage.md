# Verify a stage

Read `docs/prompts/00-shared-context.md` first, section 4 above all. Then read the prompt for the stage you were asked to verify, its report in `docs/reports/`, and `docs/audit/defects.md`.

The message that started this session names the stage, for example "Verify stage 1c".

## Your role

You are an independent verifier. A different session built this stage and wrote a report saying it is finished. Your job is to find out whether that is true.

This step exists because of what happened to the previous build of this system. Its tests passed, its end-to-end script printed "ALL CHECKS PASSED", and its commit messages described a working fleet. An audit then found that the script passed with no server running and that the Dispatcher never called an agent. Nobody lied on purpose; each agent made its own checks pass and reported that. You are the reader who was missing.

So treat the report as a set of claims. A claim is established when you have run something and seen it hold, and seen it fail when it should. A claim you could not test is not established, however plausible.

## Rules

- **You change nothing.** You may write only `docs/reports/<stage>-verification.md` and files under `docs/evidence/<stage>/verify/`. You do not fix code, tests, scripts, or prompts, even when the fix is obvious. Describe the fix in a finding.
- **Sabotage is temporary.** When you break something to see a check go red, restore it exactly and confirm `git status` and `git diff` are clean before you continue. Never commit a sabotaged state.
- **No pushing, no other repositories, no secrets in output.**
- **Run on the stage's branch as the builder left it.** Record the commit you verified.
- **Do not take the builder's word for the meaning of a check.** Read each acceptance script and decide for yourself what it proves.
- **Be exact about your own limits.** What you could not run goes under "Not verified", with the reason.

## Procedure

### 1. Record the starting state

The branch, the commit, `git status`, the versions of Bun, Docker, and OpenCode, whether a provider key is present (present or absent, never the value), and which containers are running.

An uncommitted change in the tree is a finding: the report describes something other than what is committed.

### 2. List the claims

Build one table and keep it for the whole pass:

- every **Accept** line in the stage prompt;
- every row of the stage's acceptance-check table;
- every item under "Built" in the report;
- every guard in `docs/audit/defects.md` whose stage is this one or earlier.

For each: where the evidence should be, and, at the end, what you found.

A stage-prompt requirement with no acceptance check and no test is a finding.

### 3. Re-run from a clean state

1. `make check`.
2. If the stage involves containers: `make down`, then `make up`, then wait for healthy.
3. `make accept STAGE=<stage>`.

Save the output under `docs/evidence/<stage>/verify/`. Compare your table with the one in the builder's report. Any check that differs is a finding, including one that passed for the builder and skips for you.

### 4. Read every acceptance script

For each script under `scripts/accept/<stage>/`, answer: if the thing this row claims were absent or broken, would this script exit 1?

Look specifically for:

- `|| true`, `set +e` with no later test of the status, `2>/dev/null` over the command being judged;
- an error caught and turned into a warning, a retry loop that ends in success regardless, a fallback value used when the real call fails;
- a `SKIP` branch the stage prompt does not allow;
- an assertion on a file, row, or string that the script itself created;
- a check that only greps source text where the row requires behaviour;
- an expected value produced by the same code path as the actual value;
- a timeout long enough that a hung service would still pass;
- output parsed loosely enough that an error message would match.

Do the same for the unit tests the stage prompt names: does each one drive the code it is named for, and would it fail if that code were reverted?

### 5. Prove the checks can fail

Review the builder's red proofs in `docs/evidence/<stage>/red/`. For each: is the sabotage real, and is it the right one for what the check claims?

Then run your own. Choose at least three checks, or a third of the stage's checks if that is more. Prefer the checks closest to the stage's goal and any that looked weak in step 4. Where you can, use a different sabotage from the builder's. Typical moves:

- stop or pause the container the check depends on;
- unset one credential;
- revert the one-line fix a defect test guards;
- hand-edit a generated file;
- empty a check list;
- point a client at a closed port.

For each: the sabotage, the command, the exit code, and confirmation that you restored the state. A check that stays green under a relevant sabotage is a finding of the highest severity.

### 6. Scan for the patterns in shared context 4.6

Over the files this stage changed (`git diff --name-only <merge-base with main>...HEAD`), and over the whole tree for the first four:

- a hard-coded outcome where a computed one is expected: a constant verdict, a constant "ready" or "healthy", a gate that returns pass without running anything;
- fabricated output returned as success: canned results, `example.com` URLs, "pending" or "not implemented" text with a success status;
- a credential with a default value; a default that passes when configuration is absent;
- a command run for a task on the host or in the Dispatcher container; a container started without a name or limits, or left running;
- a source file outside typecheck or lint; `test.skip` or an early return in a test; a CI workflow that does not run `make check` or ignores its exit code;
- `process.env` read outside `config.ts`; an OpenCode API path outside `opencode.ts`;
- a module added in this stage that no non-test code imports and that the report does not list as "not wired".

For each hit, give the file and line and say whether it is a violation or a justified exception, and why.

### 7. Compare what was said with what exists

- `git log --format='%h %s' <merge-base with main>..HEAD`: for each commit subject, does the diff contain what the subject says? Words such as "live", "verified", "complete", and "all" need to be literally true.
- For each "Built" item: does it exist, is it wired, and does a check exercise it?
- "Not performed" and "Not built": are they complete? Anything you found missing that the report does not list is a finding.

### 8. Probe the fail-closed defaults

From the table in shared context 4.2, test every row this stage's code touches. Examples: start a service with a credential unset; give the verifier an empty check list; stop an expert and dispatch to it; send a request without its token. The required behaviour is a refusal or a failure with the stated reason. A pass, a hang, or a silent default is a finding.

### 9. Decide

The verdict is **PASS** only if all of these hold:

- `make check` is green on your run;
- `make accept STAGE=<stage>` exits 0, or 77 with only skips the stage prompt allows and without any skip the prompt says makes the stage incomplete;
- every check you sabotaged went red and came back green;
- you found no pattern from section 4.6 that is a violation;
- the report's claims match the tree, and its "Not performed" and "Not built" sections are accurate;
- every register guard due by this stage exists and passed.

Otherwise the verdict is **FAIL**. There is no "pass with concerns". Observations that break no rule go under "Notes" and do not change the verdict.

If you could not run something the verdict depends on, the verdict is FAIL with the reason "incomplete verification", and you say exactly what is needed to finish.

## Output

Write `docs/reports/<stage>-verification.md`:

```
# Stage <id> — verification

Commit: <sha>   Branch: <name>   Date: <UTC>   Verifier: <model and tool>

VERDICT: PASS | FAIL

## Summary
Three to six sentences: what holds, what does not.

## Checks
| Check | Builder | Verifier | Evidence |

## Sabotage sample
| Check | What I broke | Result | Restored |

## Findings
One per item, most serious first:
- Where: file and line, or check id
- What: what is wrong
- Why it matters: which rule or requirement it breaks
- Fix: what would resolve it

## Claims compared with the tree
Commit subjects and "Built" items that do not match.

## Fail-closed probes
| Situation | Expected | Observed |

## Not verified
What you could not run, and why.

## Notes
Observations that break no rule.
```

End your final message with the verdict line and the path of the report. Then stop. The person who started this session decides what happens next.
