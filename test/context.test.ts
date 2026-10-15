import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import SwarmOSPlugin from "../src/index.js"
import { resetSessionStates } from "../src/host/session-state.js"
import { resetCircuitBreaker } from "../src/omni/circuit-breaker.js"
import { getContextBudgetReport, packBlocks, scoreLesson } from "../src/omni/context-budget.js"
import { acceptProposal, loadLessons, loadProposals, recordLesson, saveLessons, type EpisodicLesson } from "../src/omni/memory.js"
import { writeArtifact } from "../src/omni/artifacts.js"
import { createMockHost } from "./helpers/mock-host.js"

const lesson = (over: Partial<EpisodicLesson>): EpisodicLesson => ({
  id: "l",
  trigger: "anything",
  lesson: "do the thing",
  createdAt: new Date().toISOString(),
  ...over,
})

describe("SwarmOS v0.8.0 context budget", () => {
  it("packs blocks by priority, truncates what can be truncated and drops the rest", () => {
    const { text, report } = packBlocks(
      [
        { id: "low", priority: 1, text: "x".repeat(1600) },
        { id: "small", priority: 2, text: "s".repeat(200) },
        { id: "high", priority: 10, text: "h".repeat(200) },
        { id: "doc", priority: 5, text: "d".repeat(4000), truncatable: true },
      ],
      600,
    )
    // "doc" is capped at 40% of the budget (240 tokens) so lower-priority blocks still get room.
    expect(report.included).toEqual(["high", "doc", "small"])
    expect(report.truncated).toEqual(["doc"])
    expect(report.dropped).toEqual(["low"])
    expect(report.usedTokens).toBe(340)
    expect(text.startsWith("h".repeat(200))).toBe(true)
    expect(text).toContain("truncated by SwarmOS context budget")
  })

  it("scores lessons by scope hits, keyword overlap, track record and age", () => {
    const state = { touchedFiles: ["src/db/pool.ts"], agent: "staff-backend" }
    const scoped = scoreLesson(lesson({ scopePaths: ["src/db/**"] }), state)
    const keyword = scoreLesson(lesson({ trigger: "Changing the db pool size" }), state)
    const unrelatedScope = scoreLesson(lesson({ scopePaths: ["web/**"] }), state)
    const general = scoreLesson(lesson({}), state)
    expect(scoped).toBeGreaterThan(keyword)
    expect(keyword).toBeGreaterThan(general)
    expect(general).toBeGreaterThan(unrelatedScope)
    expect(scoreLesson(lesson({ needsReview: true, scopePaths: ["src/db/**"] }), state)).toBe(0)

    const old = new Date(Date.now() - 180 * 86_400_000).toISOString()
    expect(scoreLesson(lesson({ createdAt: old }), state)).toBeCloseTo(general / 4, 5)
    const failing = lesson({ stats: { injected: 3, successes: 0, failures: 1 } })
    expect(scoreLesson(failing, state)).toBeLessThan(general)
  })
})

describe("SwarmOS v0.8.0 budgeted context, memory upkeep & pinning (full setup)", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-context-test-"))
    resetSessionStates()
    resetCircuitBreaker()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("injects relevant lessons within budget and skips lessons flagged for review", async () => {
    await fs.mkdir(path.join(tmpDir, ".opencode"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, ".opencode", "swarmos.json"), JSON.stringify({ contextBudgetTokens: 400, telemetry: false }))
    await saveLessons(tmpDir, [
      lesson({ id: "db-pool", trigger: "Editing the connection pool", lesson: "Pool size must stay 1 in tests.", scopePaths: ["src/db/**"] }),
      lesson({ id: "bad-advice", trigger: "Editing the connection pool", lesson: "Disable the pool.", scopePaths: ["src/db/**"], needsReview: true }),
      lesson({ id: "css", trigger: "Styling buttons", lesson: "Use tokens.", scopePaths: ["web/**"] }),
    ])
    await writeArtifact(tmpDir, "task.md", `# Task\n${"- [ ] step\n".repeat(400)}`)

    const host = createMockHost(tmpDir)
    await SwarmOSPlugin.setup(host.ctx)
    await host.fire("tool.execute.after", { sessionID: "s1", agent: "staff-backend", tool: "read", status: "completed", input: { path: "src/db/pool.ts" }, result: { content: "x" } })

    const event = { sessionID: "s1", agent: "staff-backend", system: [{ type: "text", text: "base" }, { type: "text", text: "env" }] }
    await host.fire("session.context", event)
    const injected = event.system[1].text

    expect(injected).toContain("<swarmos-context>")
    expect(injected).toContain('id="db-pool"')
    expect(injected).not.toContain("bad-advice")
    expect(injected).toContain("tools.verify.*")
    const report = getContextBudgetReport("s1")!
    expect(report.usedTokens).toBeLessThanOrEqual(400)
    expect(report.truncated).toContain("artifact:task.md")

    // Injection is idempotent within a turn and counted once per session.
    await host.fire("session.context", event)
    expect(event.system[1].text.match(/<swarmos-context>/g)).toHaveLength(1)
    const dbPool = (await loadLessons(tmpDir)).find((l) => l.id === "db-pool")!
    expect(dbPool.stats?.injected).toBe(1)
  })

  it("drafts a lesson proposal after a breaker loop recovers, and flags lessons that keep failing", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "src", "x.ts"), "export const x = 1\n")
    await recordLesson(tmpDir, { id: "x-rule", trigger: "Editing x", lesson: "Always edit x with hashlines.", scopePaths: ["src/x.ts"] })

    const host = createMockHost(tmpDir)
    await SwarmOSPlugin.setup(host.ctx)
    await host.fire("tool.execute.after", { sessionID: "s2", tool: "read", status: "completed", input: { path: "src/x.ts" }, result: { content: "" } })
    await host.fire("session.context", { sessionID: "s2", agent: "build", system: [{ text: "base" }] })

    const fail = () => ({ sessionID: "s2", tool: "edit", status: "error", input: { path: "src/x.ts" }, error: { message: "oldString not found in content" } })
    await host.fire("tool.execute.after", fail())
    const second = fail()
    await host.fire("tool.execute.after", second)
    expect(second.error.message).toContain("DOOM-LOOP CIRCUIT BREAKER")

    // The breaker fired on a file in x-rule's scope while it was injected: one failure.
    expect((await loadLessons(tmpDir)).find((l) => l.id === "x-rule")?.stats?.failures).toBe(1)

    await host.fire("tool.execute.after", { sessionID: "s2", tool: "edit", status: "completed", input: { path: "src/x.ts" }, result: { content: "Edited src/x.ts" } })
    const [proposal] = await loadProposals(tmpDir)
    expect(proposal).toMatchObject({ trigger: "Editing src/x.ts", scopePaths: ["src/x.ts"] })
    expect(proposal.evidence).toMatchObject({ tool: "edit", target: "src/x.ts", recoveredWith: "edit" })

    const accepted = await acceptProposal(tmpDir, proposal.id, { lesson: "x.ts uses CRLF; read it before editing." })
    expect(accepted.source).toBe("proposal")
    expect(await loadProposals(tmpDir)).toEqual([])

    // A failed verification in the same session counts against injected lessons -> needsReview.
    await host.fire("tool.execute.after", { sessionID: "s2", tool: "execute", status: "completed", input: { code: "tools.verify.run({})" }, result: { content: "Verify FAILED [verify-1] scope=changed" } })
    const xRule = (await loadLessons(tmpDir)).find((l) => l.id === "x-rule")!
    expect(xRule.stats?.failures).toBe(2)
    expect(xRule.needsReview).toBe(true)
  })

  it("pins only the configured namespaces", async () => {
    await fs.mkdir(path.join(tmpDir, ".opencode"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, ".opencode", "swarmos.json"), JSON.stringify({ pinnedNamespaces: ["org", "verify"] }))
    const host = createMockHost(tmpDir)
    await SwarmOSPlugin.setup(host.ctx)
    expect(host.tools["org.get_board"].options.pinned).toBe(true)
    expect(host.tools["verify.run"].options.pinned).toBe(true)
    expect(host.tools["memory.recall"].options.pinned).toBe(false)
    expect(host.tools["office.extract_document"].options.pinned).toBe(false)
  })
})
