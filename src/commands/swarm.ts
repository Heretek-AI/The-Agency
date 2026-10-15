import { loadBoard, verifyReleaseReady } from "../board/board.js"
import { SWARMOS_VERSION } from "../version.js"

export async function registerSwarmCommand(ctx: any, rootDir: string): Promise<void> {
  if (!ctx.command?.transform) return

  await ctx.command.transform((editor: any) => {
    editor.add({
      name: "swarm",
      description:
        "Inspect SwarmOS multi-agent organizational status, release readiness gate, tournaments, locked contracts, and QA receipts",
      execute: async (input: any) => {
        const [board, readiness] = await Promise.all([loadBoard(rootDir), verifyReleaseReady(rootDir)])
        const tournaments = Array.isArray(board.tournaments) ? board.tournaments : []

        const summary = [
          `# SwarmOS Organizational Status (v${SWARMOS_VERSION})`,
          "",
          board.project
            ? `**Project**: ${board.project.name} (${board.project.aestheticArchetype})\n**Vision**: ${board.project.vision}`
            : "_No active project charter. Run `/ship <spec>` to initialize._",
          "",
          `### Release Gate: ${readiness.ready ? "READY TO SHIP" : `BLOCKED (${readiness.blockers.length} blocker(s))`}`,
          ...(readiness.ready
            ? [`- All ${readiness.verifiedTasks.length} active task(s) verified with signed QA PASS receipts.`]
            : readiness.blockers.map((b) => `- [Blocker] ${b}`)),
          "",
          `### Locked Contracts (${board.contracts.length})`,
          board.contracts.length === 0
            ? "- No contracts locked yet."
            : board.contracts.map((c) => `- **[${c.id}]** ${c.title} (${c.files.join(", ")})`).join("\n"),
          "",
          `### Engineering Tasks (${board.tasks.length})`,
          board.tasks.length === 0
            ? "- No tasks created yet."
            : board.tasks
                .map((t) => {
                  const latestReceipt = t.qaReceipts[t.qaReceipts.length - 1]
                  const receiptTag = latestReceipt ? ` [QA: ${latestReceipt.verdict}]` : " [QA: Unverified]"
                  const pathsTag = t.ownedPaths.length > 0 ? ` — owns: \`${t.ownedPaths.join(", ")}\`` : ""
                  return `- **[${t.id}]** ${t.title} -> **${t.owner}** (${t.status})${receiptTag}${pathsTag}`
                })
                .join("\n"),
          ...(tournaments.length > 0
            ? [
                "",
                `### Worktree Tournaments (${tournaments.length})`,
                ...tournaments.map((tr) =>
                  tr.status === "resolved"
                    ? `- **[${tr.id}]** ${tr.title} (${tr.role}) -> **RESOLVED** (Winner: \`${tr.winningTaskId}\`)`
                    : `- **[${tr.id}]** ${tr.title} (${tr.role}) -> **ACTIVE** (${tr.candidates.map((c) => c.taskId).join(" vs. ")})`,
                ),
              ]
            : []),
        ].join("\n")

        if (ctx.session?.prompt) {
          await ctx.session.prompt({
            sessionID: input.sessionID,
            text: summary,
            delivery: "steer",
          })
        }
      },
    })
  })
}
