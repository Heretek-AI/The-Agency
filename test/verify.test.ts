import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  createTask,
  initProject,
  lockContract,
  submitQAReceipt,
  verifyReleaseReady,
} from "../src/board/board.js"
import {
  discoverChecks,
  extractFailures,
  parseCounts,
  runVerify,
  stripAnsi,
} from "../src/omni/verify.js"

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" })
}

async function initRepo(dir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
    await fs.writeFile(path.join(dir, rel), content)
  }
  git(dir, "init", "-q")
  git(dir, "config", "user.email", "test@example.com")
  git(dir, "config", "user.name", "Test")
  git(dir, "add", "-A")
  git(dir, "commit", "-qm", "init")
}

describe("SwarmOS v0.6.0 tools.verify", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-verify-test-"))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("discovers checks from package.json and lets AGENTS.md and swarmos.json override them", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { typecheck: "tsc --noEmit", lint: "oxlint", test: "bun test" } }),
    )
    await fs.writeFile(path.join(tmpDir, "bun.lock"), "")
    let checks = await discoverChecks(tmpDir)
    expect(checks.map((c) => `${c.kind}:${c.command}`)).toEqual([
      "typecheck:bun run typecheck",
      "lint:bun run lint",
      "test:bun run test",
    ])
    expect(checks.find((c) => c.kind === "test")?.runner).toBe("bun")

    await fs.writeFile(path.join(tmpDir, "AGENTS.md"), "## Checks\n- test: `bun test --bail`\n")
    await fs.mkdir(path.join(tmpDir, ".opencode"))
    await fs.writeFile(path.join(tmpDir, ".opencode", "swarmos.json"), JSON.stringify({ verifier: { lint: "true" } }))
    checks = await discoverChecks(tmpDir)
    expect(checks.find((c) => c.kind === "test")).toMatchObject({ command: "bun test --bail", source: "AGENTS.md" })
    expect(checks.find((c) => c.kind === "lint")).toMatchObject({ command: "true", source: ".opencode/swarmos.json" })
  })

  it("strips ANSI codes and parses pass/fail counts across runners", () => {
    expect(stripAnsi("\u001b[32m 3 pass\u001b[0m")).toBe(" 3 pass")
    expect(parseCounts(" 12 pass\n 2 fail\n", "bun")).toEqual({ passed: 12, failed: 2 })
    expect(parseCounts("Tests:       1 failed, 9 passed, 10 total", "jest")).toEqual({ passed: 9, failed: 1 })
    expect(parseCounts("==== 2 failed, 30 passed in 1.2s ====", "pytest")).toEqual({ passed: 30, failed: 2 })
    expect(
      parseCounts("test result: ok. 4 passed; 0 failed;\ntest result: FAILED. 1 passed; 2 failed;", "cargo"),
    ).toEqual({ passed: 5, failed: 2 })
    expect(parseCounts("--- FAIL: TestA (0.00s)\nok  \tpkg/b\t0.1s\n", "go")).toEqual({ passed: 1, failed: 1 })
  })

  it("extracts file:line failures from tsc, bun and python output", () => {
    const failures = extractFailures(
      [
        "src/app.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
        "error: expect(received).toBe(expected)",
        "      at <anonymous> (/repo/test/app.test.ts:8:20)",
        '  File "pkg/mod.py", line 41, in run',
        "node_modules/x/index.js:1:1 error ignored",
      ].join("\n"),
      "/repo",
    )
    expect(failures.map((f) => `${f.file}:${f.line}`)).toEqual(["src/app.ts:12", "test/app.test.ts:8", "pkg/mod.py:41"])

    const named = extractFailures(
      [
        "test/math.test.ts:",
        "error: expect(received).toBe(expected)",
        "(fail) adds [0.24ms]",
        " FAIL  src/a.spec.ts > suite > works",
        "FAILED tests/test_mod.py::test_run - AssertionError",
      ].join("\n"),
    )
    expect(named.map((f) => f.file)).toEqual(["test/math.test.ts", "src/a.spec.ts", "tests/test_mod.py"])
    expect(named[0].message).toBe("(fail) adds")
  })

  it("scopes tests to those importing the changed files and gates PASS receipts on a passing run", async () => {
    await initRepo(tmpDir, {
      ".gitignore": ".opencode/\n",
      ".opencode/swarmos.json": JSON.stringify({ verifier: { test: "bun test" } }),
      "src/math.ts": "export const add = (a: number, b: number) => a + b\n",
      "src/other.ts": "export const id = (x: number) => x\n",
      "test/math.test.ts":
        'import { expect, it } from "bun:test"\nimport { add } from "../src/math.ts"\nit("adds", () => expect(add(2, 2)).toBe(4))\n',
      "test/other.test.ts":
        'import { expect, it } from "bun:test"\nimport { id } from "../src/other.ts"\nit("id", () => expect(id(1)).toBe(1))\n',
    })

    await initProject(tmpDir, { name: "Gate", vision: "verified receipts", aestheticArchetype: "Swiss Grid / Data-Dense Workbench" })
    await lockContract(tmpDir, { id: "c1", title: "Math", files: ["src/math.ts"], invariants: [] })
    await createTask(tmpDir, { id: "t1", title: "Break math", owner: "staff-backend", ownedPaths: ["src/math.ts"] })

    // Break math.ts: only math.test.ts should run, and it should fail.
    await fs.writeFile(path.join(tmpDir, "src/math.ts"), "export const add = (a: number, b: number) => a - b\n")
    const failing = await runVerify(tmpDir)
    expect(failing.scope).toBe("changed")
    expect(failing.scopedTests).toEqual(["test/math.test.ts"])
    expect(failing.passed).toBe(false)
    expect(failing.checks[0].counts).toEqual({ passed: 0, failed: 1 })
    expect(failing.checks[0].failures.some((f) => f.file === "test/math.test.ts")).toBe(true)

    await expect(
      submitQAReceipt(tmpDir, { taskId: "t1", verdict: "PASS", summary: "trust me", defects: [] }),
    ).rejects.toThrow("must cite a passing")
    await expect(
      submitQAReceipt(tmpDir, { taskId: "t1", verdict: "PASS", summary: "x", defects: [], verifyRunId: failing.id }),
    ).rejects.toThrow("FAILED")

    // Fix it, verify, and the receipt is accepted.
    await fs.writeFile(path.join(tmpDir, "src/math.ts"), "export const add = (a: number, b: number) => b + a\n")
    const passing = await runVerify(tmpDir)
    expect(passing.passed).toBe(true)
    const task = await submitQAReceipt(tmpDir, { taskId: "t1", verdict: "PASS", summary: "ok", defects: [], verifyRunId: passing.id })
    expect(task.qaReceipts.at(-1)?.verifyRunId).toBe(passing.id)

    // Release needs a full run on the current tree.
    let report = await verifyReleaseReady(tmpDir)
    expect(report.ready).toBe(false)
    expect(report.blockers.join("\n")).toContain("No full verification run")
    const full = await runVerify(tmpDir, { scope: "full" })
    expect(full.passed).toBe(true)
    report = await verifyReleaseReady(tmpDir)
    expect(report.blockers).toEqual([])
    expect(report.ready).toBe(true)

    // Any later edit makes both the receipt evidence and the full run stale.
    await fs.writeFile(path.join(tmpDir, "src/other.ts"), "export const id = (x: number) => x + 0\n")
    report = await verifyReleaseReady(tmpDir)
    expect(report.ready).toBe(false)
    expect(report.blockers.join("\n")).toContain("Code changed since full verification run")
    await expect(
      submitQAReceipt(tmpDir, { taskId: "t1", verdict: "PASS", summary: "stale", defects: [], verifyRunId: passing.id }),
    ).rejects.toThrow("code changed since verify run")
  }, 60_000)
})
