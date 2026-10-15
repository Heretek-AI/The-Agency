import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface OutlineResult {
  path: string
  totalLines: number
  symbols: string[]
}

export async function extractOutline(rootDir: string, targetPath: string): Promise<OutlineResult> {
  const abs = path.resolve(rootDir, targetPath)
  const text = await fs.readFile(abs, "utf8")
  const lines = text.split("\n")

  const declRe =
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|enum|struct|fn|def|impl)\s+([A-Za-z0-9_$]+)/

  const symbols: string[] = []
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    if (declRe.test(line)) {
      symbols.push(`L${idx + 1}: ${line.trim().slice(0, 140)}`)
    }
  }

  return {
    path: targetPath,
    totalLines: lines.length,
    symbols,
  }
}

export function registerFSTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "fs",
    description: "Read-only filesystem & symbol outline helpers for batching multi-file inspection inside Code Mode.",
  })

  editor.add({
    name: "outline",
    description: "Return exported symbols, classes, interfaces, and function signatures with line numbers for a source file.",
    options: { namespace: "fs", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative or absolute file path to inspect" },
      },
      required: ["path"],
    },
    output: {
      type: "object",
      properties: {
        path: { type: "string" },
        totalLines: { type: "number" },
        symbols: { type: "array", items: { type: "string" } },
      },
      required: ["path", "totalLines", "symbols"],
    },
    execute: async (input: { path: string }) => {
      const result = await extractOutline(rootDir, input.path)
      return { output: result, content: JSON.stringify(result, null, 2) }
    },
  })
}
