import { describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  assertTaskInvariants,
  astRewriteWorkspace,
  moveModuleAndRewriteImports,
  extractFaultContext,
  auditDiffCoverageAndTautology,
  graduateLessonsToSkill,
  recordFileReadTimestamp,
  checkStaleFileRead,
  buildCompactionPins,
  captureWorkspaceMtimeSnapshot,
  diffWorkspaceSnapshots,
  inspectInstalledPackage,
  speculativeIntegrateWorktrees,
  UX_INTERACTION_WALKER_SCRIPT,
  recordLesson,
  initProject,
  lockContract,
  createTask,
} from "../src/index.js"

describe("SwarmOS v1.1.0 — 10 Autonomous Self-Healing & Next-Gen Upgrades", () => {
  test("Upgrades 1–10 end-to-end verification", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-v110-"))
    await fs.mkdir(path.join(tmp, "src"), { recursive: true })
    await fs.writeFile(path.join(tmp, "src/service.ts"), "export function oldCall(x) {\n  return console.log(x);\n}\n", "utf8")
    await fs.writeFile(path.join(tmp, "src/caller.ts"), "import { oldCall } from './service.js';\nexport const y = oldCall(42);\n", "utf8")

    // Upgrade 1: Invariants
    const inv = await assertTaskInvariants(tmp, [
      { description: "service exists", checkType: "file_exists", targetPath: "src/service.ts" },
      { description: "exports oldCall", checkType: "pattern_present", targetPath: "src/service.ts", pattern: "export function oldCall" },
    ])
    expect(inv.passed).toBe(true)

    // Upgrade 2: AST Rewrite & Module Move
    const rw = await astRewriteWorkspace(tmp, {
      pattern: "console.log($VAL)",
      replacement: "logger.info($VAL)",
    })
    expect(rw.totalReplacements).toBe(1)
    const moved = await moveModuleAndRewriteImports(tmp, "src/service.ts", "src/core/service.ts")
    expect(moved.updatedImporters).toContain("src/caller.ts")

    // Upgrade 3: Stack-Frame Fault Localizer
    const fakeTrace = `Error: Boom\n    at oldCall (${path.join(tmp, "src/core/service.ts")}:2:10)`
    const frames = await extractFaultContext(tmp, fakeTrace)
    expect(frames).toHaveLength(1)
    expect(frames[0].file).toBe("src/core/service.ts")

    // Upgrade 4: Diff-Coverage & Anti-Mock-Tautology
    const cov = auditDiffCoverageAndTautology({
      lcovText: "SF:src/core/service.ts\nDA:1,1\nDA:2,1\nend_of_record\n",
      changedLinesByFile: { "src/core/service.ts": [1, 2] },
      testFileContents: { "test/service.test.ts": "expect(1).toBe(1)" },
    })
    expect(cov.passed).toBe(true)
    expect(cov.coveragePercent).toBe(100)

    // Upgrade 5: Memory-to-Skill Graduation
    await recordLesson(tmp, { id: "les-1", trigger: "ESM imports", lesson: "Always use .js extension in relative TypeScript imports." })
    const grad = await graduateLessonsToSkill(tmp, {
      skillId: "esm-rules",
      name: "ESM Import Rules",
      description: "Enforces .js relative specifiers",
    })
    expect(grad.graduatedLessonCount).toBe(1)

    // Upgrade 6: Stale-Read Detector & Compaction Pinning
    await recordFileReadTimestamp(tmp, "sess-1", "src/caller.ts")
    await new Promise((r) => setTimeout(r, 15))
    await fs.writeFile(path.join(tmp, "src/caller.ts"), "// mutated externally\n", "utf8")
    const stale = await checkStaleFileRead(tmp, "sess-1", "src/caller.ts")
    expect(stale.stale).toBe(true)

    await initProject(tmp, { name: "TestV110", vision: "Self-healing", aestheticArchetype: "High-Craft Technical Dark" })
    await lockContract(tmp, { id: "c-1", title: "Core Contract", files: ["src/core/service.ts"], invariants: ["No console.log"] })
    await createTask(tmp, { id: "t-1", title: "Caller Task", owner: "staff-backend", ownedPaths: ["src/caller.ts"] })
    const pins = await buildCompactionPins(tmp)
    expect(pins).toContain("Contract [c-1]")

    // Upgrade 7: Subagent Execution Receipt Snapshot Diff
    const snapBefore = await captureWorkspaceMtimeSnapshot(tmp)
    await fs.writeFile(path.join(tmp, "src/new-mod.ts"), "export const z = 1;\n", "utf8")
    const snapAfter = await captureWorkspaceMtimeSnapshot(tmp)
    const snapDiff = diffWorkspaceSnapshots(snapBefore, snapAfter)
    expect(snapDiff.createdFiles).toContain("src/new-mod.ts")

    // Upgrade 8: Installed-Package Inspector
    await fs.mkdir(path.join(tmp, "node_modules/sample-lib"), { recursive: true })
    await fs.writeFile(
      path.join(tmp, "node_modules/sample-lib/package.json"),
      JSON.stringify({ name: "sample-lib", version: "4.2.0", license: "MIT", types: "index.d.ts" }),
    )
    await fs.writeFile(
      path.join(tmp, "node_modules/sample-lib/index.d.ts"),
      "export declare function createFiber(id: string): Promise<void>;\n",
    )
    const pkgInfo = await inspectInstalledPackage(tmp, "sample-lib")
    expect(pkgInfo.version).toBe("4.2.0")
    expect(pkgInfo.exportedDeclarations.length).toBeGreaterThan(0)

    // Upgrade 9: Speculative Worktree Integration Sandbox
    const integ = await speculativeIntegrateWorktrees(tmp, { taskIds: ["t-1"] })
    expect(integ.readyToFastForward).toBe(true)

    // Upgrade 10: Interactive UI State-Matrix Walker Script
    expect(UX_INTERACTION_WALKER_SCRIPT).toContain("missingFocusRingCount")
  })
})
