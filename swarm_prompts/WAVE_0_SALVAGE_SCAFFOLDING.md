# WAVE 0 ORCHESTRATION: FOUNDATION, SALVAGE & HARNESS
## Sub-Orchestrator Execution: Stage 0 (Migrate and Salvage)

**Target Branch:** `stage-0-salvage`  
**Worktree Directory:** `/home/john/Projects/The-Agency/worktrees/wave-0-salvage/`  
**Execution Mode:** `agent: "coordinator"`  
**Stage Prompt File:** `docs/prompts/stage-0-migrate-and-salvage.md`  
**Shared Context File:** `docs/prompts/00-shared-context.md`  
**Audit Reference File:** `docs/audit/2026-10-12-heretek-opencode-audit.md`  
**Salvage Source (`SALVAGE_SRC`):** `/home/john/Projects/Heretek-AI-opencode/rebuild_staging/` (commit `14f297a`)

---

## 1. Mission Overview

Wave 0 establishes the engineering bedrock that every subsequent stage in The Agency depends upon. It transforms this documentation-only repository into an active codebase, installs strict CI and `make check` enforcement, implements the `scripts/accept/` acceptance test harness, establishes the defect register (`docs/audit/defects.md`), and ports the 8 salvaged modules from `rebuild_staging` with the audit's defects strictly fixed and tested.

**Nothing in Stage 0 starts Docker containers or talks to live models.** It is pure, deterministic software engineering.

---

## 2. Worktree & Git Setup Instructions

As Sub-Orchestrator, perform these shell commands from repository root `/home/john/Projects/The-Agency`:

```bash
# 1. Ensure main is clean
git checkout main
git pull origin main

# 2. Create the Wave 0 worktree and branch
mkdir -p worktrees
git worktree add -b stage-0-salvage worktrees/wave-0-salvage main

# 3. Verify salvage source commit
git -C /home/john/Projects/Heretek-AI-opencode/rebuild_staging rev-parse --short HEAD
# Must output: 14f297a
```

---

## 3. Triad Execution Sequence

Execute the Triad inside `/home/john/Projects/The-Agency/worktrees/wave-0-salvage/`:

### Step 1: Dispatch Programmer Agent
Spawn a subagent with `agent: "coordinator"`:
- **Prompt**:
  > "You are the Programmer Agent for Stage 0 in worktree `/home/john/Projects/The-Agency/worktrees/wave-0-salvage/` on branch `stage-0-salvage`. Read `docs/prompts/00-shared-context.md` and `docs/prompts/stage-0-migrate-and-salvage.md` in full.
  > 
  > Execute all steps:
  > - Step 0: Preflight notes in `docs/build-notes.md`.
  > - Step 1: Root scaffolding (`.gitignore`, `LICENSE`, `README.md`, `versions.env`, `.env.example`, `package.json`, `bun.lock`, `tsconfig.json`, `.oxlintrc.json`, `.prettierrc`, `Makefile`, `scripts/check-ts-coverage.ts`, `scripts/check-no-skips.sh`, `.github/workflows/ci.yml`).
  > - Step 2: Acceptance harness (`scripts/accept/lib.sh`, `scripts/accept.sh`, `scripts/accept/test/accept.test.ts`).
  > - Step 3: Defect register in `docs/audit/defects.md` with all rows D-01 through D-20.
  > - Step 4: Port salvaged modules from `/home/john/Projects/Heretek-AI-opencode/rebuild_staging/packages/` with required bug fixes:
  >   - `dispatcher/src/util/hash.ts`
  >   - `dispatcher/src/util/redact.ts`
  >   - `dispatcher/src/util/exec.ts` (new process group, kill group on timeout, explicit env only)
  >   - `dispatcher/src/audit.ts` (O_APPEND, fsync, lockfile, divergence check)
  >   - `dispatcher/src/graph.ts` (status not state, waiting-human, dependency triggers)
  >   - `dispatcher/src/worktrees.ts` (retry never resets branch, integration branch base)
  >   - `verifier/src/run-checks.ts` (no default gates, empty list errors, logs to artifacts)
  >   - `dispatcher/src/protocol.ts` (JSON blocks, consistency rules)
  >   - `dispatcher/src/opencode.ts` (single OpenCode v2 client module)
  >   - `dispatcher/test/live/opencode.live.test.ts`
  >   - `dispatcher/test/support/`
  > - Step 5: Fake OpenCode scripted server in `dispatcher/test/support/fake-opencode.ts`.
  > - Step 6: Acceptance checks in `scripts/accept/0/*.sh`.
  > - Write `docs/reports/stage-0.md`.
  > Ensure `make check` is 100% green and `make accept STAGE=0` exits 0."

### Step 2: Dispatch QA Agent
Spawn a subagent with `agent: "coordinator"`:
- **Prompt**:
  > "You are the QA Agent for Stage 0 in worktree `/home/john/Projects/The-Agency/worktrees/wave-0-salvage/`.
  > 1. Run `make check`. Must exit 0.
  > 2. Run `make accept STAGE=0`. Must exit 0.
  > 3. Perform red-proof sabotage on Stage 0 acceptance checks. Induce temporary defects in harness scripts, verify `make accept` exits 1, revert with `git checkout`, confirm working tree is clean. Record evidence in `docs/evidence/0/red-proofs.log`.
  > 4. Report results."

### Step 3: Dispatch Drift Reviewer Agent
Spawn a subagent with `agent: "coordinator"`:
- **Prompt**:
  > "You are the Drift Reviewer Agent for Stage 0 in worktree `/home/john/Projects/The-Agency/worktrees/wave-0-salvage/`.
  > Follow `docs/prompts/verify-stage.md` strictly. You change no code.
  > - Check git status and commit history on `stage-0-salvage`.
  > - Run `make check` and `make accept STAGE=0`.
  > - Inspect all acceptance scripts under `scripts/accept/0/`. Ensure none contain `|| true` or vacuous assertions.
  > - Inspect salvaged modules to verify defects D-03, D-08, D-09, D-10, D-14, D-15, D-17, D-18 are genuinely fixed.
  > - Sample-sabotage at least two checks to prove fail-closed behavior, then revert cleanly.
  > - Write `docs/reports/stage-0-verification.md` with explicit `VERDICT: PASS` or `VERDICT: FAIL`."

---

## 4. Wave Completion & Merge Barrier

When the Drift Reviewer signs off with `VERDICT: PASS`:
1. Run `git -C worktrees/wave-0-salvage status` to assert working tree is clean.
2. In base repo `/home/john/Projects/The-Agency`:
   ```bash
   git checkout main
   git merge --no-ff stage-0-salvage -m "feat(stage-0): scaffolding, acceptance harness, defect register, and salvaged modules"
   make check
   make accept STAGE=0
   git worktree remove worktrees/wave-0-salvage
   ```
3. Wave 0 is now certified in `main`. Wave 1 may now begin.
