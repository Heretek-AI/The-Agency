import { execFile } from "node:child_process"
import * as path from "node:path"
import { promisify } from "node:util"
import { runParallelDiagnostics } from "./warm-lsp.js"

const execFileAsync = promisify(execFile)

export interface DiagnosticOptions {
  timeoutMs?: number
  maxLines?: number
}

/**
 * Runs quick, file-scoped syntax and typecheck diagnostics on mutated files.
 * Returns formatted <diagnostics> block or undefined if clean.
 */
export async function runQuickDiagnostics(
  rootDir: string,
  filePath: string,
  options: DiagnosticOptions = {},
): Promise<string | undefined> {
  const abs = path.resolve(rootDir, filePath)
  const ext = path.extname(abs).toLowerCase()
  const timeout = options.timeoutMs ?? 6000
  const maxLines = options.maxLines ?? 30

  try {
    if (ext === ".py") {
      await execFileAsync("python3", ["-m", "py_compile", abs], { cwd: rootDir, timeout })
      return undefined
    }

    if (ext === ".rs") {
      await execFileAsync("cargo", ["check", "--message-format=short", "--quiet"], { cwd: rootDir, timeout: 12000 })
      return undefined
    }

    if (ext === ".go") {
      await execFileAsync("go", ["vet", abs], { cwd: rootDir, timeout: 8000 })
      return undefined
    }

    if ([".js", ".cjs", ".mjs"].includes(ext)) {
      await execFileAsync("node", ["--check", abs], { cwd: rootDir, timeout })
      return undefined
    }

    if ([".ts", ".tsx", ".jsx"].includes(ext)) {
      // Try oxlint if available
      try {
        await execFileAsync("oxlint", ["--quiet", abs], { cwd: rootDir, timeout })
        return undefined
      } catch (oxErr: any) {
        if (oxErr?.code !== "ENOENT") {
          throw oxErr
        }
      }

      // Fallback: check syntax using bun if running under bun
      if (typeof (globalThis as any).Bun !== "undefined") {
        try {
          const transpiler = new (globalThis as any).Bun.Transpiler({
            loader: ext.slice(1) as any,
          })
          const content = await (globalThis as any).Bun.file(abs).text()
          transpiler.transformSync(content)
          return undefined
        } catch (transpileErr: any) {
          const errText = transpileErr?.message ?? String(transpileErr)
          return `\n\n<diagnostics file="${filePath}">\n${errText}\n</diagnostics>`
        }
      }

      return undefined
    }
  } catch (err: any) {
    const out = [err?.stdout, err?.stderr, err?.message].filter(Boolean).join("\n").trim()
    if (!out) return undefined
    const bounded = out.split("\n").slice(0, maxLines).join("\n")
    return `\n\n<diagnostics file="${filePath}">\n${bounded}\n</diagnostics>`
  }

  return undefined
}

/**
 * Extracts mutated file paths from `edit`, `write`, or `patch` tool events.
 */
export function extractMutatedPaths(event: any): string[] {
  const paths: string[] = []
  if (typeof event?.input?.path === "string") {
    paths.push(event.input.path)
  } else if (event?.tool === "patch" && Array.isArray(event?.result?.output?.applied)) {
    for (const item of event.result.output.applied) {
      if (!item || item.type === "delete") continue
      const target = item.target ?? item.resource
      if (typeof target === "string" && !paths.includes(target)) {
        paths.push(target)
      }
    }
  }
  return paths
}

/**
 * Attaches the diagnostic hook to the OpenCode plugin tool domain.
 */
export async function registerDiagnosticHook(ctx: any, rootDir: string): Promise<void> {
  if (!ctx.tool?.hook) return

  await ctx.tool.hook("execute.after", async (event: any) => {
    if (event.status !== "completed") return
    if (event.tool !== "edit" && event.tool !== "write" && event.tool !== "patch") return

    const targetPaths = extractMutatedPaths(event)
    if (targetPaths.length === 0) return

    const results = await runParallelDiagnostics(rootDir, targetPaths, (r, p) => runQuickDiagnostics(r, p))
    const diag = results.join("")
    if (!diag) return

    if (Array.isArray(event.result?.content)) {
      event.result.content = [...event.result.content, { type: "text", text: diag }]
    } else if (typeof event.result?.content === "string") {
      event.result.content += diag
    } else if (event.result && typeof event.result === "object") {
      event.result.diagnostics = diag
    }
  })
}
