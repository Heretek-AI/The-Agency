import {
  claimTask,
  createTask,
  initProject,
  loadBoard,
  lockContract,
  planTournament,
  resolveTournament,
  setTaskBudget,
  submitQAReceipt,
  updateTaskStatus,
  verifyReleaseReady,
} from "../board/board.js"
import type {
  ClaimTaskInput,
  CreateTaskInput,
  InitProjectInput,
  LockContractInput,
  PlanTournamentInput,
  ResolveTournamentInput,
  SetTaskBudgetInput,
  SubmitQAReceiptInput,
  TaskStatus,
} from "../board/types.js"
import { scoreTournament } from "../board/worktrees.js"

export function registerOrgTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "org",
    description:
      "SwarmOS organizational blackboard for locking contracts, assigning tasks, running Best-of-N worktree tournaments, and verifying release readiness.",
  })

  editor.add({
    name: "get_board",
    description: "Read the current SwarmOS project charter, locked contracts, tasks, tournaments, and QA receipts.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const board = await loadBoard(rootDir)
      return { output: board, content: JSON.stringify(board, null, 2) }
    },
  })

  editor.add({
    name: "init_project",
    description: "Initialize or update the SwarmOS project charter and aesthetic archetype.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the software project" },
        vision: { type: "string", description: "High-level product vision and requirements" },
        aestheticArchetype: {
          type: "string",
          description:
            "Design archetype: 'High-Craft Technical Dark', 'Warm Editorial Studio Light', 'Swiss Grid / Data-Dense Workbench', or 'Atmospheric Minimalist Product'",
        },
      },
      required: ["name", "vision", "aestheticArchetype"],
    },
    output: { type: "object" },
    execute: async (input: InitProjectInput) => {
      const charter = await initProject(rootDir, input)
      return { output: charter, content: `Initialized SwarmOS project: ${charter.name}` }
    },
  })

  editor.add({
    name: "lock_contract",
    description: "Lock an architectural schema, interface, or design-token contract before feature implementation.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Contract ID (e.g. 'contract-auth-schema', 'contract-tokens')" },
        title: { type: "string", description: "Descriptive title of the contract" },
        files: { type: "array", items: { type: "string" }, description: "Contract source file paths" },
        invariants: { type: "array", items: { type: "string" }, description: "Architectural invariants enforced" },
        lockedBy: { type: "string", description: "Agent ID locking the contract" },
      },
      required: ["id", "title", "files", "invariants"],
    },
    output: { type: "object" },
    execute: async (input: LockContractInput) => {
      const contract = await lockContract(rootDir, input)
      return { output: contract, content: `Locked contract [${contract.id}]: ${contract.title}` }
    },
  })

  editor.add({
    name: "create_task",
    description: "Create or update an engineering task with explicit file ownership boundaries to prevent collisions.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task identifier (e.g. 'task-auth-endpoints')" },
        title: { type: "string", description: "Task summary and acceptance criteria" },
        owner: { type: "string", description: "Responsible role: 'staff-backend' | 'staff-ui' | 'architect'" },
        ownedPaths: { type: "array", items: { type: "string" }, description: "Disjoint file paths owned by this task" },
        worktree: { type: "string", description: "Optional isolated Git worktree path" },
        budget: {
          type: "object",
          description: "Optional spend/step budget ceiling for this task",
          properties: {
            maxTokens: { type: "number" },
            maxTurns: { type: "number" },
            maxToolCalls: { type: "number" },
          },
        },
      },
      required: ["id", "title", "owner", "ownedPaths"],
    },
    output: { type: "object" },
    execute: async (input: CreateTaskInput) => {
      const task = await createTask(rootDir, input)
      return { output: task, content: `Registered task [${task.id}] assigned to ${task.owner}` }
    },
  })


  editor.add({
    name: "claim_task",
    description:
      "Bind the current subagent session to a board task (`taskId`) and transition it to `in_progress` so per-task spend limits and `/doctor` track it.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID being claimed by this session" },
        sessionID: { type: "string", description: "Optional session ID (defaults to active session)" },
      },
      required: ["taskId"],
    },
    output: { type: "object" },
    execute: async (input: ClaimTaskInput, context?: any) => {
      const task = await claimTask(rootDir, {
        taskId: input.taskId,
        sessionID: input.sessionID ?? context?.sessionID,
      })
      return { output: task, content: `Claimed task [${task.id}] for session ${task.claimedBySessionID}` }
    },
  })

  editor.add({
    name: "set_task_budget",
    description:
      "Set or raise the spend/step budget (`maxTokens`, `maxTurns`, `maxToolCalls`) for a board task, optionally resetting accumulated usage counters.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID to configure" },
        budget: {
          type: "object",
          properties: {
            maxTokens: { type: "number" },
            maxTurns: { type: "number" },
            maxToolCalls: { type: "number" },
          },
        },
        resetUsage: { type: "boolean", description: "Reset accumulated usage counters to 0" },
      },
      required: ["taskId", "budget"],
    },
    output: { type: "object" },
    execute: async (input: SetTaskBudgetInput) => {
      const task = await setTaskBudget(rootDir, input)
      return { output: task, content: `Updated budget for task [${task.id}]: ${JSON.stringify(task.budget)}` }
    },
  })

  editor.add({
    name: "update_task",
    description:
      "Transition an engineering task status ('pending' | 'in_progress' | 'ready_for_qa' | 'qa_rejected' | 'verified' | 'superseded').",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID to update" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "ready_for_qa", "qa_rejected", "verified", "superseded"],
          description: "New status for the task",
        },
      },
      required: ["taskId", "status"],
    },
    output: { type: "object" },
    execute: async (input: { taskId: string; status: TaskStatus }) => {
      const task = await updateTaskStatus(rootDir, input.taskId, input.status)
      return { output: task, content: `Updated task [${task.id}] status to ${task.status}` }
    },
  })

  editor.add({
    name: "submit_qa_receipt",
    description:
      "Record an adversarial QA PASS or REJECT receipt for a task. PASS must cite a passing `tools.verify.run` (verifyRunId) taken on the task's current code. Only tasks with a PASS receipt can be released.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID being verified" },
        verdict: { type: "string", enum: ["PASS", "REJECT"], description: "PASS or REJECT verdict" },
        summary: { type: "string", description: "Executive summary of verification findings" },
        defects: { type: "array", items: { type: "string" }, description: "List of defects or regressions found (must be empty for PASS)" },
        testCommand: { type: "string", description: "Exact command executed to verify" },
        verifyRunId: {
          type: "string",
          description: "ID of a passing `tools.verify.run` taken on the task's current tree (required for PASS when the board policy demands it)",
        },
      },
      required: ["taskId", "verdict", "summary", "defects"],
    },
    output: { type: "object" },
    execute: async (input: SubmitQAReceiptInput) => {
      const task = await submitQAReceipt(rootDir, input)
      return { output: task, content: `Recorded QA Receipt [${input.verdict}] for task [${input.taskId}]` }
    },
  })

  editor.add({
    name: "plan_tournament",
    description:
      "Provision a Best-of-N Worktree Tournament: competing candidate tasks (candidate-a, candidate-b, ...) each get a real git worktree at .worktrees/<taskId> on branch swarmos/<taskId>. Candidates must edit only inside their worktree.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Tournament identifier (e.g. 'tourney-canvas-engine')" },
        title: { type: "string", description: "Objective and evaluation criteria for the competing candidates" },
        role: { type: "string", description: "Role competing in the tournament ('staff-ui' or 'staff-backend')" },
        ownedPaths: { type: "array", items: { type: "string" }, description: "Target file paths for the feature" },
        candidates: { type: "number", description: "Number of competing candidates (default 2, max 4)" },
      },
      required: ["id", "title", "role", "ownedPaths"],
    },
    output: { type: "object" },
    execute: async (input: PlanTournamentInput) => {
      const tournament = await planTournament(rootDir, input)
      return {
        output: tournament,
        content: `Planned Best-of-${tournament.candidates.length} tournament [${tournament.id}]:\n${tournament.candidates
          .map((c) => `- ${c.taskId}: ${c.provisioned ? `worktree ${c.worktree} on ${c.branch}` : `NOT provisioned (${c.provisionNote ?? "unknown"})`}`)
          .join("\n")}`,
      }
    },
  })

  editor.add({
    name: "score_tournament",
    description:
      "Run a full tools.verify.run inside every candidate worktree and rank candidates (passing first, then fewest failures, then smallest diff).",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: { tournamentId: { type: "string", description: "Tournament ID to score" } },
      required: ["tournamentId"],
    },
    output: { type: "object" },
    execute: async (input: { tournamentId: string }) => {
      const board = await loadBoard(rootDir)
      const tournament = (board.tournaments ?? []).find((t) => t.id === input.tournamentId)
      if (!tournament) throw new Error(`SwarmOS Tournament not found: ${input.tournamentId}`)
      const scores = await scoreTournament(rootDir, tournament)
      return {
        output: { scores },
        content: scores
          .map(
            (sc, i) =>
              `${i + 1}. ${sc.taskId}: ${sc.provisioned ? (sc.passed ? "PASS" : "FAIL") : "no worktree"}${sc.verifyRunId ? ` [${sc.verifyRunId}]` : ""} — ${sc.failedChecks} failed check(s), ${sc.failedTests} failed test(s), +${sc.diff.insertions}/-${sc.diff.deletions} in ${sc.diff.files} file(s)`,
          )
          .join("\n"),
      }
    },
  })

  editor.add({
    name: "resolve_tournament",
    description:
      "Resolve a Best-of-N Worktree Tournament: the QA-verified winner's branch is merged into the main tree (--no-ff), all candidate worktrees and branches are removed, and competing tasks are marked superseded.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        tournamentId: { type: "string", description: "Tournament ID to resolve" },
        winningTaskId: { type: "string", description: "Winning candidate task ID (must have a PASS QA receipt)" },
        summary: { type: "string", description: "Rationale for selecting the winning implementation" },
        merge: {
          type: "boolean",
          description: "Merge the winner's branch into the main tree and remove all candidate worktrees (default true when worktrees exist)",
        },
      },
      required: ["tournamentId", "winningTaskId", "summary"],
    },
    output: { type: "object" },
    execute: async (input: ResolveTournamentInput) => {
      const tournament = await resolveTournament(rootDir, input)
      return {
        output: tournament,
        content: `Resolved tournament [${tournament.id}] -> winner: ${tournament.winningTaskId}${tournament.mergeCommit ? ` (merged as ${tournament.mergeCommit.slice(0, 10)})` : ""}`,
      }
    },
  })

  editor.add({
    name: "verify_release_ready",
    description:
      "Audit the entire SwarmOS board to verify that a charter exists, contracts are locked, active tournaments are resolved, and every non-superseded task has a signed PASS receipt with zero defects.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const report = await verifyReleaseReady(rootDir)
      return {
        output: report,
        content: JSON.stringify(report, null, 2),
      }
    },
  })
}
