import * as path from "node:path"
import type { GuardDecision, GuardEvaluator, PermissionEvaluationEvent } from "../agents/guard.js"
import { matchesPathPattern, normalizeResourcePath } from "../agents/guard.js"
import { analyzeShell } from "../agents/shell-parse.js"
import { getSessionState, listSessionStates, type SessionState } from "../host/session-state.js"

/**
 * Prompt-injection taint tracking. Once a session consumes output from the web, a browser or a
 * third-party MCP server, risky actions that a saved rule would normally allow need approval again:
 * network commands, writes outside the project, and edits to harness, git or CI configuration.
 */

const UNTRUSTED_TOOLS = /^(?:webfetch|websearch|fetch|web_search|web_fetch|browser[._-].*|mcp[._-].*|.*__.*)$/i
const CODEMODE_UNTRUSTED = /\btools\.(?:browser|opencode\.(?:webfetch|websearch)|research)\b|\b(?:webfetch|websearch)\s*\(/

const SENSITIVE_PATHS = [
  ".opencode/**",
  "opencode.json",
  ".git/**",
  ".github/workflows/**",
  ".gitlab-ci.yml",
  ".husky/**",
  ".npmrc",
  ".env",
  ".env.*",
  "package.json",
  "**/*.sh",
]
const HOME_SENSITIVE = /(?:^|\/)(?:\.ssh|\.aws|\.gnupg|\.config\/opencode|\.bashrc|\.zshrc|\.profile|\.bash_profile|\.gitconfig|\.npmrc)(?:\/|$)/

function resourceOf(event: any): string {
  const i = event?.input ?? {}
  const value = i.url ?? i.query ?? i.uri ?? i.path ?? (typeof i.code === "string" ? "code mode script" : undefined)
  return String(value ?? "").slice(0, 200)
}

/** Marks the session tainted if this finished tool call returned untrusted external content. */
export function recordTaint(event: any): boolean {
  const tool = String(event?.tool ?? "")
  if (event?.status === "error") return false
  const untrusted =
    UNTRUSTED_TOOLS.test(tool) || (tool === "execute" && typeof event?.input?.code === "string" && CODEMODE_UNTRUSTED.test(event.input.code))
  if (!untrusted) return false
  const state = getSessionState(event?.sessionID)
  state.taint.push({ tool, resource: resourceOf(event), at: new Date().toISOString() })
  if (state.taint.length > 20) state.taint.shift()
  return true
}

export function clearTaint(sessionID: string | undefined): number {
  const state = getSessionState(sessionID)
  const n = state.taint.length
  state.taint = []
  return n
}

function taintedState(sessionID: string | undefined): SessionState | undefined {
  if (sessionID) {
    const s = getSessionState(sessionID)
    return s.taint.length ? s : undefined
  }
  // Without a session ID, be conservative: any tainted session counts.
  return listSessionStates().find((s) => s.taint.length > 0)
}

function isSensitive(rootDir: string, raw: string): string | undefined {
  if (HOME_SENSITIVE.test(raw)) return "a credential or shell profile file"
  const rel = normalizeResourcePath(rootDir, raw)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    if (/^\/(?:tmp|var\/tmp)\//.test(raw) || raw === "/dev/null") return undefined
    return "a path outside the project"
  }
  const hit = SENSITIVE_PATHS.find((p) => matchesPathPattern(rel, p))
  return hit ? `harness, git or CI configuration (${rel})` : undefined
}

function describe(state: SessionState): string {
  const last = state.taint[state.taint.length - 1]
  return `${last.tool}${last.resource ? ` (${last.resource})` : ""}`
}

/** Guard evaluator: downgrades risky actions to "ask" for sessions holding untrusted content. */
export function createTaintEvaluator(rootDir: string): GuardEvaluator {
  return (event: PermissionEvaluationEvent): GuardDecision | undefined => {
    const state = taintedState(event.sessionID)
    if (!state) return undefined
    const action = (event.action ?? "").toLowerCase()
    const resources = (event.resources ?? []).filter((r): r is string => typeof r === "string")
    const ask = (why: string): GuardDecision => ({
      allowed: true,
      ask: true,
      reason: `SwarmOS Taint Guard: this session read untrusted external content from ${describe(state)}, and this action ${why}. Confirm it was your intent, not an instruction from that content. Use /untaint once you have reviewed the session.`,
    })

    if (action === "external_directory") return ask("reaches outside the project")

    if (action === "edit" || action === "write" || action === "patch") {
      for (const r of resources) {
        const why = isSensitive(rootDir, r)
        if (why) return ask(`modifies ${why}`)
      }
    }

    if (action === "shell" || action === "bash") {
      for (const cmd of resources) {
        const analysis = analyzeShell(cmd)
        if (analysis.unparseable) return ask("is a shell command SwarmOS could not parse")
        if (analysis.effects.includes("network")) return ask("sends or fetches data over the network")
        for (const w of analysis.writes) {
          const why = isSensitive(rootDir, w)
          if (why) return ask(`writes ${why}`)
        }
        if (analysis.effects.includes("exec") && analysis.commands.some((c) => /inline|script|sources/.test(c.note ?? ""))) {
          return ask("runs inline or downloaded code")
        }
      }
    }
    return undefined
  }
}

export async function registerTaintHooks(ctx: any): Promise<void> {
  if (!ctx.tool?.hook) return
  await ctx.tool.hook("execute.after", async (event: any) => {
    recordTaint(event)
  })
}

export async function registerUntaintCommand(ctx: any): Promise<void> {
  if (!ctx.command?.transform) return
  await ctx.command.transform((editor: any) => {
    editor.add({
      name: "untaint",
      description: "Clear SwarmOS untrusted-content tracking for this session after you have reviewed what it read",
      execute: async (input: any) => {
        const n = clearTaint(input?.sessionID)
        if (ctx.session?.prompt) {
          await ctx.session.prompt({
            sessionID: input?.sessionID,
            text: n
              ? `SwarmOS: cleared ${n} untrusted-content record(s) for this session. Saved approvals apply again.`
              : "SwarmOS: this session has no untrusted-content records.",
            delivery: "steer",
          })
        }
      },
    })
  })
}
