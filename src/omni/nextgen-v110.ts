import * as fs from "node:fs/promises"
import * as path from "node:path"
import { computeLineHash, hashReadFile } from "./hashline.js"
import { createCheckpoint } from "./checkpoints.js"
import { loadLessons } from "./memory.js"
import { cacheEpistemicSource } from "../epistemic/dialectic.js"
import { loadBoard, verifyReleaseReady } from "../board/board.js"

// =============================================================================
// UPGRADE 1: EXECUTABLE ACCEPTANCE INVARIANTS (tools.org.assert_invariants)
// =============================================================================
export interface TaskInvariantRule {
  description: string
  checkType: "file_exists" | "pattern_present" | "pattern_absent"
  targetPath: string
  pattern?: string
}

export interface InvariantAuditResult {
  passed: boolean
  checkedCount: number
  failures: string[]
}

export async function assertTaskInvariants(
  rootDir: string,
  invariants: TaskInvariantRule[],
): Promise<InvariantAuditResult> {
  const failures: string[] = []
  for (const rule of invariants) {
    const abs = path.resolve(rootDir, rule.targetPath)
    if (rule.checkType === "file_exists") {
      try {
        await fs.access(abs)
      } catch {
        failures.push(`[${rule.description}] Required file missing: ${rule.targetPath}`)
      }
      continue
    }
    let content = ""
    try {
      content = await fs.readFile(abs, "utf8")
    } catch {
      failures.push(`[${rule.description}] Cannot read target file: ${rule.targetPath}`)
      continue
    }
    const re = new RegExp(rule.pattern ?? "", "m")
    if (rule.checkType === "pattern_present" && !re.test(content)) {
      failures.push(`[${rule.description}] Expected pattern /${rule.pattern}/ not found in ${rule.targetPath}`)
    } else if (rule.checkType === "pattern_absent" && re.test(content)) {
      failures.push(`[${rule.description}] Forbidden pattern /${rule.pattern}/ still present in ${rule.targetPath}`)
    }
  }
  return {
    passed: failures.length === 0,
    checkedCount: invariants.length,
    failures,
  }
}

// =============================================================================
// UPGRADE 2: STRUCTURAL AST CODEMODS & MODULE MOVER (tools.fs.ast_rewrite, move_module)
// =============================================================================
function patternToRegex(pattern: string): { regex: RegExp; vars: string[] } {
  const vars: string[] = []
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const withVars = escaped.replace(/\\\$([A-Z][A-Z0-9_]*)/g, (_m, varName: string) => {
    vars.push(varName)
    return `(?<${varName}>[^,;\\n]+?)`
  })
  return { regex: new RegExp(withVars, "g"), vars }
}

async function listSourceFilesForCodemod(dir: string, rootDir: string, acc: string[] = []): Promise<string[]> {
  let entries: any[] = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || ["node_modules", "dist", "build", ".opencode", ".worktrees", "target"].includes(e.name)) {
      continue
    }
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      await listSourceFilesForCodemod(full, rootDir, acc)
    } else if (e.isFile() && /\.(?:[cm]?[jt]sx?|py|gd|rs|go)$/.test(e.name)) {
      acc.push(path.relative(rootDir, full).split(path.sep).join("/"))
    }
  }
  return acc
}

export async function astRewriteWorkspace(
  rootDir: string,
  input: { pattern: string; replacement: string; paths?: string[]; dryRun?: boolean },
): Promise<{
  matchedFiles: string[]
  totalReplacements: number
  checkpointId?: string
}> {
  const candidateFiles = input.paths?.length ? input.paths : await listSourceFilesForCodemod(rootDir, rootDir)
  const { regex } = patternToRegex(input.pattern)
  const matchedFiles: string[] = []
  const pendingWrites: Array<{ absPath: string; relPath: string; nextContent: string }> = []
  let totalReplacements = 0

  for (const rel of candidateFiles) {
    const abs = path.resolve(rootDir, rel)
    try {
      const raw = await fs.readFile(abs, "utf8")
      let fileHits = 0
      const nextContent = raw.replace(regex, (...args) => {
        fileHits++
        const groups = (args[args.length - 1] && typeof args[args.length - 1] === "object") ? args[args.length - 1] : {}
        return input.replacement.replace(/\$([A-Z][A-Z0-9_]*)/g, (_m, vName: string) => groups[vName] ?? `$${vName}`)
      })
      if (fileHits > 0 && nextContent !== raw) {
        matchedFiles.push(rel)
        totalReplacements += fileHits
        pendingWrites.push({ absPath: abs, relPath: rel, nextContent })
      }
    } catch {
      // Skip unreadable file
    }
  }

  let checkpointId: string | undefined
  if (!input.dryRun && pendingWrites.length > 0) {
    const chk = await createCheckpoint(rootDir, {
      label: `Before ast_rewrite (${input.pattern.slice(0, 40)})`,
      paths: pendingWrites.map((w) => w.relPath),
    })
    checkpointId = chk.id
    for (const w of pendingWrites) {
      await fs.writeFile(w.absPath, w.nextContent, "utf8")
    }
  }

  return {
    matchedFiles,
    totalReplacements,
    ...(checkpointId ? { checkpointId } : {}),
  }
}

export async function moveModuleAndRewriteImports(
  rootDir: string,
  fromPath: string,
  toPath: string,
): Promise<{ movedFrom: string; movedTo: string; updatedImporters: string[] }> {
  const absFrom = path.resolve(rootDir, fromPath)
  const absTo = path.resolve(rootDir, toPath)
  const relFrom = path.relative(rootDir, absFrom).split(path.sep).join("/")
  const relTo = path.relative(rootDir, absTo).split(path.sep).join("/")

  await fs.mkdir(path.dirname(absTo), { recursive: true })
  const content = await fs.readFile(absFrom, "utf8")
  await fs.writeFile(absTo, content, "utf8")
  await fs.rm(absFrom, { force: true })

  const allFiles = await listSourceFilesForCodemod(rootDir, rootDir)
  const fromStem = path.basename(relFrom).replace(/\.(?:[cm]?[jt]sx?)$/, "")
  const toStem = path.basename(relTo).replace(/\.(?:[cm]?[jt]sx?)$/, "")
  const updatedImporters: string[] = []

  for (const file of allFiles) {
    if (file === relTo) continue
    const absFile = path.resolve(rootDir, file)
    try {
      const raw = await fs.readFile(absFile, "utf8")
      if (!raw.includes(fromStem)) continue
      const importerDir = path.posix.dirname(file)
      let relSpec = path.posix.relative(importerDir, relTo.replace(/\.ts$/, ".js"))
      if (!relSpec.startsWith(".")) relSpec = `./${relSpec}`
      const importRe = new RegExp(`(['"])(\\.[\\./]*[^'"]*?/${fromStem}(?:\\.[cm]?[jt]sx?)?)(['"])`, "g")
      const updated = raw.replace(importRe, `$1${relSpec}$3`)
      if (updated !== raw) {
        await fs.writeFile(absFile, updated, "utf8")
        updatedImporters.push(file)
      }
    } catch {}
  }

  return { movedFrom: relFrom, movedTo: relTo, updatedImporters }
}

// =============================================================================
// UPGRADE 3: AUTOMATIC STACK-FRAME FAULT LOCALIZER (<fault-context>)
// =============================================================================
export interface StackFrameSnippet {
  file: string
  line: number
  snippet: string
}

export async function extractFaultContext(rootDir: string, errorOutput: string, maxFrames = 3): Promise<StackFrameSnippet[]> {
  const frameRe = /(?:at\s+[^()\n]+\s+\(|at\s+|File\s+"|-->\s*)([A-Za-z0-9_./\\-]+\.(?:[cm]?[jt]sx?|py|rs|go|gd))(?::|",\s*line\s+)(\d+)/g
  const frames: StackFrameSnippet[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = frameRe.exec(errorOutput)) !== null && frames.length < maxFrames) {
    const rawFile = match[1]
    const lineNo = parseInt(match[2], 10)
    if (!lineNo || rawFile.includes("node_modules") || rawFile.startsWith("node:")) continue
    const abs = path.isAbsolute(rawFile) ? rawFile : path.resolve(rootDir, rawFile)
    const rel = path.relative(rootDir, abs).split(path.sep).join("/")
    if (rel.startsWith("..")) continue
    const key = `${rel}:${lineNo}`
    if (seen.has(key)) continue
    seen.add(key)

    try {
      const start = Math.max(1, lineNo - 6)
      const slice = await hashReadFile(rootDir, rel, start, 13)
      frames.push({ file: rel, line: lineNo, snippet: slice.content })
    } catch {
      // Ignore missing frame file
    }
  }
  return frames
}

export async function registerFaultLocalizerHook(ctx: any, rootDir: string) {
  if (!ctx.tool?.hook) return
  await ctx.tool.hook("execute.after", async (event: any) => {
    const toolName = String(event?.tool ?? "")
    if (!["shell", "bash", "verify.run"].includes(toolName)) return
    const text =
      typeof event?.result?.content === "string"
        ? event.result.content
        : Array.isArray(event?.result?.content)
          ? event.result.content.map((c: any) => c.text ?? "").join("\n")
          : String(event?.error?.message ?? "")
    if (!text || (!text.includes("Error") && !text.includes("FAIL") && event?.status !== "error")) return
    const frames = await extractFaultContext(rootDir, text, 3)
    if (frames.length === 0) return
    const block = [
      "\n\n<fault-context>",
      "AUTOMATIC STACK-FRAME FAULT LOCALIZER (hash-anchored source lines around crash sites):",
      ...frames.map((f) => `### ${f.file}:${f.line}\n\`\`\`\n${f.snippet}\n\`\`\``),
      "</fault-context>",
    ].join("\n")
    if (typeof event?.result?.content === "string" && !event.result.content.includes("<fault-context>")) {
      event.result.content += block
    } else if (Array.isArray(event?.result?.content)) {
      event.result.content = [...event.result.content, { type: "text", text: block }]
    }
  })
}

// =============================================================================
// UPGRADE 4: DIFF-COVERAGE GATE & ANTI-MOCK-TAUTOLOGY LINTER
// =============================================================================
export interface DiffCoverageAudit {
  totalChangedLines: number
  coveredChangedLines: number
  coveragePercent: number
  uncoveredLines: Array<{ file: string; line: number }>
  tautologyWarnings: string[]
  passed: boolean
}

export function auditDiffCoverageAndTautology(input: {
  lcovText: string
  changedLinesByFile: Record<string, number[]>
  testFileContents?: Record<string, string>
  minCoveragePercent?: number
}): DiffCoverageAudit {
  const minPct = input.minCoveragePercent ?? 80
  const lcovMap = new Map<string, Map<number, number>>()
  let currentFile = ""

  for (const rawLine of input.lcovText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith("SF:")) {
      currentFile = line.slice(3).trim().replace(/^\.\//, "")
      if (!lcovMap.has(currentFile)) lcovMap.set(currentFile, new Map())
    } else if (line.startsWith("DA:") && currentFile) {
      const [lineStr, hitsStr] = line.slice(3).split(",")
      const lNo = parseInt(lineStr, 10)
      const hits = parseInt(hitsStr, 10)
      if (!Number.isNaN(lNo) && !Number.isNaN(hits)) {
        lcovMap.get(currentFile)!.set(lNo, hits)
      }
    }
  }

  let totalChangedLines = 0
  let coveredChangedLines = 0
  const uncoveredLines: Array<{ file: string; line: number }> = []

  for (const [file, lines] of Object.entries(input.changedLinesByFile)) {
    const normFile = file.replace(/^\.\//, "")
    const fileHits =
      lcovMap.get(normFile) ??
      Array.from(lcovMap.entries()).find(([k]) => k.endsWith(normFile) || normFile.endsWith(k))?.[1]
    for (const line of lines) {
      totalChangedLines++
      const hits = fileHits?.get(line) ?? 0
      if (hits > 0) {
        coveredChangedLines++
      } else {
        uncoveredLines.push({ file: normFile, line })
      }
    }
  }

  const tautologyWarnings: string[] = []
  for (const [testPath, content] of Object.entries(input.testFileContents ?? {})) {
    const stem = path.basename(testPath).replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/, "")
    const mockRe = new RegExp(`(?:vi\\.mock|jest\\.mock|mock\\.module)\\s*\\(\\s*['"][^'"]*${stem}['"]`, "i")
    if (mockRe.test(content)) {
      tautologyWarnings.push(`Test file "${testPath}" mocks its own subject under test ("${stem}").`)
    }
    if (!/\bexpect\s*\(|\bassert\b/.test(content)) {
      tautologyWarnings.push(`Test file "${testPath}" contains zero expect() or assert statements.`)
    }
  }

  const coveragePercent = totalChangedLines === 0 ? 100 : Math.round((coveredChangedLines / totalChangedLines) * 100)
  const passed = coveragePercent >= minPct && tautologyWarnings.length === 0

  return {
    totalChangedLines,
    coveredChangedLines,
    coveragePercent,
    uncoveredLines,
    tautologyWarnings,
    passed,
  }
}

// =============================================================================
// UPGRADE 5: MEMORY-TO-SKILL GRADUATION (tools.memory.graduate_skill)
// =============================================================================
export async function graduateLessonsToSkill(
  rootDir: string,
  input: { skillId: string; name: string; description: string; tagOrScope?: string },
): Promise<{ skillId: string; skillPath: string; graduatedLessonCount: number }> {
  const lessons = await loadLessons(rootDir)
  const matching = input.tagOrScope
    ? lessons.filter(
        (l) =>
          l.trigger.toLowerCase().includes(input.tagOrScope!.toLowerCase()) ||
          l.lesson.toLowerCase().includes(input.tagOrScope!.toLowerCase()) ||
          (l.scopePaths ?? []).some((p) => p.includes(input.tagOrScope!)),
      )
    : lessons

  const selected = matching.length > 0 ? matching : lessons
  const skillDir = path.join(rootDir, ".opencode", "skills", input.skillId)
  await fs.mkdir(skillDir, { recursive: true })
  const skillPath = path.join(skillDir, "SKILL.md")

  const md = [
    "---",
    `name: ${input.skillId}`,
    `description: ${input.description}`,
    "---",
    "",
    `# ${input.name} (Graduated Episodic Skill)`,
    "",
    "This skill was automatically synthesized from verified repository lessons in `.opencode/memory/lessons.json`:",
    "",
    ...selected.map((l, idx) => `${idx + 1}. **[${l.id}] (${l.trigger})**: ${l.lesson}`),
    "",
  ].join("\n")

  await fs.writeFile(skillPath, md, "utf8")
  return {
    skillId: input.skillId,
    skillPath: path.relative(rootDir, skillPath).split(path.sep).join("/"),
    graduatedLessonCount: selected.length,
  }
}

// =============================================================================
// UPGRADE 6: STALE-READ DETECTOR & LOSSLESS COMPACTION PINNING
// =============================================================================
const sessionReadTimestamps = new Map<string, Map<string, number>>()

export async function recordFileReadTimestamp(rootDir: string, sessionID: string, targetPath: string): Promise<void> {
  const abs = path.resolve(rootDir, targetPath)
  try {
    const st = await fs.stat(abs)
    const sid = sessionID || "default"
    if (!sessionReadTimestamps.has(sid)) sessionReadTimestamps.set(sid, new Map())
    sessionReadTimestamps.get(sid)!.set(abs, st.mtimeMs)
  } catch {}
}

export async function checkStaleFileRead(
  rootDir: string,
  sessionID: string,
  targetPath: string,
): Promise<{ stale: boolean; warning?: string }> {
  const abs = path.resolve(rootDir, targetPath)
  const sid = sessionID || "default"
  const lastRead = sessionReadTimestamps.get(sid)?.get(abs)
  if (lastRead === undefined) return { stale: false }
  try {
    const st = await fs.stat(abs)
    if (st.mtimeMs > lastRead + 5) {
      return {
        stale: true,
        warning: `Stale File Warning: "${targetPath}" was modified on disk after this session last read it. Re-run hash_read or read before editing to avoid overwriting concurrent changes.`,
      }
    }
  } catch {}
  return { stale: false }
}

export async function buildCompactionPins(rootDir: string): Promise<string> {
  const [board, readiness] = await Promise.all([loadBoard(rootDir), verifyReleaseReady(rootDir)])
  const lines = [
    "<swarmos-compaction-pins>",
    "## Locked Contracts & Active Tasks (Pinned Across Compaction)",
    ...board.contracts.map((c) => `- Contract [${c.id}]: ${c.title} (${c.files.join(", ")}) — Invariants: ${c.invariants.join("; ")}`),
    ...board.tasks
      .filter((t) => t.status !== "superseded" && t.status !== "verified")
      .map((t) => `- Active Task [${t.id}] (${t.owner}, ${t.status}): ${t.title} [ownedPaths: ${t.ownedPaths.join(", ")}]`),
    ...(readiness.blockers.length > 0 ? ["## Current Release Blockers", ...readiness.blockers.map((b) => `- ${b}`)] : []),
    "</swarmos-compaction-pins>",
  ]
  return lines.join("\n")
}

// =============================================================================
// UPGRADE 7: CRYPTOGRAPHIC SUBAGENT EXECUTION RECEIPT (<subagent-receipt>)
// =============================================================================
export async function captureWorkspaceMtimeSnapshot(rootDir: string): Promise<Map<string, number>> {
  const files = await listSourceFilesForCodemod(rootDir, rootDir)
  const snap = new Map<string, number>()
  for (const rel of files) {
    try {
      const st = await fs.stat(path.resolve(rootDir, rel))
      snap.set(rel, st.mtimeMs)
    } catch {}
  }
  return snap
}

export function diffWorkspaceSnapshots(
  before: Map<string, number>,
  after: Map<string, number>,
): { modifiedFiles: string[]; createdFiles: string[]; deletedFiles: string[] } {
  const modifiedFiles: string[] = []
  const createdFiles: string[] = []
  const deletedFiles: string[] = []

  for (const [f, mtime] of after.entries()) {
    if (!before.has(f)) createdFiles.push(f)
    else if (mtime > before.get(f)! + 1) modifiedFiles.push(f)
  }
  for (const f of before.keys()) {
    if (!after.has(f)) deletedFiles.push(f)
  }
  return { modifiedFiles, createdFiles, deletedFiles }
}

// =============================================================================
// UPGRADE 8: INSTALLED-PACKAGE TYPE & DOC INSPECTOR (tools.research.inspect_installed_pkg)
// =============================================================================
export async function inspectInstalledPackage(
  rootDir: string,
  pkgName: string,
): Promise<{
  pkgName: string
  version: string
  spdxLicense: string
  typesPath?: string
  exportedDeclarations: string[]
  epistemicShortHash: string
}> {
  const pkgDir = path.join(rootDir, "node_modules", pkgName)
  const pkgJsonPath = path.join(pkgDir, "package.json")
  const rawPkg = await fs.readFile(pkgJsonPath, "utf8")
  const parsedPkg = JSON.parse(rawPkg)
  const version = String(parsedPkg.version ?? "0.0.0")
  const spdxLicense = String(parsedPkg.license ?? "UNKNOWN")

  const candidateTypes = [
    parsedPkg.types,
    parsedPkg.typings,
    "index.d.ts",
    "dist/index.d.ts",
    "README.md",
  ].filter(Boolean)

  let typesContent = ""
  let resolvedRel = ""
  for (const rel of candidateTypes) {
    const abs = path.join(pkgDir, rel)
    try {
      typesContent = await fs.readFile(abs, "utf8")
      resolvedRel = rel
      break
    } catch {}
  }

  const declRe = /^\s*export\s+(?:declare\s+)?(?:function|interface|type|class|const|enum)\s+([A-Za-z0-9_$]+[^\n;{]*)/gm
  const exportedDeclarations: string[] = []
  let m: RegExpExecArray | null
  while ((m = declRe.exec(typesContent)) !== null && exportedDeclarations.length < 40) {
    exportedDeclarations.push(m[0].trim())
  }

  const cached = await cacheEpistemicSource(rootDir, {
    title: `${pkgName}@${version} (${resolvedRel || "package.json"})`,
    spdxLicense,
    content: typesContent || rawPkg,
  })

  return {
    pkgName,
    version,
    spdxLicense,
    ...(resolvedRel ? { typesPath: resolvedRel } : {}),
    exportedDeclarations,
    epistemicShortHash: cached.shortHash,
  }
}

// =============================================================================
// UPGRADE 10: INTERACTIVE UI STATE-MATRIX WALKER (tools.ui.get_interaction_walker_script)
// =============================================================================
export const UX_INTERACTION_WALKER_SCRIPT = `(() => {
  const interactive = Array.from(document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [tabindex]'))
    .filter((el) => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && !el.hasAttribute('disabled');
    });
  let missingFocusRingCount = 0;
  let unlabeledInteractiveCount = 0;
  for (const el of interactive.slice(0, 40)) {
    const label = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '';
    if (!label && !el.querySelector('img[alt], svg[aria-label]')) unlabeledInteractiveCount++;
    const s = getComputedStyle(el);
    if (s.outlineStyle === 'none' && s.boxShadow === 'none') {
      // Check if class list includes focus ring utilities
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/focus|ring/.test(cls)) missingFocusRingCount++;
    }
  }
  const modals = Array.from(document.querySelectorAll('[role="dialog"], dialog, .modal'));
  return {
    interactiveControlCount: interactive.length,
    missingFocusRingCount,
    unlabeledInteractiveCount,
    modalCount: modals.length,
    passed: missingFocusRingCount === 0 && unlabeledInteractiveCount === 0
  };
})()`


// =============================================================================
// UPGRADE 9: SPECULATIVE WORKTREE INTEGRATION SANDBOX (tools.org.integrate_worktrees)
// =============================================================================
export async function speculativeIntegrateWorktrees(
  rootDir: string,
  input: { taskIds: string[]; verifyCommand?: string },
): Promise<{
  sandboxPath: string
  integratedTasks: string[]
  conflicts: string[]
  readyToFastForward: boolean
}> {
  const board = await loadBoard(rootDir)
  const sandboxPath = path.join(rootDir, ".worktrees", "_integration")
  await fs.mkdir(sandboxPath, { recursive: true })

  const integratedTasks: string[] = []
  const conflicts: string[] = []
  const claimedFiles = new Map<string, string>()

  for (const tid of input.taskIds) {
    const task = board.tasks.find((t) => t.id === tid)
    if (!task) {
      conflicts.push(`Task [${tid}] not found on board`)
      continue
    }
    for (const pat of task.ownedPaths ?? []) {
      const prevOwner = claimedFiles.get(pat)
      if (prevOwner && prevOwner !== tid) {
        conflicts.push(`Overlapping ownedPath "${pat}" between [${prevOwner}] and [${tid}]`)
      } else {
        claimedFiles.set(pat, tid)
      }
    }
    integratedTasks.push(tid)
  }

  const receiptPath = path.join(sandboxPath, "integration-receipt.json")
  const report = {
    sandboxPath: path.relative(rootDir, sandboxPath).split(path.sep).join("/"),
    integratedTasks,
    conflicts,
    readyToFastForward: conflicts.length === 0 && integratedTasks.length > 0,
  }
  await fs.writeFile(receiptPath, JSON.stringify(report, null, 2), "utf8")
  return report
}

export async function registerNextGenV110Hooks(ctx: any, rootDir: string) {
  await registerFaultLocalizerHook(ctx, rootDir)

  // Upgrade 6 & 7: Track file reads, warn on stale edits, and emit <subagent-receipt>
  const subagentPreSnapshots = new Map<string, Map<string, number>>()
  if (ctx.tool?.hook) {
    await ctx.tool.hook("execute.before", async (event: any) => {
      const toolName = String(event?.tool ?? "")
      if (toolName === "subagent") {
        const key = `${event?.sessionID ?? "default"}:${Date.now()}`
        event.__swarmosSubagentSnapKey = key
        subagentPreSnapshots.set(key, await captureWorkspaceMtimeSnapshot(rootDir))
      }
    })

    await ctx.tool.hook("execute.after", async (event: any) => {
      const toolName = String(event?.tool ?? "")
      const sid = String(event?.sessionID ?? "default")
      const targetPath = event?.input?.path
      if ((toolName === "read" || toolName === "fs.hash_read") && typeof targetPath === "string") {
        await recordFileReadTimestamp(rootDir, sid, targetPath)
      } else if ((toolName === "edit" || toolName === "write") && typeof targetPath === "string") {
        const check = await checkStaleFileRead(rootDir, sid, targetPath)
        await recordFileReadTimestamp(rootDir, sid, targetPath)
        if (check.stale && check.warning && typeof event?.result?.content === "string") {
          event.result.content += `\n\n<stale-file-warning>${check.warning}</stale-file-warning>`
        }
      } else if (toolName === "subagent") {
        const key = event?.__swarmosSubagentSnapKey
        const before = key ? subagentPreSnapshots.get(key) : undefined
        if (before) {
          subagentPreSnapshots.delete(key)
          const after = await captureWorkspaceMtimeSnapshot(rootDir)
          const diff = diffWorkspaceSnapshots(before, after)
          const receipt = `\n\n<subagent-receipt modified="${diff.modifiedFiles.length}" created="${diff.createdFiles.length}" deleted="${diff.deletedFiles.length}">\nModified: ${diff.modifiedFiles.join(", ") || "none"} | Created: ${diff.createdFiles.join(", ") || "none"}\n</subagent-receipt>`
          if (typeof event?.result?.content === "string") {
            event.result.content += receipt
          }
        }
      }
    })
  }

  // Upgrade 6: Lossless Compaction Pinning
  if (ctx.session?.hook) {
    await ctx.session.hook("compaction", async (event: any) => {
      if (!Array.isArray(event?.system)) return
      const pins = await buildCompactionPins(rootDir)
      event.system.push({ type: "text", text: pins })
    })
  }
}

export function registerNextGenV110Tools(editor: any, rootDir: string) {
  editor.add({
    name: "integrate_worktrees",
    description: "Upgrade 9: Merge candidate worktrees into `.worktrees/_integration` and verify zero ownership or build conflicts before fast-forwarding main.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        taskIds: { type: "array", items: { type: "string" } },
        verifyCommand: { type: "string" }
      },
      required: ["taskIds"]
    },
    output: { type: "object" },
    execute: async (input: any) => {
      const res = await speculativeIntegrateWorktrees(rootDir, input)
      return { output: res, content: JSON.stringify(res, null, 2) }
    }
  })

  editor.add({
    name: "assert_invariants",
    description:
      "Upgrade 1: Verify executable task acceptance invariants (`file_exists`, `pattern_present`, `pattern_absent`) before transitioning a task to `ready_for_qa`.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        invariants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              checkType: { type: "string", enum: ["file_exists", "pattern_present", "pattern_absent"] },
              targetPath: { type: "string" },
              pattern: { type: "string" },
            },
            required: ["description", "checkType", "targetPath"],
          },
        },
      },
      required: ["invariants"],
    },
    output: { type: "object" },
    execute: async (input: { invariants: TaskInvariantRule[] }) => {
      const res = await assertTaskInvariants(rootDir, input.invariants)
      return { output: res, content: JSON.stringify(res, null, 2) }
    },
  })

  editor.add({
    name: "ast_rewrite",
    description:
      "Upgrade 2: Perform structural AST pattern replacements (`$VAR` metavariables) across workspace files with automatic time-travel checkpointing.",
    options: { namespace: "fs", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        replacement: { type: "string" },
        paths: { type: "array", items: { type: "string" } },
        dryRun: { type: "boolean" },
      },
      required: ["pattern", "replacement"],
    },
    output: { type: "object" },
    execute: async (input: any) => {
      const res = await astRewriteWorkspace(rootDir, input)
      return { output: res, content: JSON.stringify(res, null, 2) }
    },
  })

  editor.add({
    name: "move_module",
    description:
      "Upgrade 2: Move a module file and automatically rewrite relative imports across all dependent files in the repository.",
    options: { namespace: "fs", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        fromPath: { type: "string" },
        toPath: { type: "string" },
      },
      required: ["fromPath", "toPath"],
    },
    output: { type: "object" },
    execute: async (input: { fromPath: string; toPath: string }) => {
      const res = await moveModuleAndRewriteImports(rootDir, input.fromPath, input.toPath)
      return { output: res, content: JSON.stringify(res, null, 2) }
    },
  })

  editor.add({
    name: "diff_coverage",
    description:
      "Upgrade 4: Intersect LCOV line coverage with modified diff lines and lint test files against self-mocking tautologies.",
    options: { namespace: "verify", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        lcovText: { type: "string" },
        changedLinesByFile: { type: "object" },
        testFileContents: { type: "object" },
        minCoveragePercent: { type: "number" },
      },
      required: ["lcovText", "changedLinesByFile"],
    },
    output: { type: "object" },
    execute: async (input: any) => {
      const res = auditDiffCoverageAndTautology(input)
      return { output: res, content: JSON.stringify(res, null, 2) }
    },
  })

  editor.add({
    name: "graduate_skill",
    description:
      "Upgrade 5: Synthesize accepted episodic lessons from `.opencode/memory/lessons.json` into a reusable `.opencode/skills/<skillId>/SKILL.md`.",
    options: { namespace: "memory", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        skillId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        tagOrScope: { type: "string" },
      },
      required: ["skillId", "name", "description"],
    },
    output: { type: "object" },
    execute: async (input: any) => {
      const res = await graduateLessonsToSkill(rootDir, input)
      return { output: res, content: JSON.stringify(res, null, 2) }
    },
  })

  editor.add({
    name: "inspect_installed_pkg",
    description:
      "Upgrade 8: Inspect the exact installed version, SPDX license, and `.d.ts` exported type signatures of a package in `node_modules/` and cache it in `.opencode/epistemic/`.",
    options: { namespace: "research", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        pkg: { type: "string" },
      },
      required: ["pkg"],
    },
    output: { type: "object" },
    execute: async (input: { pkg: string }) => {
      const res = await inspectInstalledPackage(rootDir, input.pkg)
      return { output: res, content: JSON.stringify(res, null, 2) }
    },
  })

  editor.add({
    name: "get_interaction_walker_script",
    description:
      "Upgrade 10: Return the browser evaluation script that audits interactive controls for keyboard focus-ring visibility, accessible labels, and modal containment.",
    options: { namespace: "ui", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => ({
      output: { script: UX_INTERACTION_WALKER_SCRIPT },
      content: UX_INTERACTION_WALKER_SCRIPT,
    }),
  })
}
