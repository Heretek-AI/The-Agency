import * as fs from "node:fs/promises"
import * as path from "node:path"
import { HOST_CONTRACT } from "./contract.js"

export interface EvidenceHit {
  evidence: string
  found: boolean
  locations: string[]
}

export interface CapabilityCheck {
  id: string
  required: boolean
  ok: boolean
  evidence: EvidenceHit[]
}

export interface ContractCheckReport {
  sourceDir: string
  filesScanned: number
  ok: boolean
  capabilities: CapabilityCheck[]
}

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".mjs"])
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".turbo"])

async function walk(dir: string, acc: string[], max: number): Promise<void> {
  if (acc.length >= max) return
  let entries: import("node:fs").Dirent[] = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (acc.length >= max) return
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(full, acc, max)
    } else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name))) {
      acc.push(full)
    }
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function evidencePattern(evidence: string): RegExp {
  if (evidence.startsWith('"') && evidence.endsWith('"')) {
    const literal = escapeRegExp(evidence.slice(1, -1))
    return new RegExp(`["'\`]${literal}["'\`]`)
  }
  return new RegExp(`\\b${escapeRegExp(evidence)}\\b`)
}

/**
 * Statically checks an OpenCode V2 source checkout for every hook name and API identifier
 * SwarmOS relies on. It cannot prove call signatures match; it catches renamed or removed hooks.
 */
export async function checkHostContract(sourceDir: string, maxFiles = 20000): Promise<ContractCheckReport> {
  const files: string[] = []
  await walk(path.resolve(sourceDir), files, maxFiles)

  const evidenceSet = new Set(HOST_CONTRACT.flatMap((c) => c.evidence))
  const hits = new Map<string, string[]>()
  const patterns = new Map<string, RegExp>()
  for (const ev of evidenceSet) {
    hits.set(ev, [])
    patterns.set(ev, evidencePattern(ev))
  }

  for (const file of files) {
    let text: string
    try {
      text = await fs.readFile(file, "utf8")
    } catch {
      continue
    }
    const lines = text.split("\n")
    for (const ev of evidenceSet) {
      const locs = hits.get(ev)!
      if (locs.length >= 3) continue
      const re = patterns.get(ev)!
      for (let i = 0; i < lines.length && locs.length < 3; i++) {
        if (re.test(lines[i])) locs.push(`${path.relative(sourceDir, file)}:${i + 1}`)
      }
    }
  }

  const capabilities: CapabilityCheck[] = HOST_CONTRACT.map((cap) => {
    const evidence = cap.evidence.map((ev) => {
      const locations = hits.get(ev) ?? []
      return { evidence: ev, found: locations.length > 0, locations }
    })
    return { id: cap.id, required: cap.required, ok: evidence.every((e) => e.found), evidence }
  })

  return {
    sourceDir: path.resolve(sourceDir),
    filesScanned: files.length,
    ok: files.length > 0 && capabilities.every((c) => c.ok || !c.required),
    capabilities,
  }
}

export function formatContractCheck(report: ContractCheckReport): string {
  const lines = [
    `SwarmOS host contract check against ${report.sourceDir} (${report.filesScanned} files)`,
    report.ok ? "RESULT: OK" : "RESULT: MISMATCH",
    "",
  ]
  for (const cap of report.capabilities) {
    lines.push(`${cap.ok ? "ok  " : cap.required ? "FAIL" : "warn"} ${cap.id}${cap.required ? "" : " (optional)"}`)
    for (const ev of cap.evidence) {
      lines.push(`       ${ev.found ? "found  " : "MISSING"} ${ev.evidence}${ev.locations.length ? `  ${ev.locations.join(", ")}` : ""}`)
    }
  }
  return lines.join("\n")
}
