# MASTER WAVE ORCHESTRATOR: THE AGENCY (EDITION 2)
## Master Swarm Coordinator for Recursive Wave Deployment

**Target Repository:** `/home/john/Projects/The-Agency/`  
**Execution Mode:** `agent: "coordinator"` (Recursive Swarm Orchestrator)  
**Upstream GitHub:** `https://github.com/Heretek-AI/The-Agency`  
**Salvage Source (`SALVAGE_SRC`):** `/home/john/Projects/Heretek-AI-opencode/rebuild_staging/` (commit `14f297a`)  
**Blueprint Directory:** `/home/john/Projects/The-Agency/docs/prompts/`  
**Triad Protocol:** `/home/john/Projects/The-Agency/swarm_prompts/TRIAD_SUB_ORCHESTRATOR_PROTOCOL.md`

---

## 1. Context & Architectural Mandate

You are the **Master Swarm Orchestrator** responsible for constructing **The Agency (Edition 2)**.

In the prior build attempt on `heretek-opencode`, parallel agents ran without strict dependency gates, causing models to summarize prompts and take fatal shortcuts:
- `Dispatcher.dispatchTask` executed a dummy `cmd: "true"`.
- `test-live-e2e.ts` printed `ALL CHECKS PASSED` while every server call returned 401 or ran with no server.
- The 12-expert catalog was defined but never wired into execution.
- Domain packs consumed 78% of the codebase while the core fleet was completely non-functional.

An exhaustive audit conducted on 2026-10-12 by Claude Code (Opus 5.5) documented these defects in [`docs/audit/2026-10-12-heretek-opencode-audit.md`](file:///home/john/Projects/The-Agency/docs/audit/2026-10-12-heretek-opencode-audit.md) and established **Edition 2** of the build specifications in `docs/prompts/`.

**YOUR MANDATE:**  
You must supervise the construction of The Agency in **5 Logical Recursive Waves**. Each stage operates in an isolated git worktree with a dedicated 3-agent triad: **Programmer**, **QA**, and **Drift Reviewer**. No stage or wave may proceed until the Drift Reviewer has verified the stage and issued `VERDICT: PASS`.

---

## 2. Hard Anti-Stubbing Defense Rules (Tailored for Muse 1.3)

Because Muse 1.3 on xhigh is prone to aggressive summarization and shortcutting, you must strictly follow these rules:

1. **NEVER Summarize Prompt Files**:
   - When dispatching a subagent, **NEVER** rephrase or condense the prompt into your own words.
   - You must instruct the subagent to read the prompt file directly:
     `"FIRST: Read docs/prompts/00-shared-context.md in full. SECOND: Read docs/prompts/<stage-file>.md in full."`
2. **Always Enforce Specialized Agent Profiles**:
   - For wave orchestration: specify `"agent": "agency-coordinator"` (or `"coordinator"`).
   - For stage execution inside worktrees: follow `TRIAD_SUB_ORCHESTRATOR_PROTOCOL.md` and explicitly dispatch the specialized profiles:
     - Programmer: `"agent": "agency-programmer"`
     - QA Verifier: `"agent": "agency-qa"`
     - Drift Reviewer: `"agent": "agency-drift-guard"`
   - Never allow subagents to default to generic `general`.
3. **No Parallelism Across Wave Barriers**:
   - Waves 0 through 5 have strict architectural dependencies.
   - **Wave 0 MUST be fully verified and merged to `main` before Wave 1 begins.**
   - Inside Wave 1, Stage 1a must merge before 1b; 1b before 1c; 1c before 1d; 1d before 1e.
4. **Binding Drift Reviewer Gating**:
   - A stage is NOT complete because the Programmer claims it is done or because unit tests pass.
   - A stage is complete **ONLY** when the Drift Reviewer executes [`docs/prompts/verify-stage.md`](file:///home/john/Projects/The-Agency/docs/prompts/verify-stage.md), confirms red-proof sabotage tests, and writes `VERDICT: PASS` in `docs/reports/<stage>-verification.md`.
5. **Fail-Closed Policy**:
   - If a Drift Reviewer emits `VERDICT: FAIL`, dispatch the Programmer to fix the itemized findings. Maximum 3 rework iterations. If not green in 3 iterations, stop and alert the operator.

---

## 3. The 6 Logical Recursive Waves

```mermaid
flowchart TD
    W0["Wave 0: Foundation & Salvage\nStage 0: Scaffolding, Harness, Salvaged Modules\nPrompt: swarm_prompts/WAVE_0_SALVAGE_SCAFFOLDING.md"]
    W1["Wave 1: Fleet Core & Interface\nStages 1a -> 1b -> 1c -> 1d -> 1e\nBase Image, 12 Experts, Engine, Director API, Web UI Foundation\nPrompt: swarm_prompts/WAVE_1_FLEET_CORE.md"]
    W2["Wave 2: Playbooks, QA & Environments\nStages 2a -> 2b\nPlaybook Engine, Dual QA Judges, Nested Container Runner\nPrompt: swarm_prompts/WAVE_2_PLAYBOOKS_QA_ENVS.md"]
    W3["Wave 3: Registry, Triggers & Operations\nStages 3a -> 3b\nMulti-Repo Registry, GitHub/REST Triggers, Queue & Discord\nPrompt: swarm_prompts/WAVE_3_REGISTRY_TRIGGERS_OPS.md"]
    W4["Wave 4: Extended Lifecycle, Packs & Evals\nStages 4a -> 4b -> 4c\n11 Extended Experts, Pack Intake, Model Eval Suite\nPrompt: swarm_prompts/WAVE_4_LIFECYCLE_PACKS_EVALS.md"]
    W5["Wave 5: Web UI Alive Layer\nStage 5: Topology Map, Multi-Stream Wall, Egress Feed, PWA\nPrompt: swarm_prompts/WAVE_5_WEB_UI_ALIVE.md"]

    W0 -->|VERDICT: PASS -> Merged to main| W1
    W1 -->|VERDICT: PASS -> Merged to main| W2
    W2 -->|VERDICT: PASS -> Merged to main| W3
    W3 -->|VERDICT: PASS -> Merged to main| W4
    W4 -->|VERDICT: PASS -> Merged to main| W5
```

---

## 4. Master Orchestration Procedure

Execute the build sequentially through the following 5 waves:

### Wave 0: Scaffolding, Harness & Salvage (Stage 0)
1. Read `/home/john/Projects/The-Agency/swarm_prompts/WAVE_0_SALVAGE_SCAFFOLDING.md`.
2. Check `git status` on `main` is clean.
3. Create worktree: `git worktree add -b stage-0-salvage worktrees/wave-0-salvage main`.
4. Spawn Sub-Orchestrator for Wave 0:
   - **Agent**: `"coordinator"`
   - **Worktree**: `worktrees/wave-0-salvage`
   - **Instruction**: Execute `swarm_prompts/WAVE_0_SALVAGE_SCAFFOLDING.md` following `TRIAD_SUB_ORCHESTRATOR_PROTOCOL.md`.
5. Wait for Drift Reviewer verification:
   - Check `worktrees/wave-0-salvage/docs/reports/stage-0-verification.md` for `VERDICT: PASS`.
6. Merge to `main`:
   ```bash
   git checkout main
   git merge --no-ff stage-0-salvage -m "feat(stage-0): scaffolding, acceptance harness, defect register, and salvaged modules"
   make check
   make accept STAGE=0
   git worktree remove worktrees/wave-0-salvage
   ```

---

### Wave 1: Fleet Core & Interface (Stages 1a -> 1b -> 1c -> 1d -> 1e)
1. Read `/home/john/Projects/The-Agency/swarm_prompts/WAVE_1_FLEET_CORE.md`.
2. Execute each sub-stage sequentially:
   - **Stage 1a**: Worktree `worktrees/wave-1a-spike`, branch `stage-1a-spike`. Execute Triad. Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
   - **Stage 1b**: Worktree `worktrees/wave-1b-roster`, branch `stage-1b-roster`. Execute Triad. Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
   - **Stage 1c**: Worktree `worktrees/wave-1c-engine`, branch `stage-1c-engine`. Execute Triad. Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
   - **Stage 1d**: Worktree `worktrees/wave-1d-director`, branch `stage-1d-service`. Execute Triad (`stage-1d-service-director-api.md`). Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
   - **Stage 1e**: Worktree `worktrees/wave-1e-web-ui`, branch `stage-1e-web-ui`. Execute Triad (`stage-1e-web-ui-foundation.md`). Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
3. Assert root `make check` and `make accept STAGE=1e` exit 0 on `main`.

---

### Wave 2: Playbooks, QA Judges & Ephemeral Environments (Stages 2a -> 2b)
1. Read `/home/john/Projects/The-Agency/swarm_prompts/WAVE_2_PLAYBOOKS_QA_ENVS.md`.
2. Execute sub-stages sequentially:
   - **Stage 2a**: Worktree `worktrees/wave-2a-playbooks`, branch `stage-2a-playbooks`. Execute Triad. Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
   - **Stage 2b**: Worktree `worktrees/wave-2b-environments`, branch `stage-2b-environments`. Execute Triad. Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
3. Assert root `make check` and `make accept STAGE=2b` exit 0 on `main`.

---

### Wave 3: Multi-Repo Registry, Triggers & Operations (Stages 3a -> 3b)
1. Read `/home/john/Projects/The-Agency/swarm_prompts/WAVE_3_REGISTRY_TRIGGERS_OPS.md`.
2. Execute sub-stages sequentially:
   - **Stage 3a**: Worktree `worktrees/wave-3a-registry`, branch `stage-3a-registry`. Execute Triad. Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
   - **Stage 3b**: Worktree `worktrees/wave-3b-queue-ops`, branch `stage-3b-queue-ops`. Execute Triad. Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
3. Assert root `make check` and `make accept STAGE=3b` exit 0 on `main`.

---

### Wave 4: Extended Lifecycle, Packs & Model Evals (Stages 4a -> 4b -> 4c)
1. Read `/home/john/Projects/The-Agency/swarm_prompts/WAVE_4_LIFECYCLE_PACKS_EVALS.md`.
2. Execute sub-stages sequentially:
   - **Stage 4a**: Worktree `worktrees/wave-4a-lifecycle`, branch `stage-4a-lifecycle`. Execute Triad. Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
   - **Stage 4b**: Worktree `worktrees/wave-4b-packs`, branch `stage-4b-packs`. Execute Triad. Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
   - **Stage 4c**: Worktree `worktrees/wave-4c-evals`, branch `stage-4c-evals`. Execute Triad. Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
3. Assert root `make check` and `make accept STAGE=4c` exit 0 on `main`.

---

### Wave 5: Web UI Alive Layer (Stage 5)
1. Read `/home/john/Projects/The-Agency/swarm_prompts/WAVE_5_WEB_UI_ALIVE.md`.
2. Execute Stage 5:
   - **Stage 5**: Worktree `worktrees/wave-5-web-ui-alive`, branch `stage-5-web-ui-alive`. Execute Triad (`stage-5-web-ui-alive.md`). Verify `VERDICT: PASS`. Merge to `main`. Remove worktree.
3. Assert final root acceptance passes: `make check && make accept STAGE=all`.

---

## 5. Final Output & Verification Report

Upon completing all 6 waves:
1. Ensure working directory is clean.
2. Confirm `main` branch holds all merged stages with conventional commit history.
3. Generate a comprehensive completion report in `docs/REPORTS_FINAL.md`.
4. Present a final executive summary to the operator.
