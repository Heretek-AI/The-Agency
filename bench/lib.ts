import { exec, execFileSync } from "node:child_process"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  readTelemetryFile,
  summarizeTelemetry,
  type TelemetryRecord,
} from "../src/host/telemetry.js"

export const BENCH_DIR = path.dirname(new URL(import.meta.url).pathname)
export const TASKS_DIR = path.join(BENCH_DIR, "tasks")
export const REPO_ROOT = path.resolve(BENCH_DIR, "..")

export type Variant = "swarmos" | "baseline"

export interface BenchTask {
  id: string
  category: "bug" | "refactor" | "constraints" | "ui" | string
  title: string
  prompt: string
  /** Command run from the workspace root after hidden tests are copied into `__hidden__/`. */
  verify: string
  timeoutSec: number
  dir: string
}

export interface DriverResult {
  exitCode: number
  durationMs: number
  output: string
}

export interface Driver {
  name: string
  run(task: BenchTask, workdir: string, variant: Variant): Promise<DriverResult>
}

export interface AggregatedTelemetry {
  sessions: number
  turns: number
  toolCalls: number
  toolFailures: number
  breakerFires: number
  tokens: { input: number; output: number; cacheRead: number } | null
  cacheHitRatio: number | null
}

export interface BenchResult {
  taskId: string
  category: string
  variant: Variant
  driver: string
  repeat: number
  success: boolean
  verifyExitCode: number
  agentExitCode: number
  durationMs: number
  telemetry: AggregatedTelemetry
  verifyTail: string
}

export async function loadTasks(filter?: string[], tasksDir = TASKS_DIR): Promise<BenchTask[]> {
  const entries = await fs.readdir(tasksDir, { withFileTypes: true })
  const tasks: BenchTask[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = path.join(tasksDir, e.name)
    const raw = JSON.parse(await fs.readFile(path.join(dir, "task.json"), "utf8"))
    if (filter?.length && !filter.includes(raw.id)) continue
    tasks.push({ timeoutSec: 600, ...raw, dir })
  }
  return tasks.sort((a, b) => a.id.localeCompare(b.id))
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, { recursive: true })
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function sh(command: string, cwd: string, timeoutMs: number, env: Record<string, string> = {}): Promise<DriverResult> {
  const started = Date.now()
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } }, (err: any, stdout, stderr) => {
      resolve({
        exitCode: err ? (typeof err.code === "number" ? err.code : 1) : 0,
        durationMs: Date.now() - started,
        output: `${stdout ?? ""}${stderr ?? ""}`,
      })
    })
  })
}

/**
 * Copies a task's starting repo into a fresh git workspace and writes the variant's SwarmOS
 * config. The baseline still loads SwarmOS, in observe mode, so both variants produce telemetry.
 */
export async function prepareWorkspace(task: BenchTask, variant: Variant, pluginPath?: string): Promise<string> {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), `swarmos-bench-${task.id}-`))
  await copyDir(path.join(task.dir, "repo"), workdir)
  await fs.writeFile(path.join(workdir, ".gitignore"), ".opencode/telemetry/\n.opencode/verify/\nnode_modules/\n__pycache__/\n")
  await fs.mkdir(path.join(workdir, ".opencode"), { recursive: true })
  await fs.writeFile(
    path.join(workdir, ".opencode", "swarmos.json"),
    JSON.stringify({ mode: variant === "swarmos" ? "full" : "observe" }, null, 2),
  )
  if (pluginPath) {
    await fs.writeFile(
      path.join(workdir, "opencode.json"),
      JSON.stringify({ plugins: [pluginPath], experimental: { subagent_depth: 4 } }, null, 2),
    )
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: workdir, stdio: "pipe" })
  git("init", "-q")
  git("config", "user.email", "bench@swarmos.local")
  git("config", "user.name", "SwarmOS Bench")
  git("add", "-A")
  git("commit", "-qm", "task start")
  return workdir
}

/** Copies hidden tests in after the agent finishes and runs the task's verifier. */
export async function verifyWorkspace(task: BenchTask, workdir: string): Promise<DriverResult> {
  const hidden = path.join(task.dir, "hidden")
  const target = path.join(workdir, "__hidden__")
  await fs.rm(target, { recursive: true, force: true })
  if (await exists(hidden)) await copyDir(hidden, target)
  return sh(task.verify, workdir, 120_000, { CI: "1", NO_COLOR: "1" })
}

export async function aggregateTelemetry(workdir: string): Promise<AggregatedTelemetry> {
  const dir = path.join(workdir, ".opencode", "telemetry")
  let files: string[] = []
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f))
  } catch {
    // no telemetry
  }
  const agg: AggregatedTelemetry = { sessions: 0, turns: 0, toolCalls: 0, toolFailures: 0, breakerFires: 0, tokens: null, cacheHitRatio: null }
  for (const file of files) {
    const records: TelemetryRecord[] = await readTelemetryFile(file)
    const s = summarizeTelemetry(records)
    agg.sessions++
    agg.turns += s.turns
    agg.toolCalls += s.toolCalls
    agg.toolFailures += s.toolFailures
    agg.breakerFires += s.breakerFires
    if (s.tokens) {
      agg.tokens ??= { input: 0, output: 0, cacheRead: 0 }
      agg.tokens.input += s.tokens.input
      agg.tokens.output += s.tokens.output
      agg.tokens.cacheRead += s.tokens.cacheRead
    }
  }
  if (agg.tokens && agg.tokens.input + agg.tokens.cacheRead > 0) {
    agg.cacheHitRatio = +(agg.tokens.cacheRead / (agg.tokens.input + agg.tokens.cacheRead)).toFixed(4)
  }
  return agg
}

/** Applies the task's reference solution: proves the task is solvable and its verifier accepts a fix. */
export const referenceDriver: Driver = {
  name: "reference",
  async run(task, workdir) {
    const started = Date.now()
    await copyDir(path.join(task.dir, "solution"), workdir)
    return { exitCode: 0, durationMs: Date.now() - started, output: "applied reference solution" }
  },
}

/** Does nothing: proves the task's verifier fails on the untouched starting repo. */
export const noopDriver: Driver = {
  name: "noop",
  async run() {
    return { exitCode: 0, durationMs: 0, output: "" }
  },
}

/**
 * Runs a real agent. The command template comes from BENCH_AGENT_CMD (default
 * `opencode run "$BENCH_PROMPT"`); the prompt is passed through the BENCH_PROMPT env var.
 */
export function agentDriver(command = process.env.BENCH_AGENT_CMD ?? 'opencode run "$BENCH_PROMPT"'): Driver {
  return {
    name: "agent",
    run(task, workdir, variant) {
      return sh(command, workdir, task.timeoutSec * 1000, {
        BENCH_PROMPT: task.prompt,
        BENCH_TASK_ID: task.id,
        BENCH_VARIANT: variant,
        SWARMOS_MODE: variant === "swarmos" ? "full" : "observe",
      })
    },
  }
}

export interface RunBenchOptions {
  tasks: BenchTask[]
  variants: Variant[]
  driver: Driver
  repeat?: number
  pluginPath?: string
  keepWorkspaces?: boolean
  onResult?: (r: BenchResult) => void
}

export async function runBench(opts: RunBenchOptions): Promise<BenchResult[]> {
  const results: BenchResult[] = []
  for (const task of opts.tasks) {
    for (const variant of opts.variants) {
      for (let repeat = 1; repeat <= (opts.repeat ?? 1); repeat++) {
        const workdir = await prepareWorkspace(task, variant, opts.pluginPath)
        try {
          const agent = await opts.driver.run(task, workdir, variant)
          const verify = await verifyWorkspace(task, workdir)
          const result: BenchResult = {
            taskId: task.id,
            category: task.category,
            variant,
            driver: opts.driver.name,
            repeat,
            success: verify.exitCode === 0,
            verifyExitCode: verify.exitCode,
            agentExitCode: agent.exitCode,
            durationMs: agent.durationMs,
            telemetry: await aggregateTelemetry(workdir),
            verifyTail: verify.output.split("\n").filter((l) => l.trim()).slice(-15).join("\n"),
          }
          results.push(result)
          opts.onResult?.(result)
        } finally {
          if (!opts.keepWorkspaces) await fs.rm(workdir, { recursive: true, force: true })
        }
      }
    }
  }
  return results
}

export interface VariantSummary {
  variant: Variant
  runs: number
  successRate: number
  meanTurns: number | null
  meanToolCalls: number | null
  toolFailureRate: number | null
  breakerFires: number
  meanTokens: number | null
  cacheHitRatio: number | null
  meanDurationMs: number
  byCategory: Record<string, { runs: number; successRate: number }>
}

const mean = (xs: number[]) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null)

export function summarize(results: BenchResult[]): VariantSummary[] {
  const variants = [...new Set(results.map((r) => r.variant))]
  return variants.map((variant) => {
    const rs = results.filter((r) => r.variant === variant)
    const withTelemetry = rs.filter((r) => r.telemetry.sessions > 0)
    const calls = withTelemetry.reduce((a, r) => a + r.telemetry.toolCalls, 0)
    const failures = withTelemetry.reduce((a, r) => a + r.telemetry.toolFailures, 0)
    const withTokens = rs.filter((r) => r.telemetry.tokens)
    const tokIn = withTokens.reduce((a, r) => a + r.telemetry.tokens!.input, 0)
    const tokCache = withTokens.reduce((a, r) => a + r.telemetry.tokens!.cacheRead, 0)
    const byCategory: VariantSummary["byCategory"] = {}
    for (const cat of [...new Set(rs.map((r) => r.category))]) {
      const c = rs.filter((r) => r.category === cat)
      byCategory[cat] = { runs: c.length, successRate: +(c.filter((r) => r.success).length / c.length).toFixed(4) }
    }
    return {
      variant,
      runs: rs.length,
      successRate: rs.length ? +(rs.filter((r) => r.success).length / rs.length).toFixed(4) : 0,
      meanTurns: mean(withTelemetry.map((r) => r.telemetry.turns)),
      meanToolCalls: mean(withTelemetry.map((r) => r.telemetry.toolCalls)),
      toolFailureRate: calls > 0 ? +(failures / calls).toFixed(4) : null,
      breakerFires: rs.reduce((a, r) => a + r.telemetry.breakerFires, 0),
      meanTokens: mean(withTokens.map((r) => r.telemetry.tokens!.input + r.telemetry.tokens!.output + r.telemetry.tokens!.cacheRead)),
      cacheHitRatio: tokIn + tokCache > 0 ? +(tokCache / (tokIn + tokCache)).toFixed(4) : null,
      meanDurationMs: mean(rs.map((r) => r.durationMs)) ?? 0,
      byCategory,
    }
  })
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`)
const num = (x: number | null) => (x === null ? "n/a" : String(x))

export function formatReport(results: BenchResult[], meta: { driver: string; startedAt: string }): string {
  const summaries = summarize(results)
  const categories = [...new Set(results.map((r) => r.category))].sort()
  const taskIds = [...new Set(results.map((r) => r.taskId))].sort()
  const variants = summaries.map((s) => s.variant)

  return [
    `# SwarmOS Benchmark (${meta.driver} driver, ${meta.startedAt})`,
    "",
    "| Variant | Runs | Success | Mean turns | Mean tool calls | Tool failure rate | Breaker fires | Mean tokens | Cache hit | Mean time |",
    "| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summaries.map(
      (s) =>
        `| ${s.variant} | ${s.runs} | ${pct(s.successRate)} | ${num(s.meanTurns)} | ${num(s.meanToolCalls)} | ${pct(s.toolFailureRate)} | ${s.breakerFires} | ${num(s.meanTokens)} | ${pct(s.cacheHitRatio)} | ${(s.meanDurationMs / 1000).toFixed(1)}s |`,
    ),
    "",
    "## Success by category",
    `| Category | ${variants.join(" | ")} |`,
    `| :--- | ${variants.map(() => "---:").join(" | ")} |`,
    ...categories.map((c) => `| ${c} | ${summaries.map((s) => (s.byCategory[c] ? pct(s.byCategory[c].successRate) : "-")).join(" | ")} |`),
    "",
    "## Per task",
    `| Task | ${variants.join(" | ")} |`,
    `| :--- | ${variants.map(() => ":---:").join(" | ")} |`,
    ...taskIds.map((id) => {
      const cells = variants.map((v) => {
        const rs = results.filter((r) => r.taskId === id && r.variant === v)
        return rs.length ? `${rs.filter((r) => r.success).length}/${rs.length}` : "-"
      })
      return `| ${id} | ${cells.join(" | ")} |`
    }),
    "",
    "_Token and cache metrics appear only when the host reports usage on `session.generate` events._",
  ].join("\n")
}
