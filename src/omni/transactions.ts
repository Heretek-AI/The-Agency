import * as fs from "node:fs/promises"
import * as path from "node:path"
import { createCheckpoint, getCheckpointsDir } from "./checkpoints.js"

/**
 * All-or-nothing edits: before every edit/write/patch call SwarmOS snapshots the files the
 * call will touch; if the call fails, every one of them is restored. Multi-file calls are also
 * saved as `auto-*` checkpoints so they can be rolled back by hand afterwards.
 */

interface FileSnapshot {
  rel: string
  existed: boolean
  content?: Buffer
}

interface Transaction {
  tool: string
  snapshots: FileSnapshot[]
  checkpointId?: string
}

const MUTATING_TOOLS = new Set(["edit", "write", "patch", "multiedit", "apply_patch"])
const MAX_AUTO_CHECKPOINTS = 20

const byCallId = new Map<string, Transaction>()
const bySessionTool = new Map<string, Transaction[]>()

export const transactionStats = { started: 0, committed: 0, rolledBack: 0, filesRestored: 0 }

export function resetTransactions(): void {
  byCallId.clear()
  bySessionTool.clear()
  Object.assign(transactionStats, { started: 0, committed: 0, rolledBack: 0, filesRestored: 0 })
}

function callId(event: any): string | undefined {
  const id = event?.callID ?? event?.toolCallID ?? event?.callId ?? event?.id
  return typeof id === "string" && id ? id : undefined
}

function sessionToolKey(event: any): string {
  return `${event?.sessionID ?? "default"}:${event?.tool ?? ""}`
}

function patchText(input: any): string | undefined {
  for (const key of ["patchText", "patch", "input", "diff", "content"]) {
    if (typeof input?.[key] === "string" && /\*\*\* (Begin Patch|Update File|Add File)|^(\+\+\+|---) /m.test(input[key])) {
      return input[key]
    }
  }
  return undefined
}

/** Files a mutating tool call will touch, from its input. */
export function mutationTargets(tool: string, input: any): string[] {
  const targets = new Set<string>()
  for (const key of ["path", "filePath", "file", "target"]) {
    if (typeof input?.[key] === "string" && input[key]) targets.add(input[key])
  }
  if (Array.isArray(input?.edits)) {
    for (const e of input.edits) if (typeof e?.path === "string") targets.add(e.path)
  }
  const text = patchText(input)
  if (text) {
    for (const m of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) targets.add(m[1].trim())
    for (const m of text.matchAll(/^\*\*\* Move to: (.+)$/gm)) targets.add(m[1].trim())
    for (const m of text.matchAll(/^(?:\+\+\+|---) (?:[ab]\/)?(.+?)(?:\t.*)?$/gm)) {
      if (m[1] !== "/dev/null") targets.add(m[1].trim())
    }
  }
  return [...targets]
}

async function snapshot(rootDir: string, rawPath: string): Promise<FileSnapshot | undefined> {
  const abs = path.resolve(rootDir, rawPath)
  const rel = path.relative(rootDir, abs).split(path.sep).join("/")
  if (rel.startsWith("..")) return undefined
  try {
    return { rel, existed: true, content: await fs.readFile(abs) }
  } catch (err: any) {
    if (err?.code === "ENOENT") return { rel, existed: false }
    return undefined
  }
}

async function pruneAutoCheckpoints(rootDir: string): Promise<void> {
  try {
    const dir = getCheckpointsDir(rootDir)
    const autos = (await fs.readdir(dir)).filter((f) => f.startsWith("auto-") && f.endsWith(".json")).sort()
    for (const f of autos.slice(0, Math.max(0, autos.length - MAX_AUTO_CHECKPOINTS))) {
      await fs.rm(path.join(dir, f), { force: true })
    }
  } catch {
    // nothing to prune
  }
}

export async function beginTransaction(rootDir: string, event: any): Promise<Transaction | undefined> {
  if (!MUTATING_TOOLS.has(event?.tool)) return undefined
  const targets = mutationTargets(event.tool, event.input)
  if (targets.length === 0) return undefined

  const snapshots = (await Promise.all(targets.map((t) => snapshot(rootDir, t)))).filter((s): s is FileSnapshot => Boolean(s))
  if (snapshots.length === 0) return undefined

  const tx: Transaction = { tool: event.tool, snapshots }
  if (snapshots.length > 1) {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "")
    const cp = await createCheckpoint(rootDir, {
      id: `auto-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
      label: `before ${event.tool} of ${snapshots.length} files`,
      paths: snapshots.map((s) => s.rel),
    })
    tx.checkpointId = cp.id
    await pruneAutoCheckpoints(rootDir)
  }

  const id = callId(event)
  if (id) byCallId.set(id, tx)
  else {
    const key = sessionToolKey(event)
    const stack = bySessionTool.get(key) ?? []
    stack.push(tx)
    bySessionTool.set(key, stack)
  }
  transactionStats.started++
  return tx
}

function takeTransaction(event: any): Transaction | undefined {
  const id = callId(event)
  if (id && byCallId.has(id)) {
    const tx = byCallId.get(id)
    byCallId.delete(id)
    return tx
  }
  const stack = bySessionTool.get(sessionToolKey(event))
  return stack?.pop()
}

async function restore(rootDir: string, tx: Transaction): Promise<string[]> {
  const restored: string[] = []
  for (const s of tx.snapshots) {
    const abs = path.resolve(rootDir, s.rel)
    let current: Buffer | undefined
    try {
      current = await fs.readFile(abs)
    } catch {
      current = undefined
    }
    if (s.existed) {
      if (current && s.content && current.equals(s.content)) continue
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, s.content!)
      restored.push(s.rel)
    } else if (current !== undefined) {
      await fs.rm(abs, { force: true })
      restored.push(s.rel)
    }
  }
  return restored
}

/** Restores every snapshotted file if the call failed. Returns a note for the model, if any. */
export async function finishTransaction(rootDir: string, event: any): Promise<string | undefined> {
  if (!MUTATING_TOOLS.has(event?.tool)) return undefined
  const tx = takeTransaction(event)
  if (!tx) return undefined
  if (event.status !== "error") {
    transactionStats.committed++
    return undefined
  }
  const restored = await restore(rootDir, tx)
  transactionStats.rolledBack++
  transactionStats.filesRestored += restored.length
  if (restored.length === 0) return undefined
  return (
    `\n\n<swarmos-transaction status="rolled-back">\n` +
    `The ${tx.tool} call failed part-way, so SwarmOS restored ${restored.length} file(s) to their state before the call: ${restored.join(", ")}. ` +
    `Nothing from this call was applied; re-read the files before retrying.\n</swarmos-transaction>`
  )
}

export async function registerTransactionHooks(ctx: any, rootDir: string): Promise<void> {
  if (!ctx.tool?.hook) return
  await ctx.tool.hook("execute.before", async (event: any) => {
    await beginTransaction(rootDir, event)
  })
  await ctx.tool.hook("execute.after", async (event: any) => {
    const note = await finishTransaction(rootDir, event)
    if (!note) return
    if (event.error && typeof event.error === "object" && typeof event.error.message === "string") {
      event.error.message += note
    } else if (typeof event.error === "string") {
      event.error += note
    }
  })
}
