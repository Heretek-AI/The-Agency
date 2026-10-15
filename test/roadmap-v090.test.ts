import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import SwarmOSPlugin, {
  appendTelemetry,
  claimTask,
  clearDiagnosticCache,
  createTask,
  evaluatePermissionGuard,
  exportSessionToBenchmark,
  findSymbolDefinitions,
  findSymbolReferences,
  initProject,
  listReplayableSessions,
  loadBoard,
  recordTaskSpend,
  replaySessionTrace,
  resetSessionStates,
  runParallelDiagnostics,
  runQuickDiagnostics,
  setTaskBudget,
  warmDiagnosticStats,
  createTaskBudgetEvaluator,
} from "../src/index.js"
import { checkHostContract } from "../src/host/contract-check.js"
import { createMockHost } from "./helpers/mock-host.js"

describe("SwarmOS v0.9.0 Complete Roadmap (Task Budgets, Session Replay, Warm Parallel LSP, Host Contract)", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-v090-test-"))
    resetSessionStates()
    clearDiagnosticCache()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("enforces per-task token, turn, and tool-call spend limits and hands control back to manager", async () => {
    await initProject(tmpDir, {
      name: "Budgeted Project",
      vision: "Verify task spend limits",
      aestheticArchetype: "High-Craft Technical Dark",
    })

    await createTask(tmpDir, {
      id: "task-api",
      title: "Build API handler",
      owner: "staff-backend",
      ownedPaths: ["src/api/**"],
      budget: { maxTokens: 1000, maxTurns: 3, maxToolCalls: 2 },
    })

    await claimTask(tmpDir, { taskId: "task-api", sessionID: "sess-backend-1" })

    // 2 tool calls within budget -> allowed
    await recordTaskSpend(tmpDir, { sessionID: "sess-backend-1", agent: "staff-backend", toolCallsDelta: 2, tokensDelta: 600 })
    const withinDecision = await evaluatePermissionGuard(
      tmpDir,
      {
        sessionID: "sess-backend-1",
        agent: "staff-backend",
        action: "edit",
        resources: ["src/api/routes.ts"],
        effect: "allow",
      },
      [createTaskBudgetEvaluator()],
    )
    expect(withinDecision.allowed).toBe(true)

    // 3rd tool call exceeds maxToolCalls (2) -> overBudget = true
    const afterThird = await recordTaskSpend(tmpDir, { sessionID: "sess-backend-1", agent: "staff-backend", toolCallsDelta: 1 })
    expect(afterThird?.usage?.overBudget).toBe(true)
    expect(afterThird?.usage?.overBudgetReason).toContain("toolCallsUsed (3) > maxToolCalls (2)")

    // Subagent edit is now blocked by Task Budget Guard
    const blockedDecision = await evaluatePermissionGuard(
      tmpDir,
      {
        sessionID: "sess-backend-1",
        agent: "staff-backend",
        action: "edit",
        resources: ["src/api/routes.ts"],
        effect: "allow",
      },
      [createTaskBudgetEvaluator()],
    )
    expect(blockedDecision.allowed).toBe(false)
    expect(blockedDecision.reason).toContain("SwarmOS Task Budget Guard")
    expect(blockedDecision.reason).toContain("tools.org.set_task_budget")

    // Manager is never blocked and can raise the budget via setTaskBudget
    await setTaskBudget(tmpDir, {
      taskId: "task-api",
      budget: { maxToolCalls: 10, maxTokens: 5000, maxTurns: 10 },
    })

    const unblockedDecision = await evaluatePermissionGuard(
      tmpDir,
      {
        sessionID: "sess-backend-1",
        agent: "staff-backend",
        action: "edit",
        resources: ["src/api/routes.ts"],
        effect: "allow",
      },
      [createTaskBudgetEvaluator()],
    )
    expect(unblockedDecision.allowed).toBe(true)
  })

  it("exports recorded failure sessions into benchmark regression tasks and replays traces", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "src/math.js"), "export const add = (a, b) => a - b;\n", "utf8")
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "sample", scripts: { test: "bun test" } }, null, 2),
      "utf8",
    )

    await appendTelemetry(tmpDir, {
      t: new Date().toISOString(),
      kind: "session_start",
      sessionID: "sess-fail-42",
      agent: "staff-backend",
      gitHead: "abc1234",
      prompt: "Fix add() in src/math.js so it adds instead of subtracts.",
    })
    await appendTelemetry(tmpDir, {
      t: new Date().toISOString(),
      kind: "tool",
      sessionID: "sess-fail-42",
      agent: "staff-backend",
      tool: "edit",
      status: "error",
      target: "src/math.js",
      error: "oldString not found",
      breaker: true,
    })

    const sessions = await listReplayableSessions(tmpDir)
    expect(sessions.length).toBe(1)
    expect(sessions[0].hasFailures).toBe(true)
    expect(sessions[0].breakerFires).toBe(1)

    const exported = await exportSessionToBenchmark(tmpDir, {
      sessionID: "sess-fail-42",
      taskId: "regression-math-add",
      outTasksDir: "bench/tasks",
    })
    expect(exported.taskId).toBe("regression-math-add")
    expect(exported.recordCount).toBe(2)

    const taskJson = JSON.parse(await fs.readFile(exported.taskJsonPath, "utf8"))
    expect(taskJson.category).toBe("regression")
    expect(taskJson.sourceSessionID).toBe("sess-fail-42")

    const trace = JSON.parse(await fs.readFile(exported.tracePath, "utf8"))
    const replayReport = await replaySessionTrace(trace)
    expect(replayReport.totalSteps).toBe(1)
    expect(replayReport.reproducedFailures).toBe(1)
    expect(replayReport.breakerTriggered).toBe(1)
  })

  it("caches unchanged file diagnostics in 0ms and locates symbol definitions & references", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true })
    const fileA = path.join(tmpDir, "src/alpha.mjs")
    const fileB = path.join(tmpDir, "src/beta.mjs")
    await fs.writeFile(fileA, "export function computeMetric(x) { return x * 2; }\n", "utf8")
    await fs.writeFile(fileB, "import { computeMetric } from './alpha.mjs';\nexport const res = computeMetric(21);\n", "utf8")

    const firstPass = await runParallelDiagnostics(tmpDir, ["src/alpha.mjs", "src/beta.mjs"], (r, p) => runQuickDiagnostics(r, p))
    expect(firstPass).toEqual([])
    expect(warmDiagnosticStats.cacheMisses).toBe(2)
    expect(warmDiagnosticStats.cacheHits).toBe(0)

    // Second pass on unchanged files hits the warm mtime+size cache
    const secondPass = await runParallelDiagnostics(tmpDir, ["src/alpha.mjs", "src/beta.mjs"], (r, p) => runQuickDiagnostics(r, p))
    expect(secondPass).toEqual([])
    expect(warmDiagnosticStats.cacheHits).toBe(2)

    const defs = await findSymbolDefinitions(tmpDir, "computeMetric")
    expect(defs.length).toBe(1)
    expect(defs[0].file).toBe("src/alpha.mjs")

    const refs = await findSymbolReferences(tmpDir, "computeMetric")
    expect(refs.length).toBeGreaterThanOrEqual(2)
  })

  it("verifies the pinned OpenCode V2.0.26 host contract and registers replay + lsp + budget modules", async () => {
    const fixtureDir = path.resolve(import.meta.dir, "fixtures/opencode-v2-ref")
    const contractReport = await checkHostContract(fixtureDir)
    expect(contractReport.ok).toBe(true)

    const host = createMockHost(tmpDir)
    const setupReport = await SwarmOSPlugin.setup(host.ctx)
    expect(setupReport.modules.find((m) => m.id === "task-budgets")?.status).toBe("registered")
    expect(host.tools["org.claim_task"]).toBeDefined()
    expect(host.tools["org.set_task_budget"]).toBeDefined()
    expect(host.tools["replay.export_benchmark"]).toBeDefined()
    expect(host.tools["lsp.diagnostics"]).toBeDefined()
    expect(host.commands.replay).toBeDefined()
  })
})
