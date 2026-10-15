import { exec, execFile } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { promisify } from "node:util"
import { analyzeBlastRadius } from "./repomap.js"

const execFileAsync = promisify(execFile)

export type VerifyKind = "typecheck" | "lint" | "test"
export type TestRunner = "bun" | "vitest" | "jest" | "node" | "pytest" | "go" | "cargo" | "unknown"

export interface VerifyCheck {
  kind: VerifyKind
  command: string
  source: string
  runner?: TestRunner
}

export interface VerifyFailure {
  file: string
  /** Absent when the runner only reports the failing test by name. */
  line?: number
  col?: number
  message: string
}

export interface VerifyCheckResult {
  kind: VerifyKind
  command: string
  source: string
  exitCode: number
  passed: boolean
  timedOut: boolean
  durationMs: number
  counts?: { passed: number; failed: number }
  failures: VerifyFailure[]
  outputTail: string
}

export interface VerifyRun {
  id: string
  createdAt: string
  rootDir: string
  scope: "changed" | "full"
  scopeNote?: string
  fingerprint: string | null
  changedFiles: string[]
  scopedTests: string[]
  checks: VerifyCheckResult[]
  passed: boolean
}

export interface VerifyRunInput {
  /** Directory to verify, relative to the workspace root (e.g. a tournament worktree). */
  dir?: string
  scope?: "changed" | "full"
  kinds?: VerifyKind[]
  paths?: string[]
  timeoutMs?: number
}

const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "").replace(/\r(?!\n)/g, "\n")
}

export function getVerifyDir(rootDir: string): string {
  return path.join(rootDir, ".opencode", "verify")
}

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return undefined
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function detectRunner(command: string): TestRunner {
  if (/\bbun\s+test\b/.test(command)) return "bun"
  if (/\bvitest\b/.test(command)) return "vitest"
  if (/\bjest\b/.test(command)) return "jest"
  if (/\bnode\s+--test\b/.test(command)) return "node"
  if (/\bpytest\b/.test(command)) return "pytest"
  if (/\bgo\s+test\b/.test(command)) return "go"
  if (/\bcargo\s+test\b/.test(command)) return "cargo"
  return "unknown"
}

async function packageManager(rootDir: string): Promise<string> {
  if ((await exists(path.join(rootDir, "bun.lock"))) || (await exists(path.join(rootDir, "bun.lockb")))) return "bun"
  if (await exists(path.join(rootDir, "pnpm-lock.yaml"))) return "pnpm"
  if (await exists(path.join(rootDir, "yarn.lock"))) return "yarn"
  return "npm"
}

const AGENTS_LINE_RE = /^\s*(?:[-*]\s*)?\**(typecheck|type-check|lint|test)\**\s*[:=]\s*`([^`]+)`/i

function normalizeKind(raw: string): VerifyKind {
  const k = raw.toLowerCase()
  return k === "type-check" ? "typecheck" : (k as VerifyKind)
}

/**
 * Discovers the repository's own verification commands. Explicit configuration wins:
 * `.opencode/swarmos.json` / `opencode.json` `verifier` field, then `AGENTS.md`, then
 * `package.json` scripts, then language defaults (Cargo, Go, pytest).
 */
export async function discoverChecks(rootDir: string): Promise<VerifyCheck[]> {
  const found = new Map<VerifyKind, VerifyCheck>()
  const add = (kind: VerifyKind, command: string, source: string) => {
    if (found.has(kind) || !command.trim()) return
    found.set(kind, { kind, command: command.trim(), source, ...(kind === "test" ? { runner: detectRunner(command) } : {}) })
  }

  for (const [file, label] of [
    [path.join(rootDir, ".opencode", "swarmos.json"), ".opencode/swarmos.json"],
    [path.join(rootDir, "opencode.json"), "opencode.json"],
  ] as const) {
    const verifier = (await readJson(file))?.verifier
    if (verifier && typeof verifier === "object") {
      for (const [k, v] of Object.entries(verifier)) {
        if (typeof v === "string" && /^(typecheck|type-check|lint|test)$/i.test(k)) add(normalizeKind(k), v, label)
      }
    }
  }

  try {
    const agentsMd = await fs.readFile(path.join(rootDir, "AGENTS.md"), "utf8")
    for (const line of agentsMd.split("\n")) {
      const m = AGENTS_LINE_RE.exec(line)
      if (m) add(normalizeKind(m[1]), m[2], "AGENTS.md")
    }
  } catch {
    // no AGENTS.md
  }

  const pkg = await readJson(path.join(rootDir, "package.json"))
  if (pkg?.scripts && typeof pkg.scripts === "object") {
    const pm = await packageManager(rootDir)
    const scripts = pkg.scripts as Record<string, string>
    const typecheckScript = ["typecheck", "type-check", "check-types", "tsc"].find((s) => scripts[s])
    if (typecheckScript) add("typecheck", `${pm} run ${typecheckScript}`, "package.json")
    else if (await exists(path.join(rootDir, "tsconfig.json"))) add("typecheck", "npx --no-install tsc --noEmit", "tsconfig.json")
    if (scripts.lint) add("lint", `${pm} run lint`, "package.json")
    if (scripts.test && !/no test specified/.test(scripts.test)) {
      // Keep the script's own runner so scoping can pass explicit test files to it.
      if (!found.has("test")) {
        found.set("test", { kind: "test", command: `${pm} run test`, source: "package.json", runner: detectRunner(scripts.test) })
      }
    }
  }

  if (await exists(path.join(rootDir, "Cargo.toml"))) {
    add("typecheck", "cargo check --quiet", "Cargo.toml")
    add("test", "cargo test --quiet", "Cargo.toml")
  }
  if (await exists(path.join(rootDir, "go.mod"))) {
    add("typecheck", "go vet ./...", "go.mod")
    add("test", "go test ./...", "go.mod")
  }
  if (
    (await exists(path.join(rootDir, "pyproject.toml"))) ||
    (await exists(path.join(rootDir, "pytest.ini"))) ||
    (await exists(path.join(rootDir, "setup.py")))
  ) {
    add("test", "python3 -m pytest -q", "python project")
  }

  const order: VerifyKind[] = ["typecheck", "lint", "test"]
  return order.flatMap((k) => (found.has(k) ? [found.get(k)!] : []))
}

async function git(rootDir: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: rootDir, timeout: 10000, maxBuffer: 32 * 1024 * 1024 })
    return stdout
  } catch {
    return undefined
  }
}

export async function listChangedFiles(rootDir: string): Promise<string[] | undefined> {
  const tracked = await git(rootDir, ["diff", "--name-only", "HEAD"])
  if (tracked === undefined) return undefined
  const untracked = (await git(rootDir, ["ls-files", "--others", "--exclude-standard"])) ?? ""
  const files = [...tracked.split("\n"), ...untracked.split("\n")].map((f) => f.trim()).filter(Boolean)
  return [...new Set(files)].filter((f) => !f.startsWith(".opencode/"))
}

/**
 * Fingerprint of the working tree relative to HEAD (tracked diff + untracked file contents).
 * QA receipts bind to it so a PASS cannot outlive later edits. Returns null outside git.
 */
export async function computeTreeFingerprint(rootDir: string): Promise<string | null> {
  const head = await git(rootDir, ["rev-parse", "HEAD"])
  if (head === undefined) return null
  const hash = createHash("sha256")
  hash.update(head.trim())
  hash.update((await git(rootDir, ["diff", "HEAD", "--", ".", ":(exclude).opencode"])) ?? "")
  const untracked = ((await git(rootDir, ["ls-files", "--others", "--exclude-standard"])) ?? "")
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f && !f.startsWith(".opencode/"))
    .sort()
  for (const f of untracked) {
    hash.update(`\0${f}\0`)
    try {
      hash.update(await fs.readFile(path.join(rootDir, f)))
    } catch {
      // vanished between listing and reading
    }
  }
  return hash.digest("hex").slice(0, 32)
}

const TEST_FILE_RE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:(?:^|\/)test_[^/]+\.py$)|(?:_test\.py$)|(?:_test\.go$)/

export function isTestFile(file: string): boolean {
  return TEST_FILE_RE.test(file)
}

function scopedTestCommand(check: VerifyCheck, testFiles: string[], goPackages: string[]): string | undefined {
  const quoted = testFiles.map((f) => JSON.stringify(f)).join(" ")
  switch (check.runner) {
    case "bun":
      return `bun test ${testFiles.map((f) => JSON.stringify(f.startsWith(".") ? f : `./${f}`)).join(" ")}`
    case "vitest":
      return `npx --no-install vitest run ${quoted}`
    case "jest":
      return `npx --no-install jest ${quoted}`
    case "node":
      return `node --test ${quoted}`
    case "pytest":
      return `python3 -m pytest -q ${quoted}`
    case "go":
      return goPackages.length ? `go test ${goPackages.join(" ")}` : undefined
    default:
      return undefined
  }
}

const FAILURE_LOC_RES = [
  // path:line:col or path:line
  /(?:^|[\s(])((?:\.{0,2}\/)?[\w@./-]+\.(?:[cm]?[jt]sx?|py|go|rs|vue|svelte|css))[:](\d+)(?::(\d+))?/,
  // tsc: path(line,col)
  /(?:^|\s)((?:\.{0,2}\/)?[\w@./-]+\.(?:[cm]?[jt]sx?))\((\d+),(\d+)\)/,
  // python traceback: File "path", line N
  /File "([^"]+\.py)", line (\d+)/,
]

const TEST_HEADER_RE = /^((?:\.{0,2}\/)?[\w@./-]+\.(?:[cm]?[jt]sx?)):$/
const NAMED_FAILURE_RES = [
  // jest / vitest: "FAIL test/a.test.ts" or " FAIL  src/a.spec.ts > suite > name"
  /^\s*FAIL\s+((?:\.{0,2}\/)?[\w@./-]+\.(?:[cm]?[jt]sx?))(.*)$/,
  // pytest: "FAILED tests/test_a.py::test_name - AssertionError"
  /^FAILED\s+([\w@./-]+\.py)::(\S+)(.*)$/,
]

export function extractFailures(output: string, rootDir?: string, max = 30): VerifyFailure[] {
  const failures: VerifyFailure[] = []
  const seen = new Set<string>()
  let currentTestFile: string | undefined
  for (const line of output.split("\n")) {
    if (failures.length >= max) break

    // bun test prints "path/to/file.test.ts:" headers then "(fail) test name" lines.
    const header = TEST_HEADER_RE.exec(line.trim())
    if (header) {
      currentTestFile = header[1]
      continue
    }
    const bunFail = /^\(fail\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?$/.exec(line.trim())
    if (bunFail && currentTestFile) {
      const key = `${currentTestFile}#${bunFail[1]}`
      if (!seen.has(key)) {
        seen.add(key)
        failures.push({ file: currentTestFile, message: `(fail) ${bunFail[1]}` })
      }
      continue
    }
    let named = false
    for (const re of NAMED_FAILURE_RES) {
      const m = re.exec(line)
      if (!m) continue
      named = true
      const key = `${m[1]}#${m[2]}`
      if (!seen.has(key)) {
        seen.add(key)
        failures.push({ file: m[1], message: line.trim().slice(0, 240) })
      }
      break
    }
    if (named) continue

    if (!/(error|fail|assert|expect|exception|panic|warning|✗|×)/i.test(line) && !/File "|^\s*at\s/.test(line)) continue
    for (const re of FAILURE_LOC_RES) {
      const m = re.exec(line)
      if (!m) continue
      let file = m[1]
      if (file.includes("node_modules") || file.startsWith("internal/")) break
      if (rootDir && path.isAbsolute(file)) file = path.relative(rootDir, file).split(path.sep).join("/")
      const key = `${file}:${m[2]}`
      if (seen.has(key)) break
      seen.add(key)
      failures.push({ file, line: Number(m[2]), ...(m[3] ? { col: Number(m[3]) } : {}), message: line.trim().slice(0, 240) })
      break
    }
  }
  return failures
}

function lastInt(text: string, re: RegExp): number | undefined {
  let last: number | undefined
  for (const m of text.matchAll(re)) last = Number(m[1])
  return last
}

function sumInt(text: string, re: RegExp): number {
  let total = 0
  for (const m of text.matchAll(re)) total += Number(m[1])
  return total
}

export function parseCounts(output: string, runner: TestRunner = "unknown"): { passed: number; failed: number } | undefined {
  if (runner === "cargo") {
    const passed = sumInt(output, /(\d+) passed;/g)
    const failed = sumInt(output, /(\d+) failed;/g)
    return /test result:/.test(output) ? { passed, failed } : undefined
  }
  if (runner === "go") {
    const failed = (output.match(/^--- FAIL:/gm) ?? []).length
    const passed = (output.match(/^--- PASS:/gm) ?? []).length
    const okPkgs = (output.match(/^ok\s+/gm) ?? []).length
    return failed + passed + okPkgs > 0 ? { passed: passed || okPkgs, failed } : undefined
  }
  const passed = lastInt(output, /(\d+)\s+(?:pass|passed|passing)\b/gi)
  const failed = lastInt(output, /(\d+)\s+(?:fail|failed|failing)\b/gi)
  if (passed === undefined && failed === undefined) return undefined
  return { passed: passed ?? 0, failed: failed ?? 0 }
}

function runShell(command: string, cwd: string, timeoutMs: number): Promise<{ exitCode: number; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" } },
      (err: any, stdout, stderr) => {
        const output = stripAnsi(`${stdout ?? ""}\n${stderr ?? ""}`)
        const timedOut = Boolean(err?.killed && err?.signal)
        resolve({ exitCode: err ? (typeof err.code === "number" ? err.code : 1) : 0, output, timedOut })
      },
    )
  })
}

async function resolveScope(
  rootDir: string,
  input: VerifyRunInput,
): Promise<{ changedFiles: string[]; scopedTests: string[]; goPackages: string[]; note?: string }> {
  const changed = input.paths?.length ? input.paths : ((await listChangedFiles(rootDir)) ?? [])
  if (changed.length === 0) return { changedFiles: [], scopedTests: [], goPackages: [], note: "no changed files; ran full suite" }

  const candidates = new Set<string>(changed)
  for (const file of changed.filter((f) => !isTestFile(f)).slice(0, 20)) {
    try {
      const radius = await analyzeBlastRadius(rootDir, file)
      for (const dep of radius.transitiveDependents) candidates.add(dep)
    } catch {
      // unparseable file: no dependents
    }
  }

  const scopedTests: string[] = []
  for (const f of candidates) {
    if (isTestFile(f) && (await exists(path.join(rootDir, f)))) scopedTests.push(f)
  }
  const goPackages = [...new Set(changed.filter((f) => f.endsWith(".go")).map((f) => `./${path.posix.dirname(f)}`))]
  return { changedFiles: changed, scopedTests: scopedTests.sort(), goPackages }
}

/**
 * Runs the repository's own checks, scoped to files changed in the working tree and the tests
 * that (transitively) import them, and persists a structured run under `.opencode/verify/`.
 */
export async function runVerify(rootDir: string, input: VerifyRunInput = {}): Promise<VerifyRun> {
  const checks = (await discoverChecks(rootDir)).filter((c) => !input.kinds || input.kinds.includes(c.kind))
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 300_000, 5_000), 1_800_000)
  let scope: "changed" | "full" = input.scope ?? "changed"
  const scoping = scope === "changed" ? await resolveScope(rootDir, input) : { changedFiles: [], scopedTests: [], goPackages: [] }
  let scopeNote = (scoping as any).note as string | undefined

  const results: VerifyCheckResult[] = []
  for (const check of checks) {
    let command = check.command
    if (check.kind === "test" && scope === "changed") {
      const scoped = scoping.scopedTests.length || scoping.goPackages.length
        ? scopedTestCommand(check, scoping.scopedTests, scoping.goPackages)
        : undefined
      if (scoped) command = scoped
      else if (scoping.changedFiles.length > 0) {
        scopeNote = scoping.scopedTests.length
          ? `runner "${check.runner}" cannot be scoped; ran full test command`
          : "no tests import the changed files; ran full test command"
      }
    }

    const started = Date.now()
    const { exitCode, output, timedOut } = await runShell(command, rootDir, timeoutMs)
    const lines = output.split("\n").filter((l) => l.trim())
    results.push({
      kind: check.kind,
      command,
      source: check.source,
      exitCode,
      passed: exitCode === 0 && !timedOut,
      timedOut,
      durationMs: Date.now() - started,
      ...(check.kind === "test" ? { counts: parseCounts(output, check.runner) } : {}),
      failures: exitCode === 0 ? [] : extractFailures(output, rootDir),
      outputTail: lines.slice(-40).join("\n"),
    })
  }

  if (scope === "changed" && scoping.changedFiles.length === 0) scope = "full"

  const run: VerifyRun = {
    id: `verify-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    rootDir: path.resolve(rootDir),
    scope,
    ...(scopeNote ? { scopeNote } : {}),
    fingerprint: await computeTreeFingerprint(rootDir),
    changedFiles: scoping.changedFiles,
    scopedTests: scoping.scopedTests,
    checks: results,
    passed: results.length > 0 && results.every((r) => r.passed),
  }
  await saveVerifyRun(rootDir, run)
  return run
}

export async function saveVerifyRun(rootDir: string, run: VerifyRun): Promise<void> {
  const dir = path.join(getVerifyDir(rootDir), "runs")
  await fs.mkdir(dir, { recursive: true })
  const payload = JSON.stringify(run, null, 2)
  await fs.writeFile(path.join(dir, `${run.id}.json`), payload, "utf8")
  await fs.writeFile(path.join(getVerifyDir(rootDir), "latest.json"), payload, "utf8")
  if (run.scope === "full") await fs.writeFile(path.join(getVerifyDir(rootDir), "latest-full.json"), payload, "utf8")
}

export async function loadVerifyRun(rootDir: string, runId: string): Promise<VerifyRun | undefined> {
  return readJson(path.join(getVerifyDir(rootDir), "runs", `${path.basename(runId)}.json`))
}

export async function loadLatestVerifyRun(rootDir: string, scope?: "full"): Promise<VerifyRun | undefined> {
  return readJson(path.join(getVerifyDir(rootDir), scope === "full" ? "latest-full.json" : "latest.json"))
}

export function formatVerifyRun(run: VerifyRun): string {
  const lines = [
    `Verify ${run.passed ? "PASSED" : "FAILED"} [${run.id}] scope=${run.scope}${run.scopeNote ? ` (${run.scopeNote})` : ""}`,
  ]
  if (run.checks.length === 0) lines.push("No verification commands discovered. Add a `verifier` field to .opencode/swarmos.json.")
  for (const c of run.checks) {
    const counts = c.counts ? ` ${c.counts.passed} passed / ${c.counts.failed} failed` : ""
    lines.push(`- ${c.kind}: ${c.passed ? "pass" : c.timedOut ? "TIMEOUT" : `FAIL (exit ${c.exitCode})`}${counts} — \`${c.command}\` (${c.durationMs}ms)`)
    for (const f of c.failures.slice(0, 15)) {
      lines.push(`    ${f.file}${f.line ? `:${f.line}` : ""}${f.col ? `:${f.col}` : ""} ${f.message}`)
    }
    if (!c.passed && c.failures.length === 0) lines.push(c.outputTail.split("\n").slice(-15).map((l) => `    ${l}`).join("\n"))
  }
  return lines.join("\n")
}

export function resolveVerifyDir(rootDir: string, dir?: string): string {
  if (!dir) return rootDir
  const abs = path.resolve(rootDir, dir)
  const rel = path.relative(path.resolve(rootDir), abs)
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`SwarmOS Verify: "${dir}" is outside the workspace.`)
  return abs
}

export function registerVerifyTools(editor: any, rootDir: string, pinned = true): void {
  editor.namespace({
    name: "verify",
    description:
      "Run the repository's own typecheck, lint and test commands scoped to changed files, with structured pass/fail counts and file:line failures.",
  })

  editor.add({
    name: "run",
    description:
      "Run the repo's verification commands. scope 'changed' (default) runs typecheck/lint plus only the tests that import changed files; 'full' runs everything. Returns a run ID that QA receipts must cite.",
    options: { namespace: "verify", codemode: true, pinned },
    input: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Directory to verify relative to the workspace root, e.g. a tournament worktree '.worktrees/<taskId>'" },
        scope: { type: "string", enum: ["changed", "full"], description: "Scope of the run (default 'changed')" },
        kinds: { type: "array", items: { type: "string", enum: ["typecheck", "lint", "test"] }, description: "Subset of checks to run" },
        paths: { type: "array", items: { type: "string" }, description: "Override the changed-file set" },
        timeoutMs: { type: "number", description: "Per-check timeout (default 300000)" },
      },
    },
    output: { type: "object" },
    execute: async (input: VerifyRunInput) => {
      const run = await runVerify(resolveVerifyDir(rootDir, input?.dir), input ?? {})
      return { output: run, content: formatVerifyRun(run) }
    },
  })

  editor.add({
    name: "checks",
    description: "List the verification commands SwarmOS discovered for this repository and where each came from.",
    options: { namespace: "verify", codemode: true, pinned },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const checks = await discoverChecks(rootDir)
      return { output: { checks }, content: JSON.stringify(checks, null, 2) }
    },
  })
}
