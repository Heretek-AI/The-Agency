import * as fs from "node:fs/promises"
import * as path from "node:path"
import { runQuickDiagnostics } from "../diagnostics/runner.js"

export interface HashLineHunk {
  startLine: number
  startHash: string
  endLine: number
  endHash: string
  replacement: string
}

export interface HashReadResult {
  path: string
  totalLines: number
  startLine: number
  endLine: number
  content: string
}

export interface HashEditResult {
  path: string
  appliedHunks: number
  totalLines: number
  diagnostics?: string
}

/**
 * Computes a deterministic 2-character hex hash (00..ff) for a line's trimmed content (FNV-1a).
 * Empty/whitespace-only lines always hash to "00".
 */
export function computeLineHash(line: string): string {
  const trimmed = line.trim()
  if (trimmed.length === 0) return "00"
  let hash = 2166136261
  for (let i = 0; i < trimmed.length; i++) {
    hash ^= trimmed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) & 0xff).toString(16).padStart(2, "0")
}

/**
 * Reads a file and tags every line with `<lineNo>#<2-hex-hash>: <content>` (Oh-My-Pi hashline format).
 */
export async function hashReadFile(
  rootDir: string,
  targetPath: string,
  offset: number = 1,
  limit: number = 400,
): Promise<HashReadResult> {
  const abs = path.resolve(rootDir, targetPath)
  const raw = await fs.readFile(abs, "utf8")
  const lines = raw.replace(/\r\n/g, "\n").split("\n")
  const startIdx = Math.max(0, offset - 1)
  const endIdx = Math.min(lines.length, startIdx + limit)

  const formatted = lines
    .slice(startIdx, endIdx)
    .map((line, idx) => {
      const lineNo = startIdx + idx + 1
      const hash = computeLineHash(line)
      return `${lineNo}#${hash}: ${line}`
    })
    .join("\n")

  return {
    path: targetPath,
    totalLines: lines.length,
    startLine: startIdx + 1,
    endLine: endIdx,
    content: formatted,
  }
}

/**
 * Applies hash-anchored line edits (`hashline`) with automatic +-3 line drift recovery
 * and immediate post-mutation syntax/linter diagnostics.
 */
export async function hashEditFile(
  rootDir: string,
  targetPath: string,
  hunks: HashLineHunk[],
): Promise<HashEditResult> {
  const abs = path.resolve(rootDir, targetPath)
  const raw = await fs.readFile(abs, "utf8")
  const hasCrlf = raw.includes("\r\n")
  const lines = raw.replace(/\r\n/g, "\n").split("\n")

  const resolved = hunks.map((hunk, idx) => {
    const expStartHash = hunk.startHash.toLowerCase().trim()
    const expEndHash = hunk.endHash.toLowerCase().trim()
    const span = hunk.endLine - hunk.startLine
    if (span < 0) {
      throw new Error(`Hunk #${idx + 1}: endLine (${hunk.endLine}) must be >= startLine (${hunk.startLine}).`)
    }

    let candidateStart = hunk.startLine - 1
    const matchesAt = (sIdx: number) => {
      const eIdx = sIdx + span
      if (sIdx < 0 || eIdx >= lines.length) return false
      return (
        computeLineHash(lines[sIdx]) === expStartHash &&
        computeLineHash(lines[eIdx]) === expEndHash
      )
    }

    if (!matchesAt(candidateStart)) {
      const nearby: number[] = []
      for (let delta = -3; delta <= 3; delta++) {
        if (delta !== 0 && matchesAt(candidateStart + delta)) {
          nearby.push(candidateStart + delta)
        }
      }
      if (nearby.length === 1) {
        candidateStart = nearby[0]
      } else {
        const actualStart =
          lines[candidateStart] !== undefined
            ? `${hunk.startLine}#${computeLineHash(lines[candidateStart])}`
            : "EOF"
        const actualEnd =
          lines[candidateStart + span] !== undefined
            ? `${hunk.endLine}#${computeLineHash(lines[candidateStart + span])}`
            : "EOF"
        throw new Error(
          `Hashline mismatch on Hunk #${idx + 1} in ${targetPath}: expected (${hunk.startLine}#${expStartHash}..${hunk.endLine}#${expEndHash}), found (${actualStart}..${actualEnd}). Re-run hash_read to refresh line hashes.`,
        )
      }
    }

    return {
      startIdx: candidateStart,
      endIdx: candidateStart + span,
      replacementLines:
        hunk.replacement === "" ? [] : hunk.replacement.replace(/\r\n/g, "\n").split("\n"),
    }
  })

  resolved.sort((a, b) => b.startIdx - a.startIdx)
  for (let i = 0; i < resolved.length - 1; i++) {
    if (resolved[i + 1].endIdx >= resolved[i].startIdx) {
      throw new Error(`Overlapping hashline hunks detected in ${targetPath}.`)
    }
  }

  for (const r of resolved) {
    lines.splice(r.startIdx, r.endIdx - r.startIdx + 1, ...r.replacementLines)
  }

  const outputText = lines.join(hasCrlf ? "\r\n" : "\n")
  await fs.writeFile(abs, outputText, "utf8")
  const diagnostics = await runQuickDiagnostics(rootDir, targetPath)

  return {
    path: targetPath,
    appliedHunks: resolved.length,
    totalLines: lines.length,
    ...(diagnostics ? { diagnostics } : {}),
  }
}

export function registerHashlineTools(editor: any, rootDir: string): void {
  editor.add({
    name: "hash_read",
    description:
      "Oh-My-Pi style hash-anchored file reader. Returns lines prefixed with `<line>#<2-hex-hash>: <content>` so `hash_edit` can mutate line ranges without brittle exact-string matching.",
    options: { namespace: "fs", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read" },
        offset: { type: "number", description: "1-indexed start line (default 1)" },
        limit: { type: "number", description: "Maximum lines to read (default 400)" },
      },
      required: ["path"],
    },
    output: { type: "object" },
    execute: async (input: { path: string; offset?: number; limit?: number }) => {
      const res = await hashReadFile(rootDir, input.path, input.offset ?? 1, input.limit ?? 400)
      return { output: res, content: res.content }
    },
  })

  editor.add({
    name: "hash_edit",
    description:
      "Oh-My-Pi style hash-anchored line editor. Replaces one or more line ranges verified by their 2-hex start/end hashes (`startLine`, `startHash`, `endLine`, `endHash`, `replacement`), with +-3 line drift recovery and instant compiler diagnostics.",
    options: { namespace: "fs", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Target file path" },
        hunks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              startLine: { type: "number" },
              startHash: { type: "string" },
              endLine: { type: "number" },
              endHash: { type: "string" },
              replacement: { type: "string" },
            },
            required: ["startLine", "startHash", "endLine", "endHash", "replacement"],
          },
        },
      },
      required: ["path", "hunks"],
    },
    output: { type: "object" },
    execute: async (input: { path: string; hunks: HashLineHunk[] }) => {
      const res = await hashEditFile(rootDir, input.path, input.hunks)
      const msg = `Applied ${res.appliedHunks} hashline hunk(s) to ${res.path} (${res.totalLines} lines).${res.diagnostics ?? ""}`
      return { output: res, content: msg }
    },
  })
}
