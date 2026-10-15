import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"

/**
 * Pillar 1: IUMBTEMS Epistemic Sovereignty & Dialectic Engine (`src/epistemic/dialectic.ts`)
 *
 * Absorbs `@heretek-ai/epistemic-swarm` (IUMBTEMS) directly into SwarmOS:
 * 1. Content-addressed SHA-256 raw source cache (`.opencode/epistemic/sources/<shortHash>.md`).
 * 2. Epistemic Tagging Taxonomy (`[VERIFIED: <hash>]`, `[INFERRED: <reasoning>]`,
 *    `[HYPOTHESIS: <test>]`, `[NEGATIVE_KNOWLEDGE: <query>]`) with verbatim quote verification.
 * 3. Socratic Assumption-Inversion Grill (`/grill` & `tools.epistemic.grill`).
 * 4. Competitor Teardown & SPDX License Contamination Scout (`/darkharvest` & `tools.epistemic.audit_licenses`).
 */

export interface CachedEpistemicSource {
  hash: string
  shortHash: string
  title: string
  url?: string
  spdxLicense?: string
  licenseCategory: string
  cachedAt: string
  byteLength: number
  filePath: string
  /** Absolute path (backwards compat with pre-v1.0 callers). */
  path: string
}

export interface EpistemicVerificationReport {
  totalClaimsChecked: number
  verifiedCount: number
  failedClaims: Array<{ tag: string; reason: string }>
  passed: boolean
}

export interface LicenseAuditItem {
  name: string
  license: string
  classification: "permissive" | "weak-copyleft" | "strong-copyleft" | "unknown"
  verdict: "depend-or-vendor" | "dynamic-link-only" | "clean-room-rebuild-only" | "manual-review"
}

const PERMISSIVE_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
])
const WEAK_COPYLEFT_LICENSES = new Set(["MPL-2.0", "LGPL-2.1", "LGPL-2.1-only", "LGPL-3.0", "LGPL-3.0-only", "EPL-2.0"])
const STRONG_COPYLEFT_LICENSES = new Set([
  "GPL-2.0",
  "GPL-2.0-only",
  "GPL-3.0",
  "GPL-3.0-only",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "SSPL-1.0",
])

export function classifySpdxLicense(spdx?: string): string
export function classifySpdxLicense(pkgName: string, spdx: string): LicenseAuditItem
export function classifySpdxLicense(a?: string, b?: string): string | LicenseAuditItem {
  // New single-arg form: classifySpdxLicense("MIT") -> "permissive"
  // Legacy two-arg form: classifySpdxLicense("pkg", "MIT") -> LicenseAuditItem
  if (b !== undefined) {
    const pkgName = a ?? ""
    const spdx = b
    const cat = classifySingle(spdx)
    const classification = cat === "copyleft-contaminating" ? "strong-copyleft" : (cat as LicenseAuditItem["classification"])
    const verdict =
      classification === "permissive"
        ? "depend-or-vendor"
        : classification === "weak-copyleft"
          ? "dynamic-link-only"
          : classification === "strong-copyleft"
            ? "clean-room-rebuild-only"
            : "manual-review"
    return { name: pkgName, license: spdx, classification, verdict } as LicenseAuditItem
  }
  return classifySingle(a)
}

function classifySingle(spdx?: string): string {
  if (!spdx || !spdx.trim()) return "unknown"
  const norm = spdx.trim()
  if (PERMISSIVE_LICENSES.has(norm)) return "permissive"
  if (WEAK_COPYLEFT_LICENSES.has(norm)) return "weak-copyleft"
  if (STRONG_COPYLEFT_LICENSES.has(norm) || /\b(?:AGPL|GPL|SSPL)/i.test(norm)) return "copyleft-contaminating"
  return "unknown"
}

export function getEpistemicDir(rootDir: string): string {
  return path.join(rootDir, ".opencode", "epistemic")
}

export function getEpistemicSourcesDir(rootDir: string): string {
  return path.join(getEpistemicDir(rootDir), "sources")
}

async function loadEpistemicIndex(rootDir: string): Promise<CachedEpistemicSource[]> {
  try {
    const raw = await fs.readFile(path.join(getEpistemicDir(rootDir), "index.json"), "utf8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CachedEpistemicSource[]) : []
  } catch {
    return []
  }
}

async function saveEpistemicIndex(rootDir: string, entries: CachedEpistemicSource[]): Promise<void> {
  const dir = getEpistemicDir(rootDir)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, "index.json"), JSON.stringify(entries, null, 2), "utf8")
}

export async function cacheEpistemicSource(
  rootDir: string,
  input: { title: string; content: string; url?: string; spdxLicense?: string },
): Promise<CachedEpistemicSource> {
  const normalizedContent = input.content.replace(/\r\n/g, "\n")
  const sha256 = createHash("sha256").update(normalizedContent, "utf8").digest("hex")
  const shortHash = sha256.slice(0, 12)
  const sourcesDir = path.join(getEpistemicDir(rootDir), "sources")
  await fs.mkdir(sourcesDir, { recursive: true })
  const filePathAbs = path.join(sourcesDir, `${shortHash}.md`)
  await fs.writeFile(filePathAbs, normalizedContent, "utf8")
  const entry: CachedEpistemicSource = {
    hash: sha256,
    shortHash,
    title: input.title,
    ...(input.url ? { url: input.url } : {}),
    ...(input.spdxLicense ? { spdxLicense: input.spdxLicense } : {}),
    licenseCategory: classifySingle(input.spdxLicense),
    cachedAt: new Date().toISOString(),
    byteLength: Buffer.byteLength(normalizedContent, "utf8"),
    filePath: path.relative(rootDir, filePathAbs).split(path.sep).join("/"),
    path: filePathAbs,
  }
  const index = await loadEpistemicIndex(rootDir)
  const existingIdx = index.findIndex((e) => e.shortHash === shortHash)
  if (existingIdx >= 0) index[existingIdx] = entry
  else index.push(entry)
  await saveEpistemicIndex(rootDir, index)
  return entry
}

export async function verifyEpistemicClaims(rootDir: string, markdownText: string): Promise<EpistemicVerificationReport> {
  const index = await loadEpistemicIndex(rootDir)
  const byHash = new Map<string, CachedEpistemicSource>()
  for (const e of index) {
    byHash.set(e.shortHash.toLowerCase(), e)
    byHash.set(e.hash.toLowerCase(), e)
  }
  const tagRe = /\[VERIFIED:\s*([a-fA-F0-9]{6,64})(?:\s*\|\s*"([^"]+)")?\]/g
  const failedClaims: Array<{ tag: string; reason: string }> = []
  let totalClaimsChecked = 0
  let verifiedCount = 0
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(markdownText)) !== null) {
    totalClaimsChecked++
    const rawTag = match[0]
    const hashKey = match[1].toLowerCase()
    const quote = match[2]
    const entry = byHash.get(hashKey)
    if (!entry) {
      failedClaims.push({ tag: rawTag, reason: `Unknown source hash "${hashKey}" not found in .opencode/epistemic/index.json` })
      continue
    }
    const absFile = path.resolve(rootDir, entry.filePath)
    let sourceText = ""
    try {
      sourceText = await fs.readFile(absFile, "utf8")
    } catch {
      failedClaims.push({ tag: rawTag, reason: `Cached source file missing on disk: ${entry.filePath}` })
      continue
    }
    if (quote) {
      const normSource = sourceText.replace(/\s+/g, " ").trim()
      const normQuote = quote.replace(/\s+/g, " ").trim()
      if (!normSource.includes(normQuote)) {
        failedClaims.push({
          tag: rawTag,
          reason: `Verbatim quote "${quote.slice(0, 60)}" not found inside cached source [${entry.shortHash}] (${entry.title})`,
        })
        continue
      }
    }
    verifiedCount++
  }
  return {
    totalClaimsChecked,
    verifiedCount,
    failedClaims,
    passed: failedClaims.length === 0,
  }
}

export function generateGrillQuestions(specText: string, focusAreas: string[] = []): { topic: string; questions: string[] } {
  const lines = specText.split("\n").map((l) => l.trim()).filter(Boolean)
  const topic = lines[0]?.replace(/^#+\s*/, "") || "System Architecture & Specification"
  const questions = [
    `[State & Concurrency] What happens in "${topic}" if two subagents or requests mutate the same state concurrently or a process crashes mid-write?`,
    `[Failure Modes & Recovery] Which external dependencies or I/O boundaries in "${topic}" can fail or time out, and what is the deterministic fallback or rollback path?`,
    `[Boundary Invariants] What untrusted inputs enter "${topic}", and where is the schema validation boundary enforced before business logic executes?`,
    `[Verification & Observability] What single automated command or invariant assertion proves "${topic}" works without human guesswork?`,
    `[Scope & Blast Radius] Which existing modules or contracts could break if "${topic}" changes, and what is the minimal viable slice we should lock first?`,
  ]
  for (const area of focusAreas) {
    questions.push(`[Focused Stress-Test: ${area}] What implicit assumption in "${area}" has not yet been verified against actual code or primary sources?`)
  }
  return { topic, questions }
}

export function generateSocraticGrillPrompt(objective: string): string {
  return [
    "# IUMBTEMS Socratic Grill & Assumption Inversion Protocol",
    "",
    `Target Objective: **${objective}**`,
    "",
    "Before writing any code or locking any contract, execute these 4 dialectic steps:",
    "1. **Premise Inversion**: List the top 3 unstated assumptions in the objective and invert each one (what if the opposite is true?).",
    "2. **Decision Tree Frontier**: Identify the 2–3 load-bearing architectural forks where choosing wrong forces a rewrite. Use `question` to ask the user with concrete tradeoffs.",
    "3. **Thesis vs. Antithesis (Red-Team)**: State the strongest argument FOR the proposed design (Agent Alpha) and the sharpest failure mode that will break it in production (Agent Beta).",
    "4. **Falsifiable Spike**: Define the smallest 1-command verification test that proves the core assumption works.",
  ].join("\n")
}

export async function listEpistemicSources(rootDir: string): Promise<CachedEpistemicSource[]> {
  return loadEpistemicIndex(rootDir)
}

export function registerEpistemicTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "epistemic",
    description:
      "IUMBTEMS Epistemic & Dialectic Engine: SHA-256 content-addressed source cache, verbatim `[VERIFIED: <hash> | 'quote']` verifier, SPDX license contamination guard, and Socratic `/grill` stress-tester.",
  })
  editor.add({
    name: "cache_source",
    description:
      "Cache raw source text or documentation in `.opencode/epistemic/sources/<shortHash>.md`, compute its SHA-256 hash, and classify its SPDX license.",
    options: { namespace: "epistemic", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        url: { type: "string" },
        spdxLicense: { type: "string" },
      },
      required: ["title", "content"],
    },
    output: { type: "object" },
    execute: async (input: { title: string; content: string; url?: string; spdxLicense?: string }) => {
      const entry = await cacheEpistemicSource(rootDir, input)
      return {
        output: entry,
        content: `Cached epistemic source [${entry.shortHash}] (${entry.licenseCategory}): ${entry.title}`,
      }
    },
  })
  editor.add({
    name: "verify_claims",
    description: "Verify all `[VERIFIED: <shortHash> | 'exact quote']` tags in a Markdown text against `.opencode/epistemic/sources/`.",
    options: { namespace: "epistemic", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        markdown: { type: "string" },
      },
      required: ["markdown"],
    },
    output: { type: "object" },
    execute: async (input: { markdown: string }) => {
      const report = await verifyEpistemicClaims(rootDir, input.markdown)
      return { output: report, content: JSON.stringify(report, null, 2) }
    },
  })
  editor.add({
    name: "grill_spec",
    description:
      "Generate Socratic stress-test questions to expose hidden assumptions, race conditions, and unverified boundaries in a specification.",
    options: { namespace: "epistemic", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        specText: { type: "string" },
        focusAreas: { type: "array", items: { type: "string" } },
      },
      required: ["specText"],
    },
    output: { type: "object" },
    execute: async (input: { specText: string; focusAreas?: string[] }) => {
      const res = generateGrillQuestions(input.specText, input.focusAreas ?? [])
      return { output: res, content: JSON.stringify(res, null, 2) }
    },
  })
  editor.add({
    name: "audit_licenses",
    description:
      "Classify candidate open-source packages by SPDX license (`permissive` -> vendor/depend vs. `strong-copyleft` GPL/AGPL -> clean-room spec rebuild only).",
    options: { namespace: "epistemic", codemode: true, pinned: false },
    input: {
      type: "object",
      properties: {
        packages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              license: { type: "string" },
            },
            required: ["name", "license"],
          },
        },
      },
      required: ["packages"],
    },
    output: { type: "object" },
    execute: async (input: { packages: Array<{ name: string; license: string }> }) => {
      const items = (input.packages ?? []).map((p) => classifySpdxLicense(p.name, p.license))
      return { output: { items }, content: JSON.stringify(items, null, 2) }
    },
  })
}
