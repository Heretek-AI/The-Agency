/**
 * The OpenCode V2 plugin surface SwarmOS depends on.
 *
 * SwarmOS receives the host context as `any`, so a renamed or missing host API
 * would otherwise make modules silently register nothing. Every module declares
 * the capabilities it needs here; `probeHost` checks them at startup, `/doctor`
 * reports them, and `scripts/check-host-contract.ts` looks for them in an
 * OpenCode source checkout.
 */

export interface HostCapability {
  id: string
  path: string[]
  kind: "function" | "value"
  required: boolean
  usedBy: string
  /** Hook names SwarmOS registers through this capability (for `hook` functions). */
  hookNames?: string[]
  /**
   * Strings expected in the OpenCode V2 source when this capability exists. A value wrapped in
   * double quotes must appear as a string literal (either quote style); anything else as an identifier.
   */
  evidence: string[]
}

export const HOST_CONTRACT: HostCapability[] = [
  {
    id: "location.directory",
    path: ["location", "directory"],
    kind: "value",
    required: false,
    usedBy: "workspace root (falls back to process.cwd())",
    evidence: ["directory"],
  },
  {
    id: "agent.transform",
    path: ["agent", "transform"],
    kind: "function",
    required: true,
    usedBy: "10 SwarmOS agent roles",
    evidence: ["transform", "permissions"],
  },
  {
    id: "agent.get",
    path: ["agent", "get"],
    kind: "function",
    required: false,
    usedBy: "Muse overlay (skips agents with their own system prompt)",
    evidence: ["agentID"],
  },
  {
    id: "tool.transform",
    path: ["tool", "transform"],
    kind: "function",
    required: true,
    usedBy: "Code Mode namespaces (tools.org.*, tools.fs.*, tools.verify.*, ...)",
    evidence: ["transform", "codemode", "pinned"],
  },
  {
    id: "tool.hook",
    path: ["tool", "hook"],
    kind: "function",
    required: true,
    usedBy: "diagnostics, circuit breaker, transactions, taint tracking, telemetry",
    hookNames: ["execute.before", "execute.after"],
    evidence: ['"execute.after"', '"execute.before"'],
  },
  {
    id: "permission.hook",
    path: ["permission", "hook"],
    kind: "function",
    required: true,
    usedBy: "contract, ownership, shell, taint and budget guards",
    hookNames: ["evaluate"],
    evidence: ['"evaluate"'],
  },
  {
    id: "session.hook",
    path: ["session", "hook"],
    kind: "function",
    required: true,
    usedBy: "Muse overlay and the budgeted context injector",
    hookNames: ["context", "generate"],
    evidence: ['"context"', '"generate"'],
  },
  {
    id: "session.prompt",
    path: ["session", "prompt"],
    kind: "function",
    required: false,
    usedBy: "slash commands that post reports or kick off protocols",
    evidence: ["delivery"],
  },
  {
    id: "session.switchAgent",
    path: ["session", "switchAgent"],
    kind: "function",
    required: false,
    usedBy: "/ship, /gui, /research, /office",
    evidence: ["switchAgent"],
  },
  {
    id: "command.transform",
    path: ["command", "transform"],
    kind: "function",
    required: true,
    usedBy: "slash commands",
    evidence: ["transform"],
  },
  {
    id: "skill.transform",
    path: ["skill", "transform"],
    kind: "function",
    required: false,
    usedBy: "ui-craft skill",
    evidence: ["transform"],
  },
  {
    id: "experimental.terminal.read",
    path: ["experimental", "terminal", "read"],
    kind: "function",
    required: false,
    usedBy: "tools.pty.read_logs (falls back to log files)",
    evidence: ["terminal"],
  },
]

export interface HostProbeResult {
  id: string
  present: boolean
  required: boolean
  usedBy: string
}

function getPath(obj: any, segments: string[]): unknown {
  let cur = obj
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[seg]
  }
  return cur
}

export function hasCapability(ctx: any, id: string): boolean {
  const cap = HOST_CONTRACT.find((c) => c.id === id)
  if (!cap) return false
  const value = getPath(ctx, cap.path)
  return cap.kind === "function" ? typeof value === "function" : value !== undefined && value !== null
}

export function probeHost(ctx: any): HostProbeResult[] {
  return HOST_CONTRACT.map((cap) => ({
    id: cap.id,
    present: hasCapability(ctx, cap.id),
    required: cap.required,
    usedBy: cap.usedBy,
  }))
}

export function missingRequired(probe: HostProbeResult[]): string[] {
  return probe.filter((p) => p.required && !p.present).map((p) => p.id)
}
