#!/usr/bin/env bun
/**
 * SwarmOS benchmark runner.
 *
 *   bun bench/run.ts --driver reference              # check every task is solvable (expects 100%)
 *   bun bench/run.ts --driver noop                   # check no task passes untouched (expects 0%)
 *   bun bench/run.ts --driver agent --repeat 3       # real runs: SwarmOS vs observe-only baseline
 *
 * Options: --tasks id1,id2  --variants swarmos,baseline  --repeat N  --plugin <path>  --keep  --out <dir>
 * The agent driver runs BENCH_AGENT_CMD (default: opencode run "$BENCH_PROMPT") in each workspace.
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
  BENCH_DIR,
  REPO_ROOT,
  agentDriver,
  formatReport,
  loadTasks,
  noopDriver,
  referenceDriver,
  runBench,
  type Driver,
  type Variant,
} from "./lib.js"

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

const driverName = arg("driver") ?? "reference"
const drivers: Record<string, () => Driver> = {
  reference: () => referenceDriver,
  noop: () => noopDriver,
  agent: () => agentDriver(),
}
if (!drivers[driverName]) {
  console.error(`Unknown driver "${driverName}". Use one of: ${Object.keys(drivers).join(", ")}`)
  process.exit(2)
}

const variants = (arg("variants") ?? (driverName === "agent" ? "swarmos,baseline" : "swarmos"))
  .split(",")
  .map((v) => v.trim()) as Variant[]
const tasks = await loadTasks(arg("tasks")?.split(","))
const pluginPath = driverName === "agent" ? path.resolve(arg("plugin") ?? path.join(REPO_ROOT, "swarmos-plugin.ts")) : undefined
const startedAt = new Date().toISOString()

console.log(`Running ${tasks.length} task(s) x ${variants.length} variant(s) with the ${driverName} driver`)
const results = await runBench({
  tasks,
  variants,
  driver: drivers[driverName](),
  repeat: Number(arg("repeat") ?? 1),
  pluginPath,
  keepWorkspaces: process.argv.includes("--keep"),
  onResult: (r) =>
    console.log(`${r.success ? "PASS" : "FAIL"} ${r.taskId} [${r.variant}#${r.repeat}] ${(r.durationMs / 1000).toFixed(1)}s`),
})

const report = formatReport(results, { driver: driverName, startedAt })
const outDir = path.resolve(arg("out") ?? path.join(BENCH_DIR, "results"))
await fs.mkdir(outDir, { recursive: true })
const stamp = startedAt.replace(/[:.]/g, "-")
await fs.writeFile(path.join(outDir, `${stamp}-${driverName}.json`), JSON.stringify({ startedAt, driver: driverName, results }, null, 2))
await fs.writeFile(path.join(outDir, `${stamp}-${driverName}.md`), report)
console.log(`\n${report}\n\nSaved to ${outDir}`)
