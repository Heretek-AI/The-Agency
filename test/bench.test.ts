import { describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
  aggregateTelemetry,
  formatReport,
  loadTasks,
  noopDriver,
  prepareWorkspace,
  referenceDriver,
  runBench,
  summarize,
  type BenchResult,
} from "../bench/lib.js"

describe("SwarmOS v0.6.0 benchmark harness", () => {
  it("every task fails untouched and passes with its reference solution", async () => {
    const tasks = await loadTasks()
    expect(tasks.length).toBeGreaterThanOrEqual(12)
    expect(new Set(tasks.map((t) => t.category))).toEqual(new Set(["bug", "refactor", "constraints", "ui"]))

    const untouched = await runBench({ tasks, variants: ["swarmos"], driver: noopDriver })
    expect(untouched.filter((r) => r.success).map((r) => r.taskId)).toEqual([])

    const solved = await runBench({ tasks, variants: ["swarmos"], driver: referenceDriver })
    expect(solved.filter((r) => !r.success).map((r) => `${r.taskId}: ${r.verifyTail}`)).toEqual([])
  }, 120_000)

  it("configures the baseline as observe-only SwarmOS so both variants emit telemetry", async () => {
    const [task] = await loadTasks(["bug-paginate"])
    const workdir = await prepareWorkspace(task, "baseline", "/abs/swarmos-plugin.ts")
    try {
      const cfg = JSON.parse(await fs.readFile(path.join(workdir, ".opencode", "swarmos.json"), "utf8"))
      expect(cfg.mode).toBe("observe")
      const oc = JSON.parse(await fs.readFile(path.join(workdir, "opencode.json"), "utf8"))
      expect(oc.plugins).toEqual(["/abs/swarmos-plugin.ts"])

      const tdir = path.join(workdir, ".opencode", "telemetry")
      await fs.mkdir(tdir, { recursive: true })
      const lines = [
        { t: "", kind: "turn", sessionID: "a", usage: { input: 80, output: 10, cacheRead: 20 } },
        { t: "", kind: "tool", sessionID: "a", tool: "edit", status: "error" },
        { t: "", kind: "tool", sessionID: "a", tool: "edit", status: "completed", breaker: true },
      ]
      await fs.writeFile(path.join(tdir, "a.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"))
      await fs.writeFile(path.join(tdir, "b.jsonl"), JSON.stringify({ t: "", kind: "turn", sessionID: "b" }))
      expect(await aggregateTelemetry(workdir)).toEqual({
        sessions: 2,
        turns: 2,
        toolCalls: 2,
        toolFailures: 1,
        breakerFires: 1,
        tokens: { input: 80, output: 10, cacheRead: 20 },
        cacheHitRatio: 0.2,
      })
    } finally {
      await fs.rm(workdir, { recursive: true, force: true })
    }
  })

  it("summarizes variants and renders a comparison report", () => {
    const base = { driver: "agent", repeat: 1, verifyExitCode: 0, agentExitCode: 0, verifyTail: "" }
    const tel = (calls: number, fails: number) => ({
      sessions: 1, turns: 4, toolCalls: calls, toolFailures: fails, breakerFires: 0, tokens: null, cacheHitRatio: null,
    })
    const results: BenchResult[] = [
      { ...base, taskId: "t1", category: "bug", variant: "swarmos", success: true, durationMs: 1000, telemetry: tel(10, 1) },
      { ...base, taskId: "t2", category: "ui", variant: "swarmos", success: false, durationMs: 3000, telemetry: tel(10, 3) },
      { ...base, taskId: "t1", category: "bug", variant: "baseline", success: false, durationMs: 2000, telemetry: tel(20, 10) },
    ]
    const [sw, bl] = summarize(results)
    expect(sw).toMatchObject({ variant: "swarmos", runs: 2, successRate: 0.5, toolFailureRate: 0.2, meanDurationMs: 2000 })
    expect(bl).toMatchObject({ variant: "baseline", successRate: 0, toolFailureRate: 0.5 })
    const md = formatReport(results, { driver: "agent", startedAt: "now" })
    expect(md).toContain("| swarmos | 2 | 50.0% |")
    expect(md).toContain("| t1 | 1/1 | 0/1 |")
  })
})
