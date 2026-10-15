import * as fs from "node:fs/promises"
import * as path from "node:path"

/**
 * Repository map: import graph, exported symbols and PageRank centrality for TypeScript/JavaScript,
 * Python, Go and Rust. Parsing is lexer-based (comments and string bodies are stripped before
 * matching), not a full grammar: it understands import/export/use/mod declarations, not every
 * expression. Parsed files are cached by size and mtime.
 */

export type RepoLanguage = "ts" | "py" | "go" | "rs"

export interface RepoMapNode {
  path: string
  lang: RepoLanguage
  imports: string[]
  importedBy: string[]
  centralityScore: number
  symbols: string[]
}

export interface RepoMapReport {
  totalFilesScanned: number
  topFiles: RepoMapNode[]
}

export interface BlastRadiusReport {
  targetFile: string
  symbol?: string
  directDependents: string[]
  transitiveDependents: string[]
  impactScore: number
}

/** One import edge: which names `from` takes from `to` ("*" = whole module / unknown). */
export interface ImportEdge {
  from: string
  to: string
  names: string[]
  /** Re-exports as [importedName, exportedName]; "*" re-exports everything. */
  reexports: Array<[string, string]>
}

export interface RepoGraph {
  files: string[]
  nodes: Map<string, RepoMapNode>
  edges: ImportEdge[]
}

interface RawImport {
  spec: string
  names: string[]
  reexports: Array<[string, string]>
}

interface FileFacts {
  lang: RepoLanguage
  exports: string[]
  imports: RawImport[]
  /** Go only: package selectors used per import alias. */
  goSelectors?: Map<string, Set<string>>
}

const LANG_BY_EXT: Record<string, RepoLanguage> = {
  ".ts": "ts", ".tsx": "ts", ".mts": "ts", ".cts": "ts", ".js": "ts", ".jsx": "ts", ".mjs": "ts", ".cjs": "ts",
  ".py": "py", ".go": "go", ".rs": "rs",
}
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".opencode", ".worktrees", "target", "__pycache__", "vendor", ".venv", "venv"])
const MAX_FILES = 3000
const MAX_FILE_BYTES = 512 * 1024

async function walkSourceFiles(dir: string, rootDir: string, acc: string[] = []): Promise<string[]> {
  if (acc.length >= MAX_FILES) return acc
  let entries: import("node:fs").Dirent[] = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (acc.length >= MAX_FILES) break
    if (entry.name.startsWith(".") && entry.name !== ".github") continue
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      await walkSourceFiles(path.join(dir, entry.name), rootDir, acc)
    } else if (entry.isFile() && LANG_BY_EXT[path.extname(entry.name).toLowerCase()] && !entry.name.endsWith(".d.ts")) {
      acc.push(path.relative(rootDir, path.join(dir, entry.name)).split(path.sep).join("/"))
    }
  }
  return acc
}

/**
 * Replaces comments with spaces and blanks string bodies, except string literals that directly
 * follow `from`, `import`, `require(`, `export ... from` (kept so module specifiers survive).
 */
export function stripCommentsAndStrings(text: string, lang: RepoLanguage): string {
  let out = ""
  let i = 0
  const keepSpecifier = () => /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*$/.test(out.slice(-40))
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (lang !== "py" && ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++
      continue
    }
    if (lang !== "py" && ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2)
      const stop = end < 0 ? text.length : end + 2
      out += text.slice(i, stop).replace(/[^\n]/g, " ")
      i = stop
      continue
    }
    if (lang === "py" && ch === "#") {
      while (i < text.length && text[i] !== "\n") i++
      continue
    }
    if (lang === "py" && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
      const q = text.slice(i, i + 3)
      const end = text.indexOf(q, i + 3)
      const stop = end < 0 ? text.length : end + 3
      out += text.slice(i, stop).replace(/[^\n]/g, " ")
      i = stop
      continue
    }
    if (lang === "rs" && ch === "'" ) {
      // Rust lifetimes ('a) and chars ('x'); only skip obvious char literals.
      const m = /^'(?:\\.|[^\\'\n])'/.exec(text.slice(i, i + 6))
      if (m) {
        out += " ".repeat(m[0].length)
        i += m[0].length
        continue
      }
      out += ch
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") j++
        else if (text[j] === "\n" && ch !== "`") break
        j++
      }
      const literal = text.slice(i, j + 1)
      const keep = ch !== "`" && (lang === "go" || lang === "py" || keepSpecifier())
      out += keep ? literal : ch + literal.slice(1, -1).replace(/[^\n]/g, " ") + (literal.length > 1 ? ch : "")
      i = j + 1
      continue
    }
    out += ch
    i++
  }
  return out
}

function splitNames(list: string): Array<[string, string]> {
  return list
    .split(",")
    .map((s) => s.trim().replace(/^type\s+/, ""))
    .filter(Boolean)
    .map((s) => {
      const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s)
      return m ? ([m[1], m[2] ?? m[1]] as [string, string]) : (["*", "*"] as [string, string])
    })
}

function parseTs(code: string): FileFacts {
  const imports: RawImport[] = []
  const exports = new Set<string>()

  for (const m of code.matchAll(/\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/g)) {
    const clause = m[1].trim()
    const names: string[] = []
    const braces = /\{([\s\S]*)\}/.exec(clause)
    if (braces) for (const [imported] of splitNames(braces[1])) names.push(imported)
    if (/\*\s+as\s+[\w$]+/.test(clause)) names.push("*")
    const def = clause.replace(/\{[\s\S]*\}/, "").replace(/\*\s+as\s+[\w$]+/, "").replace(/,/g, " ").trim()
    if (def && /^[\w$]+$/.test(def)) names.push("default")
    imports.push({ spec: m[2], names: names.length ? names : ["*"], reexports: [] })
  }
  for (const m of code.matchAll(/\bimport\s*["']([^"']+)["']/g)) imports.push({ spec: m[1], names: ["*"], reexports: [] })
  for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g)) imports.push({ spec: m[1], names: ["*"], reexports: [] })
  for (const m of code.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const pairs = splitNames(m[1])
    imports.push({ spec: m[2], names: pairs.map((p) => p[0]), reexports: pairs })
    for (const [, exported] of pairs) exports.add(exported)
  }
  for (const m of code.matchAll(/\bexport\s*\*\s*(?:as\s+([\w$]+)\s+)?from\s*["']([^"']+)["']/g)) {
    imports.push({ spec: m[2], names: ["*"], reexports: [["*", m[1] ?? "*"]] })
    if (m[1]) exports.add(m[1])
  }

  for (const m of code.matchAll(/\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|interface|type|const|let|var|enum|namespace)\s+([\w$]+)/g)) {
    exports.add(m[1])
  }
  if (/\bexport\s+default\b/.test(code)) exports.add("default")
  for (const m of code.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/g)) {
    for (const [, exported] of splitNames(m[1])) exports.add(exported)
  }
  if (exports.size === 0) {
    // CommonJS: module.exports = { a, b } / exports.a = ...
    for (const m of code.matchAll(/\bexports\.([\w$]+)\s*=/g)) exports.add(m[1])
  }
  return { lang: "ts", exports: [...exports], imports }
}

function parsePy(code: string): FileFacts {
  const imports: RawImport[] = []
  const exports = new Set<string>()
  const joined = code.replace(/\(\s*([^)]*?)\s*\)/gs, (_, inner: string) => inner.replace(/\s*\n\s*/g, " "))
  for (const line of joined.split("\n")) {
    let m = /^\s*from\s+([.\w]+)\s+import\s+(.+)$/.exec(line)
    if (m) {
      const names = m[2].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)
      imports.push({ spec: m[1], names: names.includes("*") ? ["*"] : names, reexports: [] })
      continue
    }
    m = /^\s*import\s+(.+)$/.exec(line)
    if (m) {
      for (const part of m[1].split(",")) {
        const mod = part.trim().split(/\s+as\s+/)[0]
        if (mod) imports.push({ spec: mod, names: ["*"], reexports: [] })
      }
      continue
    }
    m = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/.exec(line) ?? /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/.exec(line)
    if (m) exports.add(m[1])
  }
  return { lang: "py", exports: [...exports], imports }
}

function parseGo(code: string): FileFacts {
  const imports: RawImport[] = []
  const goSelectors = new Map<string, Set<string>>()
  const specs: Array<{ alias?: string; spec: string }> = []
  for (const m of code.matchAll(/\bimport\s*\(([\s\S]*?)\)/g)) {
    for (const line of m[1].split("\n")) {
      const lm = /^\s*([\w.]+\s+)?"([^"]+)"/.exec(line)
      if (lm) specs.push({ alias: lm[1]?.trim(), spec: lm[2] })
    }
  }
  for (const m of code.matchAll(/\bimport\s+([\w.]+\s+)?"([^"]+)"/g)) specs.push({ alias: m[1]?.trim(), spec: m[2] })
  for (const { alias, spec } of specs) {
    const name = alias && alias !== "_" && alias !== "." ? alias : spec.split("/").pop()!
    const used = new Set<string>()
    for (const u of code.matchAll(new RegExp(`\\b${name.replace(/[^\w]/g, "")}\\.([A-Z]\\w*)`, "g"))) used.add(u[1])
    goSelectors.set(spec, used)
    imports.push({ spec, names: alias === "." || used.size === 0 ? ["*"] : [...used], reexports: [] })
  }
  const exports = new Set<string>()
  for (const m of code.matchAll(/^(?:func\s+(?:\([^)]*\)\s*)?|type\s+|var\s+|const\s+)([A-Z]\w*)/gm)) exports.add(m[1])
  for (const m of code.matchAll(/^(?:var|const)\s*\(([\s\S]*?)^\)/gm)) {
    for (const line of m[1].split("\n")) {
      const lm = /^\s*([A-Z]\w*)/.exec(line)
      if (lm) exports.add(lm[1])
    }
  }
  return { lang: "go", exports: [...exports], imports, goSelectors }
}

function parseRs(code: string): FileFacts {
  const imports: RawImport[] = []
  const exports = new Set<string>()
  for (const m of code.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([a-z_]\w*)\s*;/gm)) {
    imports.push({ spec: `mod:${m[1]}`, names: ["*"], reexports: [] })
  }
  for (const m of code.matchAll(/^\s*(pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/gm)) {
    const body = m[2].replace(/\s+/g, "")
    const brace = /^(.*?)::\{(.*)\}$/.exec(body)
    const isPub = Boolean(m[1])
    if (brace) {
      const names = brace[2].split(",").map((n) => n.split("as")[0]).filter(Boolean)
      imports.push({ spec: `use:${brace[1]}`, names, reexports: isPub ? names.map((n) => [n, n] as [string, string]) : [] })
    } else {
      const segs = body.split("::")
      const last = segs.pop()!.split("as")[0]
      imports.push({ spec: `use:${segs.join("::")}`, names: [last === "*" ? "*" : last], reexports: isPub ? [[last, last]] : [] })
    }
  }
  for (const m of code.matchAll(/^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|type|const|static|mod|union)\s+([A-Za-z_]\w*)/gm)) {
    exports.add(m[1])
  }
  return { lang: "rs", exports: [...exports], imports }
}

export function parseSourceFacts(text: string, lang: RepoLanguage): FileFacts {
  const code = stripCommentsAndStrings(text, lang)
  if (lang === "py") return parsePy(code)
  if (lang === "go") return parseGo(code)
  if (lang === "rs") return parseRs(code)
  return parseTs(code)
}

interface ResolveCtx {
  known: Set<string>
  goModule?: string
  goDirs: Map<string, string[]>
  rustRoots: string[]
}

function resolveTs(from: string, spec: string, ctx: ResolveCtx): string[] {
  let base: string
  if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
  else if (spec.startsWith("@/") || spec.startsWith("~/")) base = `src/${spec.slice(2)}`
  else if (spec.startsWith("/")) base = spec.slice(1)
  else return []
  const stripped = base.replace(/\.(?:[cm]?js|jsx)$/, "")
  const candidates = [
    base,
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map((e) => `${stripped}${e}`),
    ...["index.ts", "index.tsx", "index.js", "index.mjs"].map((f) => `${base}/${f}`),
  ]
  const hit = candidates.find((c) => ctx.known.has(c))
  return hit ? [hit] : []
}

function resolvePy(from: string, spec: string, ctx: ResolveCtx): { files: string[]; submoduleOf?: string } {
  let parts: string[]
  if (spec.startsWith(".")) {
    const dots = /^\.+/.exec(spec)![0].length
    let dir = path.posix.dirname(from)
    for (let k = 1; k < dots; k++) dir = path.posix.dirname(dir)
    parts = [...(dir === "." ? [] : dir.split("/")), ...spec.slice(dots).split(".").filter(Boolean)]
  } else {
    parts = spec.split(".")
  }
  const rel = parts.join("/")
  for (const root of ["", "src/", "lib/"]) {
    for (const c of [`${root}${rel}.py`, `${root}${rel}/__init__.py`]) {
      if (ctx.known.has(c.replace(/^\//, ""))) return { files: [c.replace(/^\//, "")] }
    }
  }
  return { files: [] }
}

function resolveGo(spec: string, ctx: ResolveCtx): string[] {
  if (!ctx.goModule || !(spec === ctx.goModule || spec.startsWith(`${ctx.goModule}/`))) return []
  const dir = spec === ctx.goModule ? "." : spec.slice(ctx.goModule.length + 1)
  return ctx.goDirs.get(dir) ?? []
}

function resolveRs(from: string, spec: string, ctx: ResolveCtx, names: string[]): { files: string[]; names: string[] } {
  const fromDir = path.posix.dirname(from)
  const fileStem = path.posix.basename(from, ".rs")
  // Directory holding this module's children: foo.rs -> foo/, mod.rs/lib.rs/main.rs -> same dir.
  const moduleDir = ["mod", "lib", "main"].includes(fileStem) ? fromDir : `${fromDir}/${fileStem}`
  const tryModule = (dir: string, segs: string[]): string | undefined => {
    const p = [dir, ...segs].filter((x) => x && x !== ".").join("/")
    return [`${p}.rs`, `${p}/mod.rs`].find((c) => ctx.known.has(c))
  }
  if (spec.startsWith("mod:")) {
    const hit = tryModule(moduleDir, [spec.slice(4)])
    return { files: hit ? [hit] : [], names: ["*"] }
  }
  const segs = spec.slice(4).split("::").filter(Boolean)
  let baseDir: string
  if (segs[0] === "crate") {
    baseDir = ctx.rustRoots.find((r) => from.startsWith(r === "." ? "" : `${r}/`)) ?? ctx.rustRoots[0] ?? "src"
    segs.shift()
  } else if (segs[0] === "super") {
    baseDir = ["mod", "lib", "main"].includes(fileStem) ? path.posix.dirname(fromDir) : fromDir
    segs.shift()
    while (segs[0] === "super") {
      baseDir = path.posix.dirname(baseDir)
      segs.shift()
    }
  } else if (segs[0] === "self") {
    baseDir = moduleDir
    segs.shift()
  } else {
    return { files: [], names }
  }
  // Longest module path that exists; the remainder (if any) is the imported item.
  for (let k = segs.length; k >= 0; k--) {
    const hit = k === 0 ? undefined : tryModule(baseDir, segs.slice(0, k))
    if (hit) return { files: [hit], names: k === segs.length ? names : [segs[k]] }
  }
  // `use crate::Thing` with Thing defined in lib.rs/main.rs.
  const rootFile = [`${baseDir}/lib.rs`, `${baseDir}/main.rs`, `${baseDir}/mod.rs`].find((c) => ctx.known.has(c))
  return rootFile ? { files: [rootFile], names: segs.length ? [segs[0]] : names } : { files: [], names }
}

interface CacheEntry {
  mtimeMs: number
  size: number
  facts: FileFacts
}

const factsCache = new Map<string, CacheEntry>()

async function readFacts(rootDir: string, rel: string): Promise<FileFacts | undefined> {
  const abs = path.resolve(rootDir, rel)
  try {
    const st = await fs.stat(abs)
    if (st.size > MAX_FILE_BYTES) return undefined
    const cached = factsCache.get(abs)
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.facts
    const text = await fs.readFile(abs, "utf8")
    const facts = parseSourceFacts(text, LANG_BY_EXT[path.extname(rel).toLowerCase()])
    factsCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, facts })
    return facts
  } catch {
    return undefined
  }
}

export async function buildRepoGraph(rootDir: string): Promise<RepoGraph> {
  const files = await walkSourceFiles(rootDir, rootDir)
  const known = new Set(files)
  const goDirs = new Map<string, string[]>()
  for (const f of files) {
    if (f.endsWith(".go") && !f.endsWith("_test.go")) {
      const dir = path.posix.dirname(f)
      goDirs.set(dir, [...(goDirs.get(dir) ?? []), f])
    }
  }
  let goModule: string | undefined
  try {
    goModule = /^module\s+(\S+)/m.exec(await fs.readFile(path.join(rootDir, "go.mod"), "utf8"))?.[1]
  } catch {
    // not a Go module
  }
  const rustRoots = [...new Set(files.filter((f) => /(?:^|\/)(?:lib|main)\.rs$/.test(f)).map((f) => path.posix.dirname(f)))]
  const ctx: ResolveCtx = { known, goModule, goDirs, rustRoots }

  const nodes = new Map<string, RepoMapNode>()
  const edges: ImportEdge[] = []
  const factsByFile = new Map<string, FileFacts>()
  for (const f of files) {
    const facts = await readFacts(rootDir, f)
    const lang = LANG_BY_EXT[path.extname(f).toLowerCase()]
    nodes.set(f, { path: f, lang, imports: [], importedBy: [], centralityScore: 0, symbols: facts?.exports.slice(0, 24) ?? [] })
    if (facts) factsByFile.set(f, facts)
  }

  for (const [f, facts] of factsByFile) {
    for (const imp of facts.imports) {
      let targets: string[] = []
      let names = imp.names
      if (facts.lang === "ts") targets = resolveTs(f, imp.spec, ctx)
      else if (facts.lang === "py") targets = resolvePy(f, imp.spec, ctx).files
      else if (facts.lang === "go") targets = resolveGo(imp.spec, ctx)
      else if (facts.lang === "rs") ({ files: targets, names } = resolveRs(f, imp.spec, ctx, imp.names))

      const edgeNames = new Map<string, string[]>(targets.map((t) => [t, names]))
      // `from pkg import mod` may name a submodule rather than a symbol: that edge takes the whole module.
      if (facts.lang === "py") {
        for (const n of imp.names) {
          const sub = resolvePy(f, `${imp.spec}${imp.spec.endsWith(".") ? "" : "."}${n}`, ctx).files
          for (const s of sub) {
            if (!targets.includes(s)) targets.push(s)
            edgeNames.set(s, ["*"])
          }
        }
      }
      // Rust `mod foo;` only declares structure; it does not use any of foo's items.
      if (facts.lang === "rs" && imp.spec.startsWith("mod:")) for (const t of targets) edgeNames.set(t, [])

      for (const to of targets) {
        if (to === f) continue
        edges.push({ from: f, to, names: edgeNames.get(to) ?? names, reexports: imp.reexports })
        const node = nodes.get(f)!
        if (!node.imports.includes(to)) node.imports.push(to)
        const target = nodes.get(to)!
        if (!target.importedBy.includes(f)) target.importedBy.push(f)
      }
    }
  }

  computePageRank(nodes)
  return { files, nodes, edges }
}

/** Standard PageRank over import edges (importer -> imported), iterated to convergence. */
function computePageRank(nodes: Map<string, RepoMapNode>): void {
  const n = nodes.size
  if (n === 0) return
  const damping = 0.85
  let rank = new Map<string, number>([...nodes.keys()].map((k) => [k, 1 / n]))
  for (let iter = 0; iter < 50; iter++) {
    let dangling = 0
    for (const [k, node] of nodes) if (node.imports.length === 0) dangling += rank.get(k)!
    const next = new Map<string, number>()
    let delta = 0
    for (const [k, node] of nodes) {
      let sum = 0
      for (const caller of node.importedBy) sum += rank.get(caller)! / nodes.get(caller)!.imports.length
      const value = (1 - damping) / n + damping * (sum + dangling / n)
      next.set(k, value)
      delta += Math.abs(value - rank.get(k)!)
    }
    rank = next
    if (delta < 1e-9) break
  }
  // Scale so an average file scores 1.
  for (const [k, node] of nodes) node.centralityScore = +(rank.get(k)! * n).toFixed(3)
}

export async function buildRepoMap(rootDir: string, topN: number = 25): Promise<RepoMapReport> {
  const graph = await buildRepoGraph(rootDir)
  const sorted = [...graph.nodes.values()].sort(
    (a, b) => b.centralityScore - a.centralityScore || b.importedBy.length - a.importedBy.length || a.path.localeCompare(b.path),
  )
  return { totalFilesScanned: graph.files.length, topFiles: sorted.slice(0, topN) }
}

/**
 * Files affected by changing `targetFile`. With `symbol`, only importers that take that symbol
 * (or the whole module) count as direct dependents, following re-exports under their new names;
 * everything that depends on those files is reported as transitive.
 */
export async function analyzeBlastRadius(rootDir: string, targetFile: string, symbol?: string): Promise<BlastRadiusReport> {
  const relTarget = path.relative(rootDir, path.resolve(rootDir, targetFile)).split(path.sep).join("/")
  const graph = await buildRepoGraph(rootDir)

  let direct: string[]
  if (!symbol) {
    direct = [...(graph.nodes.get(relTarget)?.importedBy ?? [])]
  } else {
    const directSet = new Set<string>()
    const seen = new Set<string>()
    const queue: Array<[string, string]> = [[relTarget, symbol]]
    while (queue.length) {
      const [file, name] = queue.shift()!
      const key = `${file}#${name}`
      if (seen.has(key)) continue
      seen.add(key)
      for (const e of graph.edges) {
        if (e.to !== file) continue
        const takes = e.names.includes("*") || e.names.includes(name)
        if (!takes) continue
        const reexport = e.reexports.find(([imported]) => imported === name || imported === "*")
        if (reexport) {
          queue.push([e.from, reexport[1] === "*" ? name : reexport[1]])
          if (!e.names.every((x) => e.reexports.some(([imp]) => imp === x || imp === "*"))) directSet.add(e.from)
        } else {
          directSet.add(e.from)
        }
      }
    }
    directSet.delete(relTarget)
    direct = [...directSet]
  }

  const visited = new Set<string>(direct)
  const queue = [...direct]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const c of graph.nodes.get(cur)?.importedBy ?? []) {
      if (c !== relTarget && !visited.has(c)) {
        visited.add(c)
        queue.push(c)
      }
    }
  }

  const transitive = [...visited].sort()
  return {
    targetFile: relTarget,
    ...(symbol ? { symbol } : {}),
    directDependents: direct.sort(),
    transitiveDependents: transitive,
    impactScore: direct.length * 2 + transitive.length,
  }
}

export function registerRepoMapTools(editor: any, rootDir: string, pinned = true): void {
  editor.namespace({
    name: "repo",
    description:
      "Repository map (TS/JS, Python, Go, Rust): PageRank-ranked files with their exported symbols, and file- or symbol-level blast radius.",
  })

  editor.add({
    name: "map",
    description:
      "Build a PageRank-weighted repository dependency map showing the highest-centrality files, their exported symbols, and their importers/dependents.",
    options: { namespace: "repo", codemode: true, pinned },
    input: {
      type: "object",
      properties: {
        topN: { type: "number", description: "Number of top-ranked files to return (default 25)" },
      },
    },
    output: { type: "object" },
    execute: async (input: { topN?: number }) => {
      const report = await buildRepoMap(rootDir, input?.topN ?? 25)
      return { output: report, content: JSON.stringify(report, null, 2) }
    },
  })

  editor.add({
    name: "blast_radius",
    description:
      "List files that directly or transitively depend on `path`. Pass `symbol` to count only importers of that exported symbol (following re-exports), e.g. before changing one function's signature.",
    options: { namespace: "repo", codemode: true, pinned },
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Target file path to analyze" },
        symbol: { type: "string", description: "Optional exported symbol name to narrow the analysis" },
      },
      required: ["path"],
    },
    output: { type: "object" },
    execute: async (input: { path: string; symbol?: string }) => {
      const report = await analyzeBlastRadius(rootDir, input.path, input.symbol)
      return { output: report, content: JSON.stringify(report, null, 2) }
    },
  })
}
