import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { extractMutatedPaths, runQuickDiagnostics } from "../src/diagnostics/runner.js"

describe("SwarmOS Diagnostics Runner", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-diag-test-"))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("returns undefined for clean JS/TS files", async () => {
    const cleanFile = path.join(tmpDir, "clean.js")
    await fs.writeFile(cleanFile, "const a = 1;\nexport default a;\n", "utf8")

    const result = await runQuickDiagnostics(tmpDir, "clean.js")
    expect(result).toBeUndefined()
  })

  it("detects syntax errors in JS files", async () => {
    const badFile = path.join(tmpDir, "broken.js")
    await fs.writeFile(badFile, "const a = ;\n", "utf8")

    const result = await runQuickDiagnostics(tmpDir, "broken.js")
    expect(result).toBeDefined()
    expect(result).toContain("<diagnostics file=\"broken.js\">")
    expect(result).toContain("</diagnostics>")
  })

  it("detects syntax errors in Python files", async () => {
    const badPy = path.join(tmpDir, "broken.py")
    await fs.writeFile(badPy, "def foo(\n", "utf8")

    const result = await runQuickDiagnostics(tmpDir, "broken.py")
    expect(result).toBeDefined()
    expect(result).toContain("<diagnostics file=\"broken.py\">")
    expect(result).toContain("SyntaxError")
  })

  it("returns undefined for clean Python files", async () => {
    const cleanPy = path.join(tmpDir, "clean.py")
    await fs.writeFile(cleanPy, "def foo():\n    return 42\n", "utf8")

    const result = await runQuickDiagnostics(tmpDir, "clean.py")
    expect(result).toBeUndefined()
  })

  it("extracts mutated paths from patch tool applied output", () => {
    const paths = extractMutatedPaths({
      tool: "patch",
      input: { patchText: "*** Begin Patch..." },
      result: {
        output: {
          applied: [
            { type: "update", resource: "src/a.ts", target: "src/a.ts" },
            { type: "add", resource: "src/b.ts" },
            { type: "delete", resource: "src/old.ts" },
          ],
        },
      },
    })
    expect(paths).toEqual(["src/a.ts", "src/b.ts"])
  })
})
