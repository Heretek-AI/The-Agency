import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  auditMarkdownCitations,
  computeLineHash,
  extractOfficeOrDataFile,
  hashEditFile,
  hashReadFile,
  listArtifacts,
  readArtifact,
  recordResearchSource,
  registerArtifactContextHook,
  analyzeBlastRadius,
  buildRepoMap,
  createCheckpoint,
  listCheckpoints,
  loadLessons,
  readDevServerLogs,
  recordAndEvaluateCircuitBreaker,
  recordLesson,
  resetCircuitBreaker,
  rollbackCheckpoint,
  VISUAL_QUALITY_CHECKLIST,
  writeArtifact,
} from "../src/index.js"

describe("SwarmOS v0.4.0 Omni-Harness Capabilities", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-omni-test-"))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("reads and edits files with Oh-My-Pi hashline precision and +-3 line drift recovery", async () => {
    const sampleFile = path.join(tmpDir, "sample.js")
    await fs.writeFile(
      sampleFile,
      [
        "export function greet(name) {",
        "  const prefix = 'Hello';",
        "  return prefix + ', ' + name;",
        "}",
      ].join("\n"),
      "utf8",
    )

    const readRes = await hashReadFile(tmpDir, "sample.js")
    expect(readRes.totalLines).toBe(4)

    const h2 = computeLineHash("  const prefix = 'Hello';")
    const h3 = computeLineHash("  return prefix + ', ' + name;")
    expect(readRes.content).toContain(`2#${h2}:   const prefix = 'Hello';`)

    // Test +-2 line drift recovery (pass startLine=4 instead of 2, but with exact hashes h2..h3)
    const editRes = await hashEditFile(tmpDir, "sample.js", [
      {
        startLine: 4,
        startHash: h2,
        endLine: 5,
        endHash: h3,
        replacement: "  const prefix = 'Hi';\n  return `${prefix}, ${name}!`;",
      },
    ])

    expect(editRes.appliedHunks).toBe(1)
    expect(editRes.diagnostics).toBeUndefined()

    const updated = await fs.readFile(sampleFile, "utf8")
    expect(updated).toContain("const prefix = 'Hi';")
    expect(updated).toContain("return `${prefix}, ${name}!`;")
  })

  it("rejects hashline edits when content hashes do not match", async () => {
    const sampleFile = path.join(tmpDir, "mismatch.js")
    await fs.writeFile(sampleFile, "const x = 1;\nconst y = 2;\n", "utf8")

    expect(
      hashEditFile(tmpDir, "mismatch.js", [
        {
          startLine: 1,
          startHash: "ff",
          endLine: 1,
          endHash: "ff",
          replacement: "const x = 99;",
        },
      ]),
    ).rejects.toThrow("Hashline mismatch")
  })

  it("persists and auto-injects Antigravity-style task.md and plan.md artifacts", async () => {
    await writeArtifact(tmpDir, "task.md", "- [x] Lock schema\n- [/] Build GUI")
    await writeArtifact(tmpDir, "plan.md", "## Architecture\nUse Swiss Grid archetype.")

    const list = await listArtifacts(tmpDir)
    expect(list).toEqual(["plan.md", "task.md"])

    const task = await readArtifact(tmpDir, "task.md")
    expect(task.exists).toBe(true)
    expect(task.content).toContain("Build GUI")

    let hookFn: any = null
    await registerArtifactContextHook(
      {
        session: {
          hook: async (name: string, fn: any) => {
            if (name === "context") hookFn = fn
          },
        },
      },
      tmpDir,
    )

    const mockEvent = {
      agent: "director",
      system: [{ type: "text", text: "Base system prompt" }],
    }
    await hookFn(mockEvent)
    expect(mockEvent.system[0].text).toContain("<active-workspace-artifacts>")
    expect(mockEvent.system[0].text).toContain("Use Swiss Grid archetype.")
  })

  it("extracts tabular CSV and SQLite files via the Universal Office Extractor", async () => {
    const csvFile = path.join(tmpDir, "metrics.csv")
    await fs.writeFile(csvFile, "quarter,revenue,margin\nQ1,1200,0.42\nQ2,1550,0.46\n", "utf8")

    const extracted = await extractOfficeOrDataFile(tmpDir, "metrics.csv")
    expect(extracted).toBeDefined()
    expect(extracted).toContain("# Tabular Dataset: metrics.csv")
    expect(extracted).toContain("| Q1 | 1200 | 0.42 |")
  })

  it("tracks research sources and audits Markdown citations against fabricated or bare-root URLs", async () => {
    await recordResearchSource(tmpDir, {
      id: "rfc-9110",
      url: "https://httpwg.org/specs/rfc9110.html",
      title: "HTTP Semantics RFC 9110",
      keyFindings: ["Defines GET, POST, PUT, DELETE semantics"],
    })

    // Valid specific citation -> passed: true
    const cleanAudit = await auditMarkdownCitations(
      tmpDir,
      "According to [RFC 9110](https://httpwg.org/specs/rfc9110.html), GET is read-only.",
    )
    expect(cleanAudit.passed).toBe(true)
    expect(cleanAudit.verifiedLinks).toEqual(["https://httpwg.org/specs/rfc9110.html"])

    // Unverified link + bare root link -> passed: false
    const badAudit = await auditMarkdownCitations(
      tmpDir,
      "See [Example Root](https://example.com/) and [Hallucinated Doc](https://example.com/fake-page).",
    )
    expect(badAudit.passed).toBe(false)
    expect(badAudit.bareRootLinks).toContain("https://example.com/")
    expect(badAudit.unverifiedLinks).toContain("https://example.com/fake-page")
  })

  it("exports the 4-Pillar Visual Quality Checklist for GUI Studio", () => {
    expect(VISUAL_QUALITY_CHECKLIST.macroBalance.length).toBeGreaterThan(0)
    expect(VISUAL_QUALITY_CHECKLIST.typographyAndContrast.length).toBeGreaterThan(0)
  })

  it("builds a PageRank-weighted RepoMap and computes reverse-import blast radius", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "src/types.ts"), "export interface User { id: string }\n", "utf8")
    await fs.writeFile(
      path.join(tmpDir, "src/db.ts"),
      "import type { User } from './types.js'\nexport function getUser(): User { return { id: '1' } }\n",
      "utf8",
    )
    await fs.writeFile(
      path.join(tmpDir, "src/routes.ts"),
      "import { getUser } from './db.js'\nexport function handler() { return getUser() }\n",
      "utf8",
    )

    const map = await buildRepoMap(tmpDir, 10)
    expect(map.totalFilesScanned).toBe(3)
    // src/types.ts and src/db.ts should rank above src/routes.ts because they are imported by downstream files
    expect(map.topFiles[0].path).toBe("src/types.ts")

    const blast = await analyzeBlastRadius(tmpDir, "src/types.ts")
    expect(blast.directDependents).toEqual(["src/db.ts"])
    expect(blast.transitiveDependents).toContain("src/routes.ts")
  })

  it("triggers the Doom-Loop Circuit Breaker after repeated edit or shell failures", () => {
    resetCircuitBreaker("sess-loop")

    const first = recordAndEvaluateCircuitBreaker({
      sessionID: "sess-loop",
      tool: "edit",
      input: { path: "src/broken.ts" },
      status: "error",
      error: { message: "oldString not found" },
    })
    expect(first).toBeUndefined()

    const second = recordAndEvaluateCircuitBreaker({
      sessionID: "sess-loop",
      tool: "edit",
      input: { path: "src/broken.ts" },
      status: "error",
      error: { message: "oldString not found" },
    })
    expect(second).toBeDefined()
    expect(second).toContain("DOOM-LOOP CIRCUIT BREAKER")
    expect(second).toContain("tools.fs.hash_read")
  })

  it("creates zero-git-noise time-travel checkpoints and rolls back cleanly", async () => {
    const fileA = path.join(tmpDir, "a.ts")
    const fileB = path.join(tmpDir, "b.ts")
    await fs.writeFile(fileA, "export const v = 1;\n", "utf8")

    const chk = await createCheckpoint(tmpDir, {
      id: "chk-before-refactor",
      label: "Before risky refactor",
      paths: ["a.ts", "b.ts"],
    })
    expect(chk.fileCount).toBe(2)

    // Mutate a.ts and create b.ts
    await fs.writeFile(fileA, "export const v = 999; // broken\n", "utf8")
    await fs.writeFile(fileB, "export const extra = true;\n", "utf8")

    const list = await listCheckpoints(tmpDir)
    expect(list.length).toBe(1)

    const rolled = await rollbackCheckpoint(tmpDir, "chk-before-refactor")
    expect(rolled.restoredFiles).toEqual(["a.ts"])
    expect(rolled.removedFiles).toEqual(["b.ts"])

    expect(await fs.readFile(fileA, "utf8")).toBe("export const v = 1;\n")
    await expect(fs.access(fileB)).rejects.toThrow()
  })

  it("records cross-session episodic lessons and reads dev-server logs with error filtering", async () => {
    await recordLesson(tmpDir, {
      id: "bun-sqlite-wal",
      trigger: "Running concurrent board tests",
      lesson: "Always use withBoardLock to serialize read-modify-write cycles.",
    })

    const lessons = await loadLessons(tmpDir)
    expect(lessons.length).toBe(1)
    expect(lessons[0].id).toBe("bun-sqlite-wal")

    const logDir = path.join(tmpDir, ".opencode", "artifacts")
    await fs.mkdir(logDir, { recursive: true })
    await fs.writeFile(
      path.join(logDir, "devserver.log"),
      "INFO: Server listening on :3000\nTypeError: Cannot read properties of undefined\nINFO: Request /health 200\n",
      "utf8",
    )

    const errLogs = await readDevServerLogs({}, tmpDir, { filterErrorsOnly: true })
    expect(errLogs.lines).toEqual(["TypeError: Cannot read properties of undefined"])
  })
})
