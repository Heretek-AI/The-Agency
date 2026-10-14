# 🚀 LAUNCH RUNBOOK: THE AGENCY (EDITION 3) WAVE ORCHESTRATION SWARM

## Overview

Following the architectural audit by Claude Code (Opus 5.5) which uncovered shallow mocks and missing fleet wiring in previous monorepo builds, and the subsequent Edition 3 UI/UX architecture expansion, this runbook guides executing the **Master Wave Orchestration Swarm** using OpenCode in `agent: "coordinator"` mode inside `/home/john/Projects/The-Agency`.

The build is partitioned into **6 Logical Recursive Waves** across **isolated git worktrees**. Each stage deploys a subagent triad:
1. **Programmer Agent**: Full implementation; zero stubs or mocks.
2. **QA Agent**: Runs `make check`, `make accept STAGE=<id>`, and performs red-proof sabotage tests.
3. **Drift Reviewer Agent**: Executes [`docs/prompts/verify-stage.md`](file:///home/john/Projects/The-Agency/docs/prompts/verify-stage.md), hunts for `cmd: "true"` or vacuous checks, and issues a binding `VERDICT: PASS` or `VERDICT: FAIL`.

---

## 1. Automated Full Swarm Execution (Recommended)

Run from `/home/john/Projects/The-Agency` with the `--agent agency-coordinator` and `--auto` flags:

```bash
cd /home/john/Projects/The-Agency

opencode run --agent agency-coordinator --auto \
  --file swarm_prompts/MASTER_WAVE_ORCHESTRATOR.md \
  "Execute the master wave orchestration mission in MASTER_WAVE_ORCHESTRATOR.md. Deploy all 6 logical recursive waves in isolated worktrees using the Triad protocol (Programmer, QA, Drift Reviewer). Enforce zero stubs, require VERDICT: PASS before any merge to main, and complete the full Edition 3 build."
```

---

## 2. Step-by-Step / Wave-by-Wave Execution

If you prefer to monitor and land each wave individually, use these commands:

### Wave 0: Scaffolding, Harness & Salvaged Modules (Stage 0)
```bash
cd /home/john/Projects/The-Agency
opencode run --agent coordinator --auto \
  --file swarm_prompts/WAVE_0_SALVAGE_SCAFFOLDING.md \
  "Execute Wave 0 (Stage 0) in worktrees/wave-0-salvage. Dispatch Programmer, QA, and Drift Reviewer. Ensure make check and make accept STAGE=0 pass with VERDICT: PASS."

# Inspect verification report
cat worktrees/wave-0-salvage/docs/reports/stage-0-verification.md

# Merge when verified
git checkout main
git merge --no-ff stage-0-salvage -m "feat(stage-0): scaffolding, acceptance harness, defect register, and salvaged modules"
make check
make accept STAGE=0
git worktree remove worktrees/wave-0-salvage
```

---

### Wave 1: Fleet Core & Interface (Stages 1a -> 1b -> 1c -> 1d -> 1e)
```bash
cd /home/john/Projects/The-Agency
opencode run --agent coordinator --auto \
  --file swarm_prompts/WAVE_1_FLEET_CORE.md \
  "Execute Wave 1 (Stages 1a through 1e) in sequential worktrees. For each stage, execute the Triad, verify VERDICT: PASS, and merge to main."
```

---

### Wave 2: Playbooks, QA Judges & Ephemeral Environments (Stages 2a -> 2b)
```bash
cd /home/john/Projects/The-Agency
opencode run --agent coordinator --auto \
  --file swarm_prompts/WAVE_2_PLAYBOOKS_QA_ENVS.md \
  "Execute Wave 2 (Stages 2a and 2b) in sequential worktrees. Execute Triad, verify VERDICT: PASS, and merge to main."
```

---

### Wave 3: Registry, Triggers & Operations (Stages 3a -> 3b)
```bash
cd /home/john/Projects/The-Agency
opencode run --agent coordinator --auto \
  --file swarm_prompts/WAVE_3_REGISTRY_TRIGGERS_OPS.md \
  "Execute Wave 3 (Stages 3a and 3b) in sequential worktrees. Execute Triad, verify VERDICT: PASS, and merge to main."
```

---

### Wave 4: Extended Lifecycle, Packs & Model Evals (Stages 4a -> 4b -> 4c)
```bash
cd /home/john/Projects/The-Agency
opencode run --agent coordinator --auto \
  --file swarm_prompts/WAVE_4_LIFECYCLE_PACKS_EVALS.md \
  "Execute Wave 4 (Stages 4a, 4b, 4c) in sequential worktrees. Execute Triad, verify VERDICT: PASS, and merge to main."
```

---

### Wave 5: Web UI Alive Layer (Stage 5)
```bash
cd /home/john/Projects/The-Agency
opencode run --agent coordinator --auto \
  --file swarm_prompts/WAVE_5_WEB_UI_ALIVE.md \
  "Execute Wave 5 (Stage 5) in worktrees/wave-5-web-ui-alive. Deploy the real-time topology map, multi-stream wall, Go usage meter, egress stream, and PWA capabilities. Execute Triad, verify VERDICT: PASS, and merge to main."
```

---

## 3. Why This Suite Guards Against Muse 1.3 Weaknesses

| Risk with Muse 1.3 | How This Orchestration Suite Solves It |
| :--- | :--- |
| **Prompt Summarization** | The Master Orchestrator is forbidden from summarizing prompts; it must point subagents to the full file paths in `docs/prompts/`. |
| **Defaulting to `general` Mode** | Every subagent tool call explicitly specifies `"agent": "coordinator"`. |
| **Premature Victory / Green Tests** | Every acceptance check requires a **Red-Proof Sabotage Test** (QA proves that breaking the code causes the check to fail). |
| **Mock Stubs & Omissions** | The **Drift Reviewer Agent** runs after every stage, inspects diffs against `00-shared-context.md` and `defects.md`, and fails closed on `cmd: "true"`, `|| true`, or missing features. |
| **Parallel Collision** | Hard wave barriers ensure Wave $N+1$ never starts until Wave $N$ is verified and merged to `main`. |
