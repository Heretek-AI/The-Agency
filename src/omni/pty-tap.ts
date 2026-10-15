import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface PtyLogReadInput {
  ptyID?: string
  logFile?: string
  lines?: number
  filterErrorsOnly?: boolean
}

const ERROR_LINE_RE = /\b(?:error|exception|fatal|panic|uncaught|failed|syntaxerror|typeerror|referenceerror|enoent|eaddrinuse)\b/i

export async function readDevServerLogs(
  ctx: any,
  rootDir: string,
  input: PtyLogReadInput = {},
): Promise<{ source: string; totalLines: number; lines: string[] }> {
  const maxLines = Math.min(Math.max(input.lines ?? 80, 10), 500)
  let rawText = ""
  let source = "none"

  if (input.ptyID && ctx.experimental?.terminal?.read) {
    try {
      const res = await ctx.experimental.terminal.read({ id: input.ptyID })
      rawText = typeof res?.data === "string" ? res.data : JSON.stringify(res?.data ?? res ?? "")
      source = `pty:${input.ptyID}`
    } catch {
      // fall through to log file
    }
  }

  if (!rawText) {
    const candidateFiles = [
      ...(input.logFile ? [path.resolve(rootDir, input.logFile)] : []),
      path.join(rootDir, ".opencode", "artifacts", "devserver.log"),
      path.join(rootDir, "dev.log"),
    ]
    for (const file of candidateFiles) {
      try {
        rawText = await fs.readFile(file, "utf8")
        source = path.relative(rootDir, file).split(path.sep).join("/")
        break
      } catch {
        // try next
      }
    }
  }

  if (!rawText) {
    return { source: "empty", totalLines: 0, lines: [] }
  }

  const allLines = rawText.replace(/\r\n/g, "\n").split("\n")
  const filtered = input.filterErrorsOnly ? allLines.filter((l) => ERROR_LINE_RE.test(l)) : allLines
  const tail = filtered.slice(-maxLines)

  return {
    source,
    totalLines: allLines.length,
    lines: tail,
  }
}

export function registerPtyTapTools(editor: any, ctx: any, rootDir: string): void {
  editor.namespace({
    name: "pty",
    description:
      "Live Persistent Terminal & Dev-Server Log Tap (`ctx.experimental.terminal.read` + `.opencode/artifacts/devserver.log`) for catching runtime and HMR crashes.",
  })

  editor.add({
    name: "read_logs",
    description:
      "Read recent stdout/stderr lines from an active OpenCode persistent PTY session (`ptyID`) or `.opencode/artifacts/devserver.log`, optionally filtering for errors/stack traces.",
    options: { namespace: "pty", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        ptyID: { type: "string", description: "Optional OpenCode PersistentPty ID" },
        logFile: { type: "string", description: "Optional log file path (defaults to .opencode/artifacts/devserver.log)" },
        lines: { type: "number", description: "Number of tail lines to return (default 80)" },
        filterErrorsOnly: { type: "boolean", description: "If true, only return lines matching error/exception/stack-trace keywords" },
      },
    },
    output: { type: "object" },
    execute: async (input: PtyLogReadInput) => {
      const res = await readDevServerLogs(ctx, rootDir, input ?? {})
      return { output: res, content: res.lines.join("\n") || `No log lines found (${res.source}).` }
    },
  })
}
