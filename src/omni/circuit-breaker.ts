export interface ToolAttemptRecord {
  tool: string
  target: string
  status: "completed" | "error"
  signature: string
  timestamp: number
}

const sessionAttempts = new Map<string, ToolAttemptRecord[]>()

export function resetCircuitBreaker(sessionID?: string): void {
  if (sessionID) sessionAttempts.delete(sessionID)
  else sessionAttempts.clear()
}

export function recordAndEvaluateCircuitBreaker(event: {
  sessionID?: string
  tool: string
  input?: any
  status: "completed" | "error"
  error?: any
  result?: any
}): string | undefined {
  const sid = event.sessionID ?? "default"
  const history = sessionAttempts.get(sid) ?? []

  const target =
    typeof event.input?.path === "string"
      ? event.input.path
      : typeof event.input?.command === "string"
        ? event.input.command.slice(0, 80)
        : "global"

  const errText =
    event.status === "error"
      ? String(event.error?.message ?? event.error ?? "error").slice(0, 120)
      : typeof event.result?.content === "string" && event.result.content.includes("<diagnostics")
        ? "diagnostics-error"
        : "ok"

  const effectiveStatus: "completed" | "error" =
    event.status === "error" || errText === "diagnostics-error" ? "error" : "completed"

  const record: ToolAttemptRecord = {
    tool: event.tool,
    target,
    status: effectiveStatus,
    signature: `${event.tool}:${target}:${errText}`,
    timestamp: Date.now(),
  }

  history.push(record)
  if (history.length > 20) history.shift()
  sessionAttempts.set(sid, history)

  if (effectiveStatus === "completed") return undefined

  // Check consecutive failures on the same tool + target
  const recentSameTarget = history.filter((r) => r.tool === event.tool && r.target === target)
  const consecutiveErrors = (() => {
    let count = 0
    for (let i = recentSameTarget.length - 1; i >= 0; i--) {
      if (recentSameTarget[i].status === "error") count++
      else break
    }
    return count
  })()

  if ((event.tool === "edit" || event.tool === "patch") && consecutiveErrors >= 2) {
    return (
      `\n\n<circuit-breaker-intervention severity="high">\n` +
      `DOOM-LOOP CIRCUIT BREAKER: \`${event.tool}\` has failed or produced syntax errors ${consecutiveErrors} consecutive times on "${target}".\n` +
      `MANDATORY ACTION: Stop calling \`${event.tool}\` on "${target}". Immediately switch to \`execute\` -> \`tools.fs.hash_read({ path: "${target}" })\` and \`tools.fs.hash_edit\` to apply hash-anchored line replacements cleanly.\n` +
      `</circuit-breaker-intervention>`
    )
  }

  if (event.tool === "shell" && consecutiveErrors >= 3) {
    return (
      `\n\n<circuit-breaker-intervention severity="high">\n` +
      `DOOM-LOOP CIRCUIT BREAKER: Shell command "${target}" has failed ${consecutiveErrors} times in a row.\n` +
      `MANDATORY ACTION: Stop re-running the failing command blindly. Inspect the upstream caller/types using \`tools.repo.blast_radius\` or \`read\`, and record a root-cause hypothesis in \`tools.artifacts.write({ name: "notes.md", ... })\` before making another edit.\n` +
      `</circuit-breaker-intervention>`
    )
  }

  return undefined
}

export async function registerCircuitBreakerHook(ctx: any): Promise<void> {
  if (!ctx.tool?.hook) return

  await ctx.tool.hook("execute.after", async (event: any) => {
    const intervention = recordAndEvaluateCircuitBreaker(event)
    if (!intervention) return

    if (event.status === "completed" && event.result) {
      if (Array.isArray(event.result.content)) {
        event.result.content = [...event.result.content, { type: "text", text: intervention }]
      } else if (typeof event.result.content === "string") {
        event.result.content += intervention
      }
    } else if (event.status === "error" && event.error && typeof event.error === "object") {
      if (typeof event.error.message === "string" && !event.error.message.includes("DOOM-LOOP CIRCUIT BREAKER")) {
        event.error.message += intervention
      }
    }
  })
}
