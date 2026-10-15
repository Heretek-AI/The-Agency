import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface ResearchSource {
  id: string
  url: string
  title: string
  keyFindings: string[]
  verbatimQuotes?: string[]
  fetchedAt: string
}

export interface CitationAuditReport {
  totalLinksFound: number
  verifiedLinks: string[]
  unverifiedLinks: string[]
  bareRootLinks: string[]
  passed: boolean
}

export function getResearchLedgerPath(rootDir: string): string {
  return path.join(rootDir, ".opencode", "artifacts", "research_sources.json")
}

export async function loadResearchSources(rootDir: string): Promise<ResearchSource[]> {
  try {
    const raw = await fs.readFile(getResearchLedgerPath(rootDir), "utf8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function recordResearchSource(
  rootDir: string,
  input: Omit<ResearchSource, "fetchedAt">,
): Promise<ResearchSource> {
  const sources = await loadResearchSources(rootDir)
  const entry: ResearchSource = {
    ...input,
    fetchedAt: new Date().toISOString(),
  }
  const idx = sources.findIndex((s) => s.url === input.url || s.id === input.id)
  if (idx >= 0) {
    sources[idx] = entry
  } else {
    sources.push(entry)
  }
  const file = getResearchLedgerPath(rootDir)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(sources, null, 2), "utf8")
  return entry
}

/**
 * Audits a Markdown text or report file to verify that every `[Label](https://...)` link
 * is grounded in the recorded research ledger and is not a bare domain homepage.
 */
export async function auditMarkdownCitations(
  rootDir: string,
  markdownText: string,
): Promise<CitationAuditReport> {
  const sources = await loadResearchSources(rootDir)
  const knownUrls = new Set(sources.map((s) => s.url.trim().replace(/\/+$/, "")))

  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
  const verifiedLinks: string[] = []
  const unverifiedLinks: string[] = []
  const bareRootLinks: string[] = []
  let match: RegExpExecArray | null

  while ((match = linkRe.exec(markdownText)) !== null) {
    const rawUrl = match[2].trim()
    const normalized = rawUrl.replace(/\/+$/, "")
    try {
      const parsed = new URL(rawUrl)
      if ((parsed.pathname === "/" || parsed.pathname === "") && !parsed.search && !parsed.hash) {
        bareRootLinks.push(rawUrl)
      }
    } catch {
      // ignore invalid URL parse
    }

    if (knownUrls.has(normalized)) {
      if (!verifiedLinks.includes(rawUrl)) verifiedLinks.push(rawUrl)
    } else {
      if (!unverifiedLinks.includes(rawUrl)) unverifiedLinks.push(rawUrl)
    }
  }

  return {
    totalLinksFound: verifiedLinks.length + unverifiedLinks.length,
    verifiedLinks,
    unverifiedLinks,
    bareRootLinks,
    passed: unverifiedLinks.length === 0 && bareRootLinks.length === 0,
  }
}

export function registerResearchTools(editor: any, rootDir: string): void {
  // Unlock OpenCode V2's native `websearch` and `webfetch` tools inside Code Mode (`execute`)
  if (typeof editor.update === "function") {
    for (const toolName of ["websearch", "webfetch"]) {
      try {
        editor.update(toolName, (tool: any) => {
          tool.options = { ...tool.options, codemode: true }
        })
      } catch {
        // ignore if not registered
      }
    }
  }

  editor.namespace({
    name: "research",
    description:
      "Deep Research & Citation Verification Engine for recording verified web/literature sources and auditing reports against hallucinated or bare-domain links.",
  })

  editor.add({
    name: "record_source",
    description: "Record a verified web page, paper, or primary document in `.opencode/artifacts/research_sources.json`.",
    options: { namespace: "research", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Short source identifier (e.g. 'src-rfc9110')" },
        url: { type: "string", description: "Exact specific URL fetched" },
        title: { type: "string", description: "Document or article title" },
        keyFindings: { type: "array", items: { type: "string" }, description: "Verified facts/figures from this source" },
        verbatimQuotes: { type: "array", items: { type: "string" }, description: "Optional verbatim quotes" },
      },
      required: ["id", "url", "title", "keyFindings"],
    },
    output: { type: "object" },
    execute: async (input: Omit<ResearchSource, "fetchedAt">) => {
      const entry = await recordResearchSource(rootDir, input)
      return { output: entry, content: `Recorded research source [${entry.id}]: ${entry.url}` }
    },
  })

  editor.add({
    name: "list_sources",
    description: "List all verified sources recorded in the session's research ledger.",
    options: { namespace: "research", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const sources = await loadResearchSources(rootDir)
      return { output: { sources }, content: JSON.stringify(sources, null, 2) }
    },
  })

  editor.add({
    name: "audit_citations",
    description:
      "Audit a Markdown text string or file against the recorded research ledger to detect unverified URLs or bare root domain links.",
    options: { namespace: "research", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        markdown: { type: "string", description: "Markdown text to audit" },
      },
      required: ["markdown"],
    },
    output: { type: "object" },
    execute: async (input: { markdown: string }) => {
      const report = await auditMarkdownCitations(rootDir, input.markdown)
      return { output: report, content: JSON.stringify(report, null, 2) }
    },
  })
}
