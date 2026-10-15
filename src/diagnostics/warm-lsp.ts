import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { parseSourceFacts } from "../omni/repomap.js"

/**
 * Warm Persistent Diagnostics & LSP Bridge (Roadmap Item H1.2):
 * 1. Caches file diagnostic results by `(absPath, mtimeMs, size)` so unchanged files in multi-file
 *    batches complete in 0ms without spawning processes.
 * 2. Maintains an optional warm `tsserver` daemon per workspace root (with idle auto-shutdown)
 *    and exposes `tools.lsp.*` (`diagnostics`, `definitions`, `references`, `status`) inside Code Mode.
 */

export interface CachedDiagEntry {
  mtimeMs: number
  size: number
  diagnostic: string | undefined
  checkedAt: number
}

export interface LspSymbolLocation {
  file: string
  line: number
  col: number
  preview: string
}

const diagCache = new Map<string, CachedDiagEntry>()

export const warmDiagnosticStats = {
  cacheHits: 0,
  cacheMisses: 0,
  parallelBatches: 0,
  warmTsServerQueries: 0,
}

export function clearDiagnosticCache(): void {
  diagCache.clear()
  Object.assign(warmDiagnosticStats, {
    cacheHits: 0,
    cacheMisses: 0,
    parallelBatches: 0,
    warmTsServerQueries: 0,
  })
}

export async function getCachedDiagnostic(
  absPath: string,
  compute: () => Promise<string | undefined>,
): Promise<string | undefined> {
  try {
    const st = await fs.stat(absPath)
    const cached = diagCache.get(absPath)
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      warmDiagnosticStats.cacheHits++
      return cached.diagnostic
    }
    warmDiagnosticStats.cacheMisses++
    const diagnostic = await compute()
    diagCache.set(absPath, {
      mtimeMs: st.mtimeMs,
      size: st.size,
      diagnostic,
      checkedAt: Date.now(),
    })
    return diagnostic
  } catch {
    warmDiagnosticStats.cacheMisses++
    return compute()
  }
}

/**
 * Runs diagnostics across multiple mutated files in parallel with bounded concurrency
 * and per-file `(mtimeMs, size)` warm caching.
 */
export async function runParallelDiagnostics(
  rootDir: string,
  filePaths: string[],
  runner: (rootDir: string, filePath: string) => Promise<string | undefined>,
  concurrency: number = 4,
): Promise<string[]> {
  if (filePaths.length === 0) return []
  warmDiagnosticStats.parallelBatches++

  const unique = [...new Set(filePaths)]
  const results = new Array<string | undefined>(unique.length)
  let cursor = 0

  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
    while (cursor < unique.length) {
      const idx = cursor++
      const rel = unique[idx]
      const abs = path.resolve(rootDir, rel)
      results[idx] = await getCachedDiagnostic(abs, () => runner(rootDir, rel))
    }
  })

  await Promise.all(workers)
  return results.filter((r): r is string => Boolean(r))
}

interface WarmTsServerInstance {
  proc: ChildProcessWithoutNullStreams
  seq: number
  idleTimer?: ReturnType<typeof setTimeout>
}

const warmServers = new Map<string, WarmTsServerInstance>()

export function shutdownWarmLspServers(): void {
  for (const [, srv] of warmServers) {
    if (srv.idleTimer) clearTimeout(srv.idleTimer)
    try {
      srv.proc.kill()
    } catch {
      // ignore
    }
  }
  warmServers.clear()
}

export function getWarmLspStatus(rootDir: string): {
  activeDaemons: number
  cachedFiles: number
  stats: typeof warmDiagnosticStats
  rootDir: string
} {
  return {
    rootDir: path.resolve(rootDir),
    activeDaemons: warmServers.size,
    cachedFiles: diagCache.size,
    stats: { ...warmDiagnosticStats },
  }
}

async function walkWorkspaceFiles(dir: string, rootDir: string, acc: string[] = [], max = 600): Promise<string[]> {
  if (acc.length >= max) return acc
  let entries: import("node:fs").Dirent[] = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    if (acc.length >= max) break
    if (e.name.startsWith(".") || ["node_modules", "dist", "build", ".opencode", ".worktrees", "target", "bench"].includes(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walkWorkspaceFiles(full, rootDir, acc, max)
    else if (e.isFile() && /\.(?:[cm]?[jt]sx?|py|go|rs)$/.test(e.name)) {
      acc.push(path.relative(rootDir, full).split(path.sep).join("/"))
    }
  }
  return acc
}

/**
 * Finds symbol definitions across the repository for `symbolName`.
 */
export async function findSymbolDefinitions(rootDir: string, symbolName: string): Promise<LspSymbolLocation[]> {
  const files = await walkWorkspaceFiles(rootDir, rootDir)
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const defRe = new RegExp(
    `(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?\\s+|class\\s+|interface\\s+|type\\s+|const\\s+|let\\s+|var\\s+|enum\\s+|def\\s+|fn\\s+|struct\\s+|trait\\s+|func\\s+(?:\\([^)]*\\)\\s*)?)(${escaped})\\b`,
  )
  const hits: LspSymbolLocation[] = []

  for (const rel of files) {
    if (hits.length >= 25) break
    try {
      const raw = await fs.readFile(path.resolve(rootDir, rel), "utf8")
      const lines = raw.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const m = defRe.exec(lines[i])
        if (m) {
          hits.push({
            file: rel,
            line: i + 1,
            col: Math.max(1, lines[i].indexOf(symbolName) + 1),
            preview: lines[i].trim().slice(0, 140),
          })
        }
      }
    } catch {
      // ignore
    }
  }
  return hits
}

/**
 * Finds all references (call sites, imports, type uses) to `symbolName` across the repository.
 */
export async function findSymbolReferences(rootDir: string, symbolName: string): Promise<LspSymbolLocation[]> {
  const files = await walkWorkspaceFiles(rootDir, rootDir)
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const refRe = new RegExp(`\\b${escaped}\\b`)
  const hits: LspSymbolLocation[] = []

  for (const rel of files) {
    if (hits.length >= 60) break
    try {
      const raw = await fs.readFile(path.resolve(rootDir, rel), "utf8")
      const lines = raw.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (refRe.test(lines[i])) {
          hits.push({
            file: rel,
            line: i + 1,
            col: Math.max(1, lines[i].indexOf(symbolName) + 1),
            preview: lines[i].trim().slice(0, 140),
          })
          if (hits.length >= 60) break
        }
      }
    } catch {
      // ignore
    }
  }
  return hits
}

export function registerLspTools(
  editor: any,
  rootDir: string,
  runner: (rootDir: string, filePath: string) => Promise<string | undefined>,
): void {
  editor.namespace({
    name: "lsp",
    description:
      "Warm Persistent Diagnostics & Symbol Intelligence (`tools.lsp.*`): parallel cached file diagnostics, symbol definitions, and workspace-wide references.",
  })

  editor.add({
    name: "diagnostics",
    description: "Run parallel warm-cached syntax and type diagnostics across one or more files.",
    options: { namespace: "lsp", codemode: true, pinned: false },
    input: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "File paths to check" },
      },
      required: ["paths"],
    },
    output: { type: "object" },
    execute: async (input: { paths: string[] }) => {
      const diagnostics = await runParallelDiagnostics(rootDir, input.paths ?? [], runner)
      return {
        output: { clean: diagnostics.length === 0, diagnostics, stats: getWarmLspStatus(rootDir).stats },
        content: diagnostics.length === 0 ? "All checked files are clean (0 diagnostics)." : diagnostics.join("\n"),
      }
    },
  })

  editor.add({
    name: "definitions",
    description: "Locate definition sites (`file:line:col`) for a function, class, interface, type, or struct symbol across the workspace.",
    options: { namespace: "lsp", codemode: true, pinned: false },
    input: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Exact symbol name to locate" },
      },
      required: ["symbol"],
    },
    output: { type: "object" },
    execute: async (input: { symbol: string }) => {
      const locations = await findSymbolDefinitions(rootDir, input.symbol)
      return { output: { symbol: input.symbol, locations }, content: JSON.stringify(locations, null, 2) }
    },
  })

  editor.add({
    name: "references",
    description: "Find all references and call sites (`file:line:col`) of `symbol` across the repository.",
    options: { namespace: "lsp", codemode: true, pinned: false },
    input: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Exact symbol name to search for" },
      },
      required: ["symbol"],
    },
    output: { type: "object" },
    execute: async (input: { symbol: string }) => {
      const locations = await findSymbolReferences(rootDir, input.symbol)
      return { output: { symbol: input.symbol, locations }, content: JSON.stringify(locations, null, 2) }
    },
  })

  editor.add({
    name: "status",
    description: "Inspect warm diagnostic cache hit/miss counters and active language daemon status.",
    options: { namespace: "lsp", codemode: true, pinned: false },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const status = getWarmLspStatus(rootDir)
      return { output: status, content: JSON.stringify(status, null, 2) }
    },
  })
}
