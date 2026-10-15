import { listSessionStates } from "../host/session-state.js"
import { formatDoctorReport, getSetupReport } from "../host/setup-report.js"
import { getContextBudgetReport } from "../omni/context-budget.js"
import { transactionStats } from "../omni/transactions.js"

function contextCell(sessionID: string): string {
  const r = getContextBudgetReport(sessionID)
  if (!r) return "-"
  return `${r.usedTokens}/${r.budgetTokens} tok${r.dropped.length ? `, dropped ${r.dropped.length}` : ""}`
}

function sessionLines(): string[] {
  const states = listSessionStates()
  if (states.length === 0) return []
  return [
    "## Live sessions",
    "| Session | Agent | Turns | Tool calls | Failures | Breaker fires | Untrusted content | Task | Context used |",
    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ...states.map(
      (s) =>
        `| \`${s.sessionID}\` | ${s.agent ?? "-"} | ${s.turns} | ${s.toolCalls} | ${s.toolFailures} | ${s.breakerFires} | ${
          s.taint.length ? s.taint.map((t) => `${t.tool}`).join(", ") : "none"
        } | ${s.taskId ?? "-"} | ${contextCell(s.sessionID)} |`,
    ),
  ]
}

function transactionLines(): string[] {
  const t = transactionStats
  if (t.started === 0) return []
  return [
    "## Edit transactions",
    `${t.started} snapshotted, ${t.committed} committed, ${t.rolledBack} rolled back (${t.filesRestored} file(s) restored).`,
  ]
}

export function buildDoctorText(rootDir: string): string {
  return formatDoctorReport(getSetupReport(rootDir), [...sessionLines(), ...transactionLines()])
}

export function registerDoctorTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "swarmos",
    description: "SwarmOS self-diagnostics: which host capabilities exist and which SwarmOS modules are active.",
  })

  editor.add({
    name: "doctor",
    description:
      "Report which OpenCode V2 capabilities SwarmOS found, which modules registered or were skipped (and why), and hook errors caught at runtime.",
    options: { namespace: "swarmos", codemode: true, pinned: false },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const report = getSetupReport(rootDir)
      return { output: report ?? null, content: buildDoctorText(rootDir) }
    },
  })
}

export async function registerDoctorCommand(ctx: any, rootDir: string): Promise<void> {
  if (!ctx.command?.transform) return

  await ctx.command.transform((editor: any) => {
    editor.add({
      name: "doctor",
      description: "Show which SwarmOS modules are active in this OpenCode session and which host capabilities are missing",
      execute: async (input: any) => {
        if (ctx.session?.prompt) {
          await ctx.session.prompt({ sessionID: input.sessionID, text: buildDoctorText(rootDir), delivery: "steer" })
        }
      },
    })
  })
}
