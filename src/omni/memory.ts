import * as fs from "node:fs/promises"
import * as path from "node:path"
import { matchesPathPattern } from "../agents/guard.js"
import { getSessionState } from "../host/session-state.js"

export interface LessonStats {
  injected: number
  successes: number
  failures: number
  lastUsedAt?: string
}

export interface EpisodicLesson {
  id: string
  trigger: string
  lesson: string
  scopePaths?: string[]
  createdAt: string
  source?: "manual" | "proposal"
  stats?: LessonStats
  /** Set when sessions that followed this lesson kept failing; such lessons are no longer injected. */
  needsReview?: boolean
}

export interface LessonProposal {
  id: string
  trigger: string
  lesson: string
  scopePaths?: string[]
  evidence: { sessionID: string; tool: string; target: string; error: string; recoveredWith: string }
  createdAt: string
}

export function getMemoryFilePath(rootDir: string): string {
  return path.join(rootDir, ".opencode", "memory", "lessons.json")
}

export async function loadLessons(rootDir: string): Promise<EpisodicLesson[]> {
  try {
    const raw = await fs.readFile(getMemoryFilePath(rootDir), "utf8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function saveLessons(rootDir: string, lessons: EpisodicLesson[]): Promise<void> {
  const file = getMemoryFilePath(rootDir)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await fs.writeFile(tmp, JSON.stringify(lessons, null, 2), "utf8")
  await fs.rename(tmp, file)
}

const memoryLocks = new Map<string, Promise<unknown>>()

/** Serializes read-modify-write updates to the lessons file per workspace. */
export async function withLessons<T>(rootDir: string, mutate: (lessons: EpisodicLesson[]) => T | Promise<T>): Promise<T> {
  const key = path.resolve(rootDir)
  const previous = memoryLocks.get(key) ?? Promise.resolve()
  const run = previous.then(async () => {
    const lessons = await loadLessons(rootDir)
    const result = await mutate(lessons)
    await saveLessons(rootDir, lessons)
    return result
  })
  memoryLocks.set(
    key,
    run.catch(() => {}),
  )
  return run
}

export async function recordLesson(
  rootDir: string,
  input: Omit<EpisodicLesson, "createdAt" | "stats" | "needsReview">,
): Promise<EpisodicLesson> {
  return withLessons(rootDir, (lessons) => {
    const entry: EpisodicLesson = {
      ...input,
      source: input.source ?? "manual",
      createdAt: new Date().toISOString(),
      stats: { injected: 0, successes: 0, failures: 0 },
    }
    const idx = lessons.findIndex((l) => l.id === input.id)
    if (idx >= 0) lessons[idx] = entry
    else lessons.push(entry)
    return entry
  })
}

export async function forgetLesson(rootDir: string, id: string): Promise<boolean> {
  return withLessons(rootDir, (lessons) => {
    const idx = lessons.findIndex((l) => l.id === id)
    if (idx < 0) return false
    lessons.splice(idx, 1)
    return true
  })
}

/** Lessons whose followers fail at least twice and more often than they succeed get flagged. */
export function evaluateNeedsReview(stats: LessonStats): boolean {
  return stats.failures >= 2 && stats.failures > stats.successes
}

export async function recordLessonOutcome(
  rootDir: string,
  ids: string[],
  outcome: "success" | "failure" | "injected",
): Promise<EpisodicLesson[]> {
  if (ids.length === 0) return []
  return withLessons(rootDir, (lessons) => {
    const touched: EpisodicLesson[] = []
    for (const l of lessons) {
      if (!ids.includes(l.id)) continue
      l.stats ??= { injected: 0, successes: 0, failures: 0 }
      if (outcome === "injected") {
        l.stats.injected++
        l.stats.lastUsedAt = new Date().toISOString()
      } else if (outcome === "success") {
        l.stats.successes++
      } else {
        l.stats.failures++
      }
      l.needsReview = evaluateNeedsReview(l.stats)
      touched.push(l)
    }
    return touched
  })
}

export function getProposalsFilePath(rootDir: string): string {
  return path.join(rootDir, ".opencode", "memory", "proposals.json")
}

export async function loadProposals(rootDir: string): Promise<LessonProposal[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(getProposalsFilePath(rootDir), "utf8"))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function saveProposals(rootDir: string, proposals: LessonProposal[]): Promise<void> {
  const file = getProposalsFilePath(rootDir)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(proposals, null, 2), "utf8")
}

export async function proposeLesson(rootDir: string, proposal: Omit<LessonProposal, "id" | "createdAt">): Promise<LessonProposal> {
  const proposals = await loadProposals(rootDir)
  const existing = proposals.find((p) => p.evidence.target === proposal.evidence.target && p.evidence.tool === proposal.evidence.tool)
  if (existing) return existing
  const entry: LessonProposal = {
    ...proposal,
    id: `proposal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  }
  proposals.push(entry)
  await saveProposals(rootDir, proposals.slice(-50))
  return entry
}

export async function acceptProposal(
  rootDir: string,
  proposalId: string,
  edits: Partial<Pick<EpisodicLesson, "id" | "trigger" | "lesson" | "scopePaths">> = {},
): Promise<EpisodicLesson> {
  const proposals = await loadProposals(rootDir)
  const p = proposals.find((x) => x.id === proposalId)
  if (!p) throw new Error(`SwarmOS Memory: proposal [${proposalId}] not found`)
  const lesson = await recordLesson(rootDir, {
    id: edits.id ?? p.id.replace(/^proposal-/, "lesson-"),
    trigger: edits.trigger ?? p.trigger,
    lesson: edits.lesson ?? p.lesson,
    scopePaths: edits.scopePaths ?? p.scopePaths,
    source: "proposal",
  })
  await saveProposals(rootDir, proposals.filter((x) => x.id !== proposalId))
  return lesson
}

export async function rejectProposal(rootDir: string, proposalId: string): Promise<boolean> {
  const proposals = await loadProposals(rootDir)
  const next = proposals.filter((x) => x.id !== proposalId)
  await saveProposals(rootDir, next)
  return next.length !== proposals.length
}

export function registerMemoryTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "memory",
    description:
      "Cross-Session Episodic Memory for recording repository quirks, build/test gotchas, and architectural lessons that auto-inject into future sessions.",
  })

  editor.add({
    name: "record_lesson",
    description:
      "Record a permanent repository lesson or non-obvious gotcha in `.opencode/memory/lessons.json` so future sessions never repeat the same mistake.",
    options: { namespace: "memory", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Short lesson ID (e.g. 'sqlite-wal-test-env')" },
        trigger: { type: "string", description: "When this lesson applies (e.g. 'Running bun test on database modules')" },
        lesson: { type: "string", description: "The exact actionable rule or fix" },
        scopePaths: { type: "array", items: { type: "string" }, description: "Optional file globs this applies to" },
      },
      required: ["id", "trigger", "lesson"],
    },
    output: { type: "object" },
    execute: async (input: Omit<EpisodicLesson, "createdAt">) => {
      const entry = await recordLesson(rootDir, input)
      return { output: entry, content: `Recorded episodic lesson [${entry.id}]` }
    },
  })

  editor.add({
    name: "recall",
    description: "Retrieve all recorded episodic lessons for this repository, with outcome stats and review flags.",
    options: { namespace: "memory", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const lessons = await loadLessons(rootDir)
      return { output: { lessons }, content: JSON.stringify(lessons, null, 2) }
    },
  })

  editor.add({
    name: "proposals",
    description:
      "List lesson proposals SwarmOS drafted after recovering from a circuit-breaker loop. Proposals are not injected until accepted.",
    options: { namespace: "memory", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const proposals = await loadProposals(rootDir)
      return { output: { proposals }, content: JSON.stringify(proposals, null, 2) }
    },
  })

  editor.add({
    name: "accept_proposal",
    description: "Turn a lesson proposal into a permanent lesson, optionally rewriting its id, trigger, lesson text or scopePaths first.",
    options: { namespace: "memory", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        proposalId: { type: "string", description: "Proposal ID" },
        id: { type: "string", description: "Optional lesson ID" },
        trigger: { type: "string", description: "Optional rewritten trigger" },
        lesson: { type: "string", description: "Optional rewritten lesson text (recommended: state the actual fix)" },
        scopePaths: { type: "array", items: { type: "string" }, description: "Optional file globs" },
      },
      required: ["proposalId"],
    },
    output: { type: "object" },
    execute: async (input: { proposalId: string; id?: string; trigger?: string; lesson?: string; scopePaths?: string[] }) => {
      const { proposalId, ...edits } = input
      const lesson = await acceptProposal(rootDir, proposalId, edits)
      return { output: lesson, content: `Accepted proposal as lesson [${lesson.id}]` }
    },
  })

  editor.add({
    name: "reject_proposal",
    description: "Discard a lesson proposal.",
    options: { namespace: "memory", codemode: true, pinned: true },
    input: { type: "object", properties: { proposalId: { type: "string" } }, required: ["proposalId"] },
    output: { type: "object" },
    execute: async (input: { proposalId: string }) => {
      const removed = await rejectProposal(rootDir, input.proposalId)
      return { output: { removed }, content: removed ? `Rejected ${input.proposalId}` : `No proposal ${input.proposalId}` }
    },
  })

  editor.add({
    name: "forget",
    description: "Delete a lesson (for example one flagged needsReview that turned out to be wrong).",
    options: { namespace: "memory", codemode: true, pinned: true },
    input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    output: { type: "object" },
    execute: async (input: { id: string }) => {
      const removed = await forgetLesson(rootDir, input.id)
      return { output: { removed }, content: removed ? `Forgot lesson [${input.id}]` : `No lesson [${input.id}]` }
    },
  })
}

function resultText(event: any): string {
  const c = event?.result?.content
  if (typeof c === "string") return c
  if (Array.isArray(c)) return c.map((p: any) => p?.text ?? "").join("")
  return String(event?.error?.message ?? "")
}

function incidentTarget(event: any): string {
  if (typeof event?.input?.path === "string") return event.input.path
  if (typeof event?.input?.command === "string") return event.input.command.slice(0, 80)
  return "global"
}

export function lessonMatchesFile(lesson: EpisodicLesson, file: string): boolean {
  if (!lesson.scopePaths?.length) return false
  return lesson.scopePaths.some((p) => matchesPathPattern(file.replace(/^\.\//, ""), p))
}

/**
 * Self-maintaining memory:
 * - a circuit-breaker loop that later succeeds on the same target becomes a lesson proposal;
 * - injected lessons gain a success when verification passes and a failure when verification
 *   fails or the breaker fires on a file in their scope; repeat offenders get `needsReview`.
 */
export async function registerMemoryUpkeepHooks(ctx: any, rootDir: string): Promise<void> {
  if (!ctx.tool?.hook) return
  await ctx.tool.hook("execute.after", async (event: any) => {
    const state = getSessionState(event?.sessionID)
    const text = resultText(event)
    const target = incidentTarget(event)

    if (text.includes("DOOM-LOOP CIRCUIT BREAKER")) {
      if (!state.openIncidents.some((i) => i.target === target)) {
        state.openIncidents.push({
          tool: String(event?.tool ?? ""),
          target,
          error: String(event?.error?.message ?? text).split("\n")[0].slice(0, 200),
          at: new Date().toISOString(),
        })
      }
      const scoped = (await loadLessons(rootDir)).filter((l) => state.injectedLessons.has(l.id) && lessonMatchesFile(l, target))
      await recordLessonOutcome(rootDir, scoped.map((l) => l.id), "failure")
      return
    }

    if (event?.status !== "error" && !text.includes("<diagnostics")) {
      const idx = state.openIncidents.findIndex((i) => i.target === target)
      if (idx >= 0) {
        const incident = state.openIncidents.splice(idx, 1)[0]
        const isFile = incident.target !== "global" && !incident.target.includes(" ")
        await proposeLesson(rootDir, {
          trigger: isFile ? `Editing ${incident.target}` : `Running \`${incident.target}\``,
          lesson: `\`${incident.tool}\` failed repeatedly here ("${incident.error}") until \`${event.tool}\` succeeded. Record the actual root cause before accepting this lesson.`,
          ...(isFile ? { scopePaths: [incident.target] } : {}),
          evidence: { sessionID: state.sessionID, tool: incident.tool, target: incident.target, error: incident.error, recoveredWith: String(event.tool) },
        })
      }
    }

    const verdict = /Verify (PASSED|FAILED) \[/.exec(text)?.[1]
    if (verdict && state.injectedLessons.size > 0) {
      await recordLessonOutcome(rootDir, [...state.injectedLessons], verdict === "PASSED" ? "success" : "failure")
    }
  })
}

export async function registerMemoryContextHook(ctx: any, rootDir: string): Promise<void> {
  if (!ctx.session?.hook) return

  const injectMemory = async (event: any) => {
    if (event.agent === "compaction" || event.kind === "compaction") return
    if (!Array.isArray(event.system) || event.system.length === 0) return

    const lessons = await loadLessons(rootDir)
    if (lessons.length === 0) return

    const formatted = lessons
      .slice(-20)
      .map((l) => `- **[${l.id}]** (${l.trigger}): ${l.lesson}`)
      .join("\n")

    const block = `<episodic-repository-memory>\n## Learned Repository Rules & Gotchas\n${formatted}\n</episodic-repository-memory>`
    const lastIdx = event.system.length - 1
    const lastPart = event.system[lastIdx]
    if (lastPart && typeof lastPart.text === "string" && !lastPart.text.includes("<episodic-repository-memory>")) {
      event.system[lastIdx] = {
        ...lastPart,
        text: `${lastPart.text}\n\n${block}`,
      }
    }
  }

  await ctx.session.hook("context", injectMemory)
}
