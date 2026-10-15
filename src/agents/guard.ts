import * as path from "node:path"
import { loadBoard } from "../board/board.js"
import type { OrgBoard } from "../board/types.js"
import { analyzeShell, isReadOnly } from "./shell-parse.js"

export interface PermissionEvaluationEvent {
  sessionID?: string
  agent?: string
  action: string
  resources: string[]
  metadata?: unknown
  source?: string
  effect: "allow" | "ask" | "deny"
  message?: string
}

export interface GuardDecision {
  allowed: boolean
  reason?: string
  /** Require explicit approval even when a saved rule would allow the action. */
  ask?: boolean
  /** Safe to run without prompting (read-only command for a role that only reads). */
  autoAllow?: boolean
}

/** Extra policy evaluated after the board guard (taint tracking, task budgets). */
export type GuardEvaluator = (event: PermissionEvaluationEvent, board: OrgBoard) => GuardDecision | undefined | Promise<GuardDecision | undefined>

/**
 * Normalizes a resource path to a forward-slash path relative to rootDir.
 */
export function normalizeResourcePath(rootDir: string, resource: string): string {
  const trimmed = resource.trim()
  const absRoot = path.resolve(rootDir)
  const resolved = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(absRoot, trimmed)
  const rel = path.relative(absRoot, resolved).split(path.sep).join("/")
  return rel.startsWith("./") ? rel.slice(2) : rel
}

/**
 * Matches a normalized relative file path against an ownership pattern:
 * - Exact file path ("src/server/auth.ts")
 * - Directory prefix ("src/server" or "src/server/")
 * - Glob wildcard ("src/ui/**", "*.test.*", "test/**")
 */
export function matchesPathPattern(relPath: string, pattern: string): boolean {
  const normPath = relPath.replace(/^\/+/, "")
  const normPattern = pattern.trim().replace(/^\.\//, "").replace(/^\/+/, "")
  if (!normPattern) return false

  if (normPath === normPattern) return true

  // Directory prefix match when pattern has no wildcard characters
  if (!normPattern.includes("*") && !normPattern.includes("?")) {
    const dirPrefix = normPattern.endsWith("/") ? normPattern : `${normPattern}/`
    if (normPath.startsWith(dirPrefix)) return true
    return false
  }

  // Convert glob pattern to RegExp without token collision
  let res = ""
  for (let i = 0; i < normPattern.length; i++) {
    const ch = normPattern[i]
    if (ch === "*") {
      if (normPattern[i + 1] === "*") {
        if (normPattern[i + 2] === "/") {
          res += "(?:.+/)?"
          i += 2
        } else {
          res += ".*"
          i++
        }
      } else {
        res += "[^/]*"
      }
    } else if (ch === "?") {
      res += "[^/]"
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      res += "\\" + ch
    } else {
      res += ch
    }
  }

  const regex = new RegExp(`^${res}$`)
  return regex.test(normPath)
}

const LEADERSHIP_AGENTS = new Set(["director", "manager"])
/** Agents whose read-only shell commands are approved without prompting. */
const AUTO_APPROVE_READ_AGENTS = new Set(["director", "manager", "explore", "plan", "qa-adversary"])
const TEST_PATH_PATTERNS = ["**/*.test.*", "**/*.spec.*", "test/**", "tests/**", "e2e/**", "**/__tests__/**", "**/test/**", "**/tests/**"]
const IMPLEMENTATION_AGENTS = new Set(["staff-backend", "staff-ui"])
const TOURNAMENT_EXEMPT_AGENTS = new Set(["architect", "release-ops"])

function isScratchPath(raw: string): boolean {
  return /^\/(?:tmp|var\/tmp|dev)\//.test(raw) || raw === "/dev/null"
}

function isPlaceholder(target: string): boolean {
  return target.startsWith("<") && target.endsWith(">")
}

export function isTestPath(relPath: string): boolean {
  return TEST_PATH_PATTERNS.some((p) => matchesPathPattern(relPath, p))
}

const ACTIVE_TASK_STATUSES = new Set(["pending", "in_progress", "ready_for_qa", "qa_rejected"])

/**
 * Decides whether `agent` may create, modify or delete `rawPath` given locked contracts,
 * disjoint task ownership and active worktree tournaments. Used for edit/write/patch
 * resources and for file targets of shell commands.
 */
export function evaluateFileMutation(rootDir: string, board: OrgBoard, agent: string, rawPath: string): GuardDecision {
  let relPath = normalizeResourcePath(rootDir, rawPath)
  if (relPath.startsWith("..") || path.isAbsolute(relPath)) return { allowed: true }

  // Paths inside a tournament candidate worktree are judged relative to that worktree.
  const wt = /^(\.worktrees\/[^/]+)\/(.+)$/.exec(relPath)
  let worktreeTask: OrgBoard["tasks"][number] | undefined
  if (wt) {
    worktreeTask = board.tasks.find((t) => t.worktree === wt[1])
    relPath = wt[2]
  }

  if (agent && agent !== "architect") {
    for (const contract of board.contracts) {
      if (contract.files.some((cf) => matchesPathPattern(relPath, cf))) {
        return {
          allowed: false,
          reason: `SwarmOS Contract Guard: File "${relPath}" is locked under architectural contract [${contract.id}] ("${contract.title}"). Only the "architect" role may modify locked contract files.`,
        }
      }
    }
  }

  if (worktreeTask) {
    if (IMPLEMENTATION_AGENTS.has(agent) && worktreeTask.owner !== agent) {
      return {
        allowed: false,
        reason: `SwarmOS Worktree Guard: "${wt![1]}" belongs to task [${worktreeTask.id}] owned by "${worktreeTask.owner}", not "${agent}".`,
      }
    }
    return { allowed: true }
  }

  if (IMPLEMENTATION_AGENTS.has(agent)) {
    const activeTasks = board.tasks.filter((t) => ACTIVE_TASK_STATUSES.has(t.status) && !t.worktree)
    const ownedBySelf = activeTasks.some(
      (t) => t.owner === agent && t.ownedPaths.some((pattern) => matchesPathPattern(relPath, pattern)),
    )
    if (!ownedBySelf) {
      const conflictingTask = activeTasks.find(
        (t) => t.owner !== agent && t.ownedPaths.some((pattern) => matchesPathPattern(relPath, pattern)),
      )
      if (conflictingTask) {
        return {
          allowed: false,
          reason: `SwarmOS Ownership Guard: File "${relPath}" is claimed by active task [${conflictingTask.id}] assigned to "${conflictingTask.owner}". Role "${agent}" cannot modify files outside its disjoint ownedPaths boundary.`,
        }
      }
    }
  }

  if (agent && !TOURNAMENT_EXEMPT_AGENTS.has(agent)) {
    for (const tour of board.tournaments ?? []) {
      if (tour.status !== "active") continue
      if (tour.ownedPaths.some((pattern) => matchesPathPattern(relPath, pattern))) {
        const where = tour.candidates.map((c) => c.worktree).join(" or ")
        return {
          allowed: false,
          reason: `SwarmOS Tournament Guard: "${relPath}" is contested by active tournament [${tour.id}]. Edit it inside your candidate worktree (${where}), not in the main tree.`,
        }
      }
    }
  }

  return { allowed: true }
}

function evaluateShellCommand(rootDir: string, board: OrgBoard, agent: string, cmd: string): GuardDecision {
  const analysis = analyzeShell(cmd)
  const short = cmd.slice(0, 80)

  const destructive = analysis.commands.find((c) => c.effects.includes("destructive"))
  if (destructive) {
    const label = destructive.program === "git" ? "SwarmOS Git Safety Guard" : "SwarmOS Destructive Command Guard"
    return {
      allowed: false,
      reason: `${label}: Destructive command "${short}" (${destructive.note ?? destructive.program}) is blocked across all SwarmOS roles.`,
    }
  }

  if (analysis.unparseable) {
    return { allowed: true, ask: true, reason: `SwarmOS Shell Guard: could not parse "${short}"; approve it manually.` }
  }

  const writeCommands = analysis.commands.filter((c) => c.effects.includes("write"))
  const projectWrites = analysis.writes.filter((w) => !isScratchPath(w))
  const unknownTargets = writeCommands.some((c) => c.writes.length === 0) || projectWrites.some(isPlaceholder)

  if (LEADERSHIP_AGENTS.has(agent) && writeCommands.length > 0 && (projectWrites.length > 0 || unknownTargets)) {
    return {
      allowed: false,
      reason: `SwarmOS Separation-of-Powers Guard: Leadership role "${agent}" is read-only and cannot execute file-mutating or git-committing shell commands ("${short}"). Delegate implementation to subagents.`,
    }
  }

  if (agent === "qa-adversary" && writeCommands.length > 0) {
    const nonTest = projectWrites.filter((w) => isPlaceholder(w) || !isTestPath(normalizeResourcePath(rootDir, w)))
    if (unknownTargets || nonTest.length > 0) {
      return {
        allowed: false,
        reason: `SwarmOS Red-Team Guard: "qa-adversary" is forbidden from mutating production source files or git history via shell ("${short}").`,
      }
    }
  }

  for (const target of projectWrites) {
    if (isPlaceholder(target)) continue
    const decision = evaluateFileMutation(rootDir, board, agent, target)
    if (!decision.allowed) return decision
  }

  if (analysis.effects.includes("exec") || analysis.effects.includes("network")) {
    if (LEADERSHIP_AGENTS.has(agent) || agent === "explore" || agent === "plan") {
      return { allowed: true, ask: true, reason: `SwarmOS Shell Guard: "${short}" runs code or reaches the network; read-only role "${agent}" needs approval.` }
    }
    // QA may only touch tests; inline code could write anywhere, so a human checks it.
    if (agent === "qa-adversary" && analysis.commands.some((c) => c.effects.includes("exec") && /inline/.test(c.note ?? ""))) {
      return { allowed: true, ask: true, reason: `SwarmOS Red-Team Guard: "${short}" runs inline code SwarmOS cannot inspect; approve it manually.` }
    }
    return { allowed: true }
  }

  const readOnly = isReadOnly(analysis, agent !== "explore" && agent !== "plan")
  if (readOnly && AUTO_APPROVE_READ_AGENTS.has(agent)) return { allowed: true, autoAllow: true }
  if (!readOnly && (agent === "explore" || agent === "plan")) {
    return { allowed: true, ask: true, reason: `SwarmOS Shell Guard: "${short}" is not read-only; "${agent}" needs approval.` }
  }
  return { allowed: true }
}

/**
 * Pure synchronous evaluator against an already-loaded OrgBoard.
 */
export function evaluateBoardGuard(
  rootDir: string,
  board: OrgBoard,
  event: Pick<PermissionEvaluationEvent, "agent" | "action" | "resources">,
): GuardDecision {
  const agent = (event.agent ?? "").toLowerCase()
  const action = (event.action ?? "").toLowerCase()
  const resources = Array.isArray(event.resources) ? event.resources : []

  if (action === "edit" || action === "write" || action === "patch") {
    for (const rawResource of resources) {
      if (typeof rawResource !== "string" || rawResource === "*") continue
      const decision = evaluateFileMutation(rootDir, board, agent, rawResource)
      if (!decision.allowed) return decision
    }
  }

  if (action === "shell" || action === "bash") {
    let ask: GuardDecision | undefined
    let autoAllow = resources.length > 0
    for (const cmd of resources) {
      if (typeof cmd !== "string") continue
      const decision = evaluateShellCommand(rootDir, board, agent, cmd)
      if (!decision.allowed) return decision
      if (decision.ask && !ask) ask = decision
      if (!decision.autoAllow) autoAllow = false
    }
    if (ask) return ask
    if (autoAllow) return { allowed: true, autoAllow: true }
  }

  return { allowed: true }
}

/**
 * Evaluates permission guard asynchronously by loading the workspace OrgBoard.
 */
export async function evaluatePermissionGuard(
  rootDir: string,
  event: PermissionEvaluationEvent,
  evaluators: GuardEvaluator[] = [],
): Promise<GuardDecision> {
  const board = await loadBoard(rootDir)
  const base = evaluateBoardGuard(rootDir, board, event)
  if (!base.allowed) return base
  let result = base
  for (const evaluate of evaluators) {
    const extra = await evaluate(event, board)
    if (!extra) continue
    if (!extra.allowed) return extra
    if (extra.ask) result = { allowed: true, ask: true, reason: extra.reason }
  }
  return result
}

/**
 * Registers the SwarmOS runtime permission guard on OpenCode V2's `permission.hook("evaluate", ...)`.
 * `deny` produces a typed `Permission.BlockedError` the model sees as a `ToolFailure`; `ask`
 * downgrades a saved approval to a prompt; read-only commands from read-only roles skip the prompt.
 */
export async function registerPermissionGuard(ctx: any, rootDir: string, evaluators: GuardEvaluator[] = []): Promise<void> {
  if (ctx.permission?.hook) {
    await ctx.permission.hook("evaluate", async (event: PermissionEvaluationEvent) => {
      if (event.effect === "deny") return
      const decision = await evaluatePermissionGuard(rootDir, event, evaluators)
      if (!decision.allowed) {
        event.effect = "deny"
        event.message = decision.reason
      } else if (decision.ask) {
        if (event.effect === "allow") {
          event.effect = "ask"
          event.message = decision.reason
        }
      } else if (decision.autoAllow && event.effect === "ask") {
        event.effect = "allow"
      }
    })
  }
}
