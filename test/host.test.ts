import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import SwarmOSPlugin, {
  HOST_CONTRACT,
  buildDoctorText,
  loadConfig,
  probeHost,
  readTelemetryFile,
  resetSessionStates,
  runSetupModules,
  summarizeTelemetry,
  type SetupReport,
} from "../src/index.js"
import { checkHostContract } from "../src/host/contract-check.js"
import { createMockHost } from "./helpers/mock-host.js"

describe("SwarmOS v0.6.0 host contract, /doctor & telemetry", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-host-test-"))
    resetSessionStates()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("reports every module as registered on a complete host", async () => {
    // Complete host includes .claude assets so claude-compat-bridge registers.
    await fs.mkdir(path.join(tmpDir, ".claude", "commands"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, ".claude", "commands", "audit.md"), "---\ndescription: Audit\n---\nAudit $ARGUMENTS")
    const host = createMockHost(tmpDir)
    const report = await SwarmOSPlugin.setup(host.ctx)

    expect(report.host.every((h) => h.present || !h.required)).toBe(true)
    const failedOrSkipped = report.modules.filter((m) => m.status !== "registered")
    expect(failedOrSkipped).toEqual([])
    expect(report.modules.find((m) => m.id === "agents")?.agents.length).toBe(10)
    expect(host.commands.doctor).toBeDefined()
    expect(host.tools["swarmos.doctor"]).toBeDefined()
  })

  it("marks modules skipped with the missing capability instead of failing silently", async () => {
    const host = createMockHost(tmpDir, ["permission", "skill"])
    const report = await SwarmOSPlugin.setup(host.ctx)

    const guard = report.modules.find((m) => m.id === "permission-guard")!
    expect(guard.status).toBe("skipped")
    expect(guard.detail).toContain("permission.hook")
    expect(report.host.find((h) => h.id === "permission.hook")?.present).toBe(false)

    const text = buildDoctorText(tmpDir)
    expect(text).toContain("Host contract: BROKEN")
    expect(text).toContain("permission.hook")
  })

  it("isolates a module that throws and keeps registering the rest", async () => {
    const host = createMockHost(tmpDir)
    const report: SetupReport = { version: "test", mode: "full", rootDir: tmpDir, startedAt: "", host: probeHost(host.ctx), modules: [] }
    await runSetupModules(
      host.ctx,
      [
        { id: "boom", requires: [], run: () => { throw new Error("kaboom") } },
        { id: "ok", requires: ["command.transform"], run: (c) => c.command.transform((e: any) => e.add({ name: "x" })) },
      ],
      report,
    )
    expect(report.modules[0]).toMatchObject({ id: "boom", status: "failed", detail: "kaboom" })
    expect(report.modules[1]).toMatchObject({ id: "ok", status: "registered", commands: ["x"] })
  })

  it("catches exceptions thrown inside hook handlers and records them", async () => {
    const host = createMockHost(tmpDir)
    const report: SetupReport = { version: "test", mode: "full", rootDir: tmpDir, startedAt: "", host: probeHost(host.ctx), modules: [] }
    await runSetupModules(
      host.ctx,
      [{ id: "bad-hook", requires: ["tool.hook"], run: (c) => c.tool.hook("execute.after", async () => { throw new Error("hook bug") }) }],
      report,
    )
    await host.fire("tool.execute.after", { tool: "edit", status: "completed" })
    expect(report.modules[0].runtimeErrors[0]).toMatchObject({ hook: "tool.execute.after", message: "hook bug" })
  })

  it("observe mode registers only telemetry and doctor (benchmark baseline)", async () => {
    await fs.mkdir(path.join(tmpDir, ".opencode"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, ".opencode", "swarmos.json"), JSON.stringify({ mode: "observe" }))
    const host = createMockHost(tmpDir)
    const report = await SwarmOSPlugin.setup(host.ctx)

    expect(report.mode).toBe("observe")
    expect(report.modules.map((m) => m.id)).toEqual(["telemetry", "doctor"])
    expect(Object.keys(host.agents)).toEqual([])
    expect(host.hooks["permission.evaluate"]).toBeUndefined()
  })

  it("applies SWARMOS_* environment overrides over the config file", async () => {
    const config = await loadConfig(tmpDir, { SWARMOS_MODE: "observe", SWARMOS_CONTEXT_BUDGET: "1200", SWARMOS_PINNED: "org, fs" })
    expect(config.mode).toBe("observe")
    expect(config.contextBudgetTokens).toBe(1200)
    expect(config.pinnedNamespaces).toEqual(["org", "fs"])
  })

  it("writes per-session telemetry and summarizes tool failures, breaker fires and token usage", async () => {
    const host = createMockHost(tmpDir)
    await SwarmOSPlugin.setup(host.ctx)

    await host.fire("session.generate", { sessionID: "s1", agent: "build", system: [], usage: { input: 900, output: 100, cacheRead: 100 } })
    await host.fire("tool.execute.after", { sessionID: "s1", tool: "read", status: "completed", input: { path: "a.ts" }, result: { content: "x" } })
    await host.fire("tool.execute.after", { sessionID: "s1", tool: "shell", status: "error", input: { command: "bun test" }, error: { message: "exit 1" } })

    const records = await readTelemetryFile(path.join(tmpDir, ".opencode", "telemetry", "s1.jsonl"))
    const summary = summarizeTelemetry(records)
    expect(summary.turns).toBe(1)
    expect(summary.toolCalls).toBe(2)
    expect(summary.toolFailures).toBe(1)
    expect(summary.tokens).toEqual({ input: 900, output: 100, cacheRead: 100 })
    expect(summary.cacheHitRatio).toBe(0.1)
    expect(buildDoctorText(tmpDir)).toContain("`s1`")
  })

  it("static contract check finds hook literals and flags missing ones", async () => {
    const src = path.join(tmpDir, "opencode-src")
    await fs.mkdir(src, { recursive: true })
    await fs.writeFile(
      path.join(src, "internal.ts"),
      [
        'hook("execute.after"); hook("execute.before"); hook("evaluate"); hook("context")',
        "const api = { transform, switchAgent, permissions, codemode, pinned, directory, agentID, delivery, terminal }",
      ].join("\n"),
    )
    const report = await checkHostContract(src)
    expect(report.ok).toBe(false)
    const sessionHook = report.capabilities.find((c) => c.id === "session.hook")!
    expect(sessionHook.ok).toBe(false)
    expect(sessionHook.evidence.find((e) => e.evidence === '"generate"')?.found).toBe(false)
    expect(report.capabilities.find((c) => c.id === "tool.hook")?.ok).toBe(true)
  })

  it("matches the pinned OpenCode V2 (v2.0.26) host contract source", async () => {
    const targetSrc = process.env.OPENCODE_V2_SRC ?? path.resolve(import.meta.dir, "fixtures/opencode-v2-ref")
    const report = await checkHostContract(targetSrc)
    const failures = report.capabilities.filter((c) => c.required && !c.ok).map((c) => c.id)
    expect(failures).toEqual([])
    expect(HOST_CONTRACT.length).toBeGreaterThan(0)
  })
})
