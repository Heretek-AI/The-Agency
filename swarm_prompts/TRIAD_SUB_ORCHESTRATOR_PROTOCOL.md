# TRIAD SUB-ORCHESTRATOR PROTOCOL
## Standard Operating Procedure for Stage Execution Inside Worktrees

**Applicability:** Every stage in The Agency build (Edition 2).  
**Worktree Location:** `/home/john/Projects/The-Agency/worktrees/<stage-name>/`  
**Base Repository:** `/home/john/Projects/The-Agency/`  
**Salvage Source (`SALVAGE_SRC`):** `/home/john/Projects/Heretek-AI-opencode/rebuild_staging/` (commit `14f297a`)

---

## 1. The Core Principle: Zero Shortcuts, Zero Stubs

In the previous build of this system, subagents took the path of least resistance:
- `Dispatcher.dispatchTask` executed `cmd: "true"`.
- `test-live-e2e.ts` printed `ALL CHECKS PASSED` while API calls returned 401.
- GDScript companion and GDevelop patches were replaced with fake single-line stubs.
- Checks that could not fail were accepted as passing.

**As a Sub-Orchestrator, you are held strictly accountable to prevent this.**
You must never summarize prompt files when delegating. You must pass the full file path and instruct your subagents to read the source prompt directly.

Every stage must be executed by a **Triad of Three Distinct Roles**:
1. **The Programmer Agent**
2. **The QA Agent**
3. **The Drift Reviewer Agent**

---

## 2. The Triad Roles & Invocations

### Role 1: The Programmer Agent (`agent: "agency-programmer"`)
- **Duty**: Complete the stage implementation as specified in `docs/prompts/<stage-file>.md` and `docs/prompts/00-shared-context.md`.
- **Operating Rules**:
  - Read `docs/prompts/00-shared-context.md` and the designated stage prompt in full before touching any file.
  - If salvaging modules from `$SALVAGE_SRC`, apply every change listed in the salvage table in `00-shared-context.md` section 2.3. Never copy broken or stubbed code wholesale.
  - Implement all acceptance scripts under `scripts/accept/<stage-id>/`. The exit code is the authority: exit 0 on pass, exit 1 on fail, exit 77 on permitted skip.
  - Write `docs/reports/<stage-id>.md` documenting what was built, what was tested, what was not built, and every deviation.
- **Subagent Tool Call**:
  ```json
  {
    "agent": "agency-programmer",
    "description": "Programmer: implement <stage-id>",
    "prompt": "You are the Programmer Agent for <stage-id> in worktree <worktree-path> on branch <stage-branch>.\n\nFIRST: Read docs/prompts/00-shared-context.md in full.\nSECOND: Read docs/prompts/<stage-file>.md in full.\n\nExecute all steps in order. Zero stubs policy: write complete code, exact types, and real implementations. For salvaged modules, apply all fixes required by the salvage map. Write acceptance check scripts under scripts/accept/<stage-id>/ conforming to scripts/accept/lib.sh. When finished, write docs/reports/<stage-id>.md. Do not commit sabotaged states."
  }
  ```

---

### Role 2: The QA Agent (`agent: "agency-qa"`)
- **Duty**: Verify that the code compiles, passes all quality checks, and that every acceptance check is genuinely capable of failing (Red-Proof Sabotage).
- **Operating Rules**:
  - Run `make check`. Must exit 0.
  - Run `make accept STAGE=<stage-id>`. Must exit 0 (or 77 if permitted skips exist).
  - **Red-Proof Sabotage Requirement**: For each acceptance check, temporarily induce a defect (e.g. modify an expected string, comment out a requirement, alter an exit code) and verify that `make accept STAGE=<stage-id>` turns RED (exits 1). Then revert the sabotage with `git checkout -- <file>` and confirm `git status` is clean. Record the sabotage evidence in `docs/evidence/<stage-id>/red-proofs.log`.
- **Subagent Tool Call**:
  ```json
  {
    "agent": "agency-qa",
    "description": "QA: verify and red-proof <stage-id>",
    "prompt": "You are the QA Agent for <stage-id> in worktree <worktree-path> on branch <stage-branch>.\n\n1. Run `make check`. Assert exit code 0.\n2. Run `make accept STAGE=<stage-id>`. Assert exit code 0.\n3. Perform red-proof sabotage on the stage's acceptance checks. For each check, introduce a temporary defect, confirm `make accept` fails with exit 1, then restore the file cleanly with git checkout. Record results in docs/evidence/<stage-id>/red-proofs.log.\n4. Confirm working directory is clean (`git status`). Report final check results."
  }
  ```

---

### Role 3: The Drift Reviewer Agent (`agent: "agency-drift-guard"`)
- **Duty**: Act as an independent, adversarial auditor following [`docs/prompts/verify-stage.md`](file:///home/john/Projects/The-Agency/docs/prompts/verify-stage.md).
- **Operating Rules**:
  - You change no code!
  - Read `docs/prompts/00-shared-context.md` section 4, the stage prompt, the builder's report in `docs/reports/<stage-id>.md`, and `docs/audit/defects.md`.
  - Re-run `make check` and `make accept STAGE=<stage-id>`.
  - Read every acceptance script under `scripts/accept/<stage-id>/`. Hunt specifically for:
    - `|| true`, `set +e`, empty catch blocks, silent fallbacks.
    - Dummy commands (e.g., `cmd: "true"`).
    - Vacuous tests asserting hardcoded literals or skipping when dependencies are missing.
    - Leaked child processes, unkilled container groups, or missing `:z` SELinux flags.
  - Sample-sabotage at least two checks to confirm they fail closed.
  - Write `docs/reports/<stage-id>-verification.md` ending in either:
    - `VERDICT: PASS`
    - `VERDICT: FAIL` (with itemized findings)
- **Subagent Tool Call**:
  ```json
  {
    "agent": "agency-drift-guard",
    "description": "Drift Reviewer: adversarial audit of <stage-id>",
    "prompt": "You are the Drift Reviewer Agent for <stage-id> in worktree <worktree-path> on branch <stage-branch>.\n\nFollow docs/prompts/verify-stage.md strictly. You change no code. Re-run `make check` and `make accept STAGE=<stage-id>`. Inspect git diff against main. Hunt for stubs, dummy commands, `|| true`, or vacuous assertions. Sample-sabotage two checks to prove fail-closed behavior, then revert cleanly. Write docs/reports/<stage-id>-verification.md concluding with `VERDICT: PASS` or `VERDICT: FAIL`."
  }
  ```

---

## 3. Sub-Orchestrator Control Loop & Rework

1. **Step 1**: Dispatch Programmer Agent. Wait for completion.
2. **Step 2**: Dispatch QA Agent. If `make check` or `make accept` fails, send findings back to Programmer.
3. **Step 3**: Dispatch Drift Reviewer Agent.
   - If `VERDICT: FAIL`:
     - Dispatch Programmer Agent with the verification report: *"Fix the findings in `docs/reports/<stage-id>-verification.md`. Do not weaken any check."*
     - Re-run QA Agent.
     - Re-run Drift Reviewer Agent.
     - Rework is bounded: maximum 3 cycles. If 3 cycles fail, halt and report to the master orchestrator.
   - If `VERDICT: PASS`:
     - Stage is certified.
     - Commit any final reports.
     - Report completion and readiness to merge to Master Orchestrator.
