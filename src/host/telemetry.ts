import { execFile } from "node:child_process"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { promisify } from "node:util"
import { eventTargetPath, getSessionState, isFailedEvent, touchFile } from "./session-state.js"

const execFileAsync = promisify(execFile)

export interface TelemetryRecord {
  t: string
  kind: "session_start" | "tool" | "turn"
  sessionID: string
  agent?: string
  tool?: string
  status?: "completed" | "error"
  target?: string
  error?: string
  breaker?: boolean
  usage?: { input?: number; output?: number; cacheRead?: number }
  gitHead?: string
  prompt?: string
}

export interface TelemetrySummary {
  sessionID: string
  turns: number
  toolCalls: number
  toolFailures: number
  breakerFires: number
  tokens: { input: number; output: number; cacheRead: number } | null
  cacheHitRatio: number | null
  gitHead?: string
  prompt?: string
}

export function getTelemetryDir(rootDir: string): string {
  return path.join(rootDir, ".opencode", "telemetry")
}

function safeSessionFile(sessionID: string): string {
  return `${sessionID.replace(/[^A-Za-z0-9_.-]/g, "_") || "default"}.jsonl`
}

const writeQueues = new Map<string, Promise<void>>()

export async function appendTelemetry(rootDir: string, record: TelemetryRecord): Promise<void> {
  const file = path.join(getTelemetryDir(rootDir), safeSessionFile(record.sessionID))
  const previous = writeQueues.get(file) ?? Promise.resolve()
  const next = previous.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8")
  })
  writeQueues.set(
    file,
    next.catch(() => {}),
  )
  await next
}

async function gitHead(rootDir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: rootDir, timeout: 3000 })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

function extractUsage(event: any): TelemetryRecord["usage"] | undefined {
  const u = event?.usage ?? event?.tokens ?? event?.result?.usage
  if (!u || typeof u !== "object") return undefined
  const input = Number(u.input ?? u.inputTokens ?? u.prompt_tokens)
  const output = Number(u.output ?? u.outputTokens ?? u.completion_tokens)
  const cacheRead = Number(u.cacheRead ?? u.cache?.read ?? u.cache_read_input_tokens)
  const usage: TelemetryRecord["usage"] = {}
  if (Number.isFinite(input)) usage.input = input
  if (Number.isFinite(output)) usage.output = output
  if (Number.isFinite(cacheRead)) usage.cacheRead = cacheRead
  return Object.keys(usage).length ? usage : undefined
}

function lastUserText(event: any): string | undefined {
  const messages = event?.messages
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== "user") continue
    if (typeof m.content === "string") return m.content
    if (Array.isArray(m.content)) {
      const text = m.content.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("")
      if (text) return text
    }
    if (typeof m.text === "string") return m.text
  }
  return undefined
}

const startedSessions = new Set<string>()

async function ensureSessionStart(rootDir: string, sessionID: string, agent?: string, prompt?: string): Promise<void> {
  if (startedSessions.has(sessionID)) return
  startedSessions.add(sessionID)
  await appendTelemetry(rootDir, {
    t: new Date().toISOString(),
    kind: "session_start",
    sessionID,
    agent,
    gitHead: await gitHead(rootDir),
    prompt: prompt?.slice(0, 4000),
  })
}

/** Updates in-memory session state for a finished tool call (used even when telemetry files are off). */
export function trackToolEvent(event: any): { breaker: boolean } {
  const state = getSessionState(event?.sessionID)
  if (event?.agent) state.agent = event.agent
  state.toolCalls++
  if (isFailedEvent(event)) state.toolFailures++
  const target = eventTargetPath(event)
  if (target) touchFile(state, target)

  const text =
    typeof event?.result?.content === "string"
      ? event.result.content
      : Array.isArray(event?.result?.content)
        ? event.result.content.map((p: any) => p?.text ?? "").join("")
        : String(event?.error?.message ?? "")
  const breaker = text.includes("DOOM-LOOP CIRCUIT BREAKER")
  if (breaker) state.breakerFires++
  return { breaker }
}

export async function registerTelemetryHooks(ctx: any, rootDir: string, writeFiles: boolean): Promise<void> {
  if (ctx.tool?.hook) {
    await ctx.tool.hook("execute.after", async (event: any) => {
      const sessionID = event?.sessionID ?? "default"
      const { breaker } = trackToolEvent(event)
      if (!writeFiles) return
      await ensureSessionStart(rootDir, sessionID, event?.agent)
      await appendTelemetry(rootDir, {
        t: new Date().toISOString(),
        kind: "tool",
        sessionID,
        agent: event?.agent,
        tool: event?.tool,
        status: event?.status,
        target: eventTargetPath(event) ?? (typeof event?.input?.command === "string" ? event.input.command.slice(0, 120) : undefined),
        error: isFailedEvent(event) ? String(event?.error?.message ?? event?.error ?? "").slice(0, 300) : undefined,
        breaker: breaker || undefined,
      })
    })
  }

  if (ctx.session?.hook) {
    await ctx.session.hook("generate", async (event: any) => {
      if (event?.agent === "compaction" || event?.kind === "compaction") return
      const sessionID = event?.sessionID ?? "default"
      const state = getSessionState(sessionID)
      state.turns++
      if (event?.agent) state.agent = event.agent
      if (!writeFiles) return
      await ensureSessionStart(rootDir, sessionID, event?.agent, lastUserText(event))
      await appendTelemetry(rootDir, {
        t: new Date().toISOString(),
        kind: "turn",
        sessionID,
        agent: event?.agent,
        usage: extractUsage(event),
      })
    })
  }
}

export function summarizeTelemetry(records: TelemetryRecord[]): TelemetrySummary {
  const start = records.find((r) => r.kind === "session_start")
  let input = 0
  let output = 0
  let cacheRead = 0
  let sawUsage = false
  const summary: TelemetrySummary = {
    sessionID: records[0]?.sessionID ?? "unknown",
    turns: 0,
    toolCalls: 0,
    toolFailures: 0,
    breakerFires: 0,
    tokens: null,
    cacheHitRatio: null,
    gitHead: start?.gitHead,
    prompt: start?.prompt,
  }
  for (const r of records) {
    if (r.kind === "turn") {
      summary.turns++
      if (r.usage) {
        sawUsage = true
        input += r.usage.input ?? 0
        output += r.usage.output ?? 0
        cacheRead += r.usage.cacheRead ?? 0
      }
    } else if (r.kind === "tool") {
      summary.toolCalls++
      if (r.status === "error") summary.toolFailures++
      if (r.breaker) summary.breakerFires++
    }
  }
  if (sawUsage) {
    summary.tokens = { input, output, cacheRead }
    summary.cacheHitRatio = input + cacheRead > 0 ? +(cacheRead / (input + cacheRead)).toFixed(4) : null
  }
  return summary
}

export async function readTelemetryFile(file: string): Promise<TelemetryRecord[]> {
  const raw = await fs.readFile(file, "utf8")
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as TelemetryRecord]
      } catch {
        return []
      }
    })
}

export async function listTelemetryFiles(rootDir: string): Promise<string[]> {
  try {
    const dir = getTelemetryDir(rootDir)
    const entries = await fs.readdir(dir)
    return entries.filter((e) => e.endsWith(".jsonl")).map((e) => path.join(dir, e))
  } catch {
    return []
  }
}
