import type { GuardDecision, GuardEvaluator, PermissionEvaluationEvent } from "../agents/guard.js"
import { evaluateTaskBudgetViolation, withBoardLock } from "../board/board.js"
import type { OrgBoard, Task } from "../board/types.js"
import { getSessionState } from "../host/session-state.js"

/**
 * Per-task spend and step budget enforcement.
 *
 * When a task has a `budget` (`maxTokens`, `maxTurns`, `maxToolCalls`), SwarmOS accumulates
 * usage from the session that claimed the task (or the single active `in_progress` task owned
 * by that subagent role). Once usage exceeds any configured ceiling, `overBudget` is set and
 * mutating/shell/subagent actions are blocked so control returns to `manager`.
 */

const BLOCKED_WHEN_OVER_BUDGET = new Set(["edit", "write", "patch", "multiedit", "apply_patch", "shell", "bash", "subagent"])

export function resolveSessionTask(board: OrgBoard, sessionID?: string, agent?: string): Task | undefined {
  const sid = sessionID ?? "default"
  const state = getSessionState(sid)
  if (state.taskId) {
    const byId = board.tasks.find((t) => t.id === state.taskId)
    if (byId) return byId
  }
  const byClaim = board.tasks.find((t) => t.claimedBySessionID === sid && t.status !== "superseded" && t.status !== "verified")
  if (byClaim) return byClaim
  if (agent) {
    const activeForRole = board.tasks.filter(
      (t) => t.owner === agent && (t.status === "in_progress" || t.status === "pending" || t.status === "qa_rejected"),
    )
    if (activeForRole.length === 1) return activeForRole[0]
  }
  return undefined
}

export async function recordTaskSpend(
  rootDir: string,
  input: { sessionID?: string; agent?: string; tokensDelta?: number; turnsDelta?: number; toolCallsDelta?: number },
): Promise<Task | undefined> {
  return withBoardLock(rootDir, (board) => {
    const task = resolveSessionTask(board, input.sessionID, input.agent)
    if (!task) return undefined
    task.usage ??= { tokensUsed: 0, turnsUsed: 0, toolCallsUsed: 0 }
    if (input.tokensDelta) task.usage.tokensUsed += Math.max(0, input.tokensDelta)
    if (input.turnsDelta) task.usage.turnsUsed += Math.max(0, input.turnsDelta)
    if (input.toolCallsDelta) task.usage.toolCallsUsed += Math.max(0, input.toolCallsDelta)
    task.usage.updatedAt = new Date().toISOString()

    const reason = evaluateTaskBudgetViolation(task.budget, task.usage)
    if (reason) {
      task.usage.overBudget = true
      task.usage.overBudgetReason = reason
    } else {
      task.usage.overBudget = false
      delete task.usage.overBudgetReason
    }
    return task
  })
}

export function createTaskBudgetEvaluator(): GuardEvaluator {
  return (event: PermissionEvaluationEvent, board: OrgBoard): GuardDecision | undefined => {
    const agent = (event.agent ?? "").toLowerCase()
    // Manager and Director can always run to re-scope or raise budgets.
    if (agent === "director" || agent === "manager") return undefined

    const action = (event.action ?? "").toLowerCase()
    if (!BLOCKED_WHEN_OVER_BUDGET.has(action)) return undefined

    const task = resolveSessionTask(board, event.sessionID, agent)
    if (!task || !task.budget) return undefined

    const reason = task.usage?.overBudgetReason ?? evaluateTaskBudgetViolation(task.budget, task.usage)
    if (!reason && !task.usage?.overBudget) return undefined

    return {
      allowed: false,
      reason: `SwarmOS Task Budget Guard: Task [${task.id}] ("${task.title}") exceeded its spend/step limit (${reason ?? "over budget"}). Stop execution immediately and report your current state back to "manager" so they can raise the budget via \`tools.org.set_task_budget\` or re-scope the task.`,
    }
  }
}

export async function registerTaskBudgetHooks(ctx: any, rootDir: string): Promise<void> {
  if (ctx.tool?.hook) {
    await ctx.tool.hook("execute.after", async (event: any) => {
      const task = await recordTaskSpend(rootDir, {
        sessionID: event?.sessionID,
        agent: event?.agent,
        toolCallsDelta: 1,
      })
      if (task?.usage?.overBudget) {
        const notice =
          `\n\n<task-budget-exceeded task="${task.id}">\n` +
          `SWARMOS TASK BUDGET LIMIT REACHED: Task [${task.id}] exceeded its budget (${task.usage.overBudgetReason}). ` +
          `Further file edits and shell commands are locked for this task. Summarize your progress and return to "manager".\n` +
          `</task-budget-exceeded>`
        if (event.status === "completed" && event.result) {
          if (Array.isArray(event.result.content)) {
            event.result.content = [...event.result.content, { type: "text", text: notice }]
          } else if (typeof event.result.content === "string" && !event.result.content.includes("<task-budget-exceeded")) {
            event.result.content += notice
          }
        }
      }
    })
  }

  if (ctx.session?.hook) {
    await ctx.session.hook("generate", async (event: any) => {
      if (event?.agent === "compaction" || event?.kind === "compaction") return
      const u = event?.usage ?? event?.tokens ?? event?.result?.usage
      const tok =
        u && typeof u === "object"
          ? (Number(u.input ?? u.inputTokens ?? u.prompt_tokens ?? 0) || 0) +
            (Number(u.output ?? u.outputTokens ?? u.completion_tokens ?? 0) || 0) +
            (Number(u.cacheRead ?? u.cache?.read ?? u.cache_read_input_tokens ?? 0) || 0)
          : 0
      await recordTaskSpend(rootDir, {
        sessionID: event?.sessionID,
        agent: event?.agent,
        turnsDelta: 1,
        tokensDelta: tok,
      })
    })
  }
}
