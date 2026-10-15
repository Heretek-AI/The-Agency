import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
  getTelemetryDir,
  listTelemetryFiles,
  readTelemetryFile,
  summarizeTelemetry,
  type TelemetryRecord,
  type TelemetrySummary,
} from "../host/telemetry.js"
import { discoverChecks } from "./verify.js"

/**
 * Session Replay Engine:
 * 1. Scans recorded `.opencode/telemetry/*.jsonl` sessions and identifies sessions with tool failures
 *    or circuit-breaker interventions.
 * 2. Exports any recorded session into a reproducible benchmark regression task under `bench/tasks/`
 *    (`task.json`, `repo/`, `replay-trace.json`, `solution/`).
 * 3. Deterministically replays a recorded session trace step-by-step for regression testing.
 */

export interface ReplayableSession extends TelemetrySummary {
  file: string
  hasFailures: boolean
}

export interface ExportBenchmarkInput {
  sessionID: string
  taskId?: string
  category?: string
  title?: string
  prompt?: string
  verifyCommand?: string
  outTasksDir?: string
  timeoutSec?: number
}

export interface ExportedBenchmarkTask {
  taskId: string
  taskDir: string
  taskJsonPath: string
  tracePath: string
  sourceSessionID: string
  recordCount: number
  verifyCommand: string
}

export interface ReplayStepOutcome {
  index: number
  tool: string
  target?: string
  recordedStatus: "completed" | "error"
  replayedStatus: "completed" | "error"
  breaker: boolean
  error?: string
}

export interface ReplayExecutionReport {
  sessionID: string
  totalSteps: number
  reproducedFailures: number
  breakerTriggered: number
  steps: ReplayStepOutcome[]
}

const COPY_IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  ".opencode",
  ".worktrees",
  "coverage",
  "__pycache__",
  "target",
  "bench",
])

async function copyWorkspaceSnapshot(srcDir: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true })
  let entries: import("node:fs").Dirent[] = []
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (COPY_IGNORE.has(entry.name)) continue
    const s = path.join(srcDir, entry.name)
    const d = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      await copyWorkspaceSnapshot(s, d)
    } else if (entry.isFile()) {
      await fs.copyFile(s, d)
    }
  }
}

export async function listReplayableSessions(rootDir: string): Promise<ReplayableSession[]> {
  const files = await listTelemetryFiles(rootDir)
  const results: ReplayableSession[] = []
  for (const file of files) {
    const records = await readTelemetryFile(file)
    if (records.length === 0) continue
    const summary = summarizeTelemetry(records)
    results.push({
      ...summary,
      file,
      hasFailures: summary.toolFailures > 0 || summary.breakerFires > 0,
    })
  }
  return results.sort((a, b) => Number(b.hasFailures) - Number(a.hasFailures) || b.toolFailures - a.toolFailures)
}

export async function loadSessionTelemetry(rootDir: string, sessionID: string): Promise<TelemetryRecord[]> {
  const safe = `${sessionID.replace(/[^A-Za-z0-9_.-]/g, "_") || "default"}.jsonl`
  const direct = path.join(getTelemetryDir(rootDir), safe)
  try {
    return await readTelemetryFile(direct)
  } catch {
    const files = await listTelemetryFiles(rootDir)
    for (const f of files) {
      const records = await readTelemetryFile(f)
      if (records.some((r) => r.sessionID === sessionID)) return records
    }
    return []
  }
}

export async function exportSessionToBenchmark(
  rootDir: string,
  input: ExportBenchmarkInput,
): Promise<ExportedBenchmarkTask> {
  const records = await loadSessionTelemetry(rootDir, input.sessionID)
  if (records.length === 0) {
    throw new Error(`SwarmOS Replay: no telemetry records found for session "${input.sessionID}".`)
  }
  const summary = summarizeTelemetry(records)
  const slug = (input.taskId ?? `replay-${input.sessionID}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")

  const outTasksDir = input.outTasksDir ? path.resolve(rootDir, input.outTasksDir) : path.join(rootDir, "bench", "tasks")
  const taskDir = path.join(outTasksDir, slug)
  const repoDir = path.join(taskDir, "repo")
  const solutionDir = path.join(taskDir, "solution")

  await fs.rm(taskDir, { recursive: true, force: true })
  await copyWorkspaceSnapshot(rootDir, repoDir)
  await copyWorkspaceSnapshot(rootDir, solutionDir)

  let verifyCommand = input.verifyCommand
  if (!verifyCommand) {
    const checks = await discoverChecks(rootDir)
    const testCheck = checks.find((c) => c.kind === "test") ?? checks[0]
    verifyCommand = testCheck?.command ?? "bun test"
  }

  const prompt =
    input.prompt ??
    summary.prompt ??
    `Resolve the regression reproduced from session ${input.sessionID} (${summary.toolFailures} tool failure(s), ${summary.breakerFires} circuit-breaker intervention(s)).`

  const taskMeta = {
    id: slug,
    category: input.category ?? "regression",
    title: input.title ?? `Session Replay Regression (${input.sessionID})`,
    prompt,
    verify: verifyCommand,
    timeoutSec: input.timeoutSec ?? 300,
    sourceSessionID: input.sessionID,
    ...(summary.gitHead ? { gitHead: summary.gitHead } : {}),
  }

  const taskJsonPath = path.join(taskDir, "task.json")
  const tracePath = path.join(taskDir, "replay-trace.json")
  await fs.writeFile(taskJsonPath, JSON.stringify(taskMeta, null, 2), "utf8")
  await fs.writeFile(tracePath, JSON.stringify(records, null, 2), "utf8")

  return {
    taskId: slug,
    taskDir,
    taskJsonPath,
    tracePath,
    sourceSessionID: input.sessionID,
    recordCount: records.length,
    verifyCommand,
  }
}

export async function replaySessionTrace(
  records: TelemetryRecord[],
  stepExecutor?: (record: TelemetryRecord, index: number) => Promise<{ status: "completed" | "error"; error?: string }>,
): Promise<ReplayExecutionReport> {
  const sessionID = records[0]?.sessionID ?? "replay"
  const toolRecords = records.filter((r) => r.kind === "tool")
  const steps: ReplayStepOutcome[] = []
  let reproducedFailures = 0
  let breakerTriggered = 0

  for (let idx = 0; idx < toolRecords.length; idx++) {
    const rec = toolRecords[idx]
    const recordedStatus = rec.status === "error" ? "error" : "completed"
    let replayedStatus: "completed" | "error" = recordedStatus
    let error = rec.error

    if (stepExecutor) {
      const outcome = await stepExecutor(rec, idx)
      replayedStatus = outcome.status
      error = outcome.error ?? error
    }

    if (replayedStatus === "error") reproducedFailures++
    if (rec.breaker) breakerTriggered++

    steps.push({
      index: idx + 1,
      tool: rec.tool ?? "unknown",
      ...(rec.target ? { target: rec.target } : {}),
      recordedStatus,
      replayedStatus,
      breaker: Boolean(rec.breaker),
      ...(error ? { error } : {}),
    })
  }

  return {
    sessionID,
    totalSteps: steps.length,
    reproducedFailures,
    breakerTriggered,
    steps,
  }
}

export function registerReplayTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "replay",
    description:
      "Session Replay & Regression Benchmark Exporter: inspect recorded telemetry sessions, replay tool traces, and convert failures into `bench/tasks/` regression tests.",
  })

  editor.add({
    name: "list_sessions",
    description: "List recorded telemetry sessions in `.opencode/telemetry/`, sorted with failed/circuit-breaker sessions first.",
    options: { namespace: "replay", codemode: true, pinned: false },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const sessions = await listReplayableSessions(rootDir)
      return { output: { sessions }, content: JSON.stringify(sessions, null, 2) }
    },
  })

  editor.add({
    name: "export_benchmark",
    description:
      "Export a recorded telemetry session into a reproducible benchmark regression task under `bench/tasks/<taskId>/` (`task.json`, `repo/`, `replay-trace.json`).",
    options: { namespace: "replay", codemode: true, pinned: false },
    input: {
      type: "object",
      properties: {
        sessionID: { type: "string", description: "Recorded session ID to export" },
        taskId: { type: "string", description: "Optional benchmark task ID (default 'replay-<sessionID>')" },
        category: { type: "string", description: "Benchmark category (default 'regression')" },
        title: { type: "string", description: "Human-readable title" },
        prompt: { type: "string", description: "Override task prompt" },
        verifyCommand: { type: "string", description: "Override verification command" },
        outTasksDir: { type: "string", description: "Optional output directory relative to rootDir (default 'bench/tasks')" },
      },
      required: ["sessionID"],
    },
    output: { type: "object" },
    execute: async (input: ExportBenchmarkInput) => {
      const exported = await exportSessionToBenchmark(rootDir, input)
      return {
        output: exported,
        content: `Exported session [${exported.sourceSessionID}] (${exported.recordCount} record(s)) to benchmark task [${exported.taskId}] at ${exported.taskDir}`,
      }
    },
  })

  editor.add({
    name: "replay_session",
    description: "Replay a recorded session's tool-call timeline and return its step-by-step failure and circuit-breaker report.",
    options: { namespace: "replay", codemode: true, pinned: false },
    input: {
      type: "object",
      properties: {
        sessionID: { type: "string", description: "Recorded session ID to replay" },
      },
      required: ["sessionID"],
    },
    output: { type: "object" },
    execute: async (input: { sessionID: string }) => {
      const records = await loadSessionTelemetry(rootDir, input.sessionID)
      if (records.length === 0) throw new Error(`SwarmOS Replay: session "${input.sessionID}" not found`)
      const report = await replaySessionTrace(records)
      return { output: report, content: JSON.stringify(report, null, 2) }
    },
  })
}

export async function registerReplayCommand(ctx: any, rootDir: string): Promise<void> {
  if (!ctx.command?.transform) return
  await ctx.command.transform((editor: any) => {
    editor.add({
      name: "replay",
      description: "List recorded telemetry sessions (highlighting failures/breaker fires) or export a session into bench/tasks/",
      execute: async (input: any) => {
        const arg = String(input?.prompt?.text ?? input?.prompt ?? "").trim()
        if (arg) {
          const exported = await exportSessionToBenchmark(rootDir, { sessionID: arg })
          if (ctx.session?.prompt) {
            await ctx.session.prompt({
              sessionID: input.sessionID,
              text: `Exported session \`${exported.sourceSessionID}\` to regression benchmark task \`${exported.taskId}\` (\`${exported.taskDir}\`).`,
              delivery: "steer",
            })
          }
          return
        }
        const sessions = await listReplayableSessions(rootDir)
        const lines = [
          "# SwarmOS Recorded Sessions & Replay Candidates",
          "",
          sessions.length === 0
            ? "_No recorded telemetry sessions in `.opencode/telemetry/`._"
            : "| Session | Turns | Tool calls | Failures | Breaker fires | Prompt |",
          ...(sessions.length > 0
            ? [
                "| :--- | ---: | ---: | ---: | ---: | :--- |",
                ...sessions.map(
                  (s) =>
                    `| \`${s.sessionID}\` | ${s.turns} | ${s.toolCalls} | ${s.toolFailures} | ${s.breakerFires} | ${(s.prompt ?? "-").slice(0, 60).replace(/\n/g, " ")} |`,
                ),
                "",
                "Run `/replay <sessionID>` or `tools.replay.export_benchmark({ sessionID })` to turn a session into a regression benchmark task.",
              ]
            : []),
        ]
        if (ctx.session?.prompt) {
          await ctx.session.prompt({
            sessionID: input.sessionID,
            text: lines.join("\n"),
            delivery: "steer",
          })
        }
      },
    })
  })
}
