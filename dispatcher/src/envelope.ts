/**
 * Task envelope (shared context 9.7): the text the Dispatcher sends to
 * an expert as its prompt.
 */
export interface EnvelopeInput {
  taskId: string;
  title: string;
  missionId: string;
  role: string;
  expert: string;
  objective: string;
  context?: string;
  constraints?: string;
  acceptance: string[];
  /** Worktree path (the session's location). */
  worktree: string;
  /** Task branch, or null for a detached read-only worktree. */
  branch: string | null;
  /** Granted paths, empty for read-only experts. */
  grantedPaths: string[];
  /** Environment stack description; Stage 1c has no stacks. */
  envStack?: string;
}

export function buildEnvelope(input: EnvelopeInput): string {
  const lines: string[] = [];
  lines.push(`# Task ${input.taskId}: ${input.title}`);
  lines.push(`Mission: ${input.missionId}   Role: ${input.role}   Assigned to: ${input.expert}`);
  lines.push("");
  lines.push("## Objective");
  lines.push(input.objective);
  lines.push("");
  lines.push("## Context");
  lines.push(input.context ?? "(none)");
  lines.push("");
  lines.push("## Constraints");
  lines.push(input.constraints ?? "(none)");
  lines.push(
    `- Work only inside ${input.worktree} (your current location). Branch: ${input.branch ?? "detached, read-only"}.`,
  );
  lines.push(
    input.grantedPaths.length > 0
      ? `- You may modify only: ${input.grantedPaths.join(", ")}.`
      : `- You may modify only: nothing; write findings to the artifacts directory.`,
  );
  lines.push(`- Write reports, screenshots, and other outputs to /artifacts/${input.taskId}/.`);
  lines.push(`- Your environment stack, if any: ${input.envStack ?? "none"}.`);
  lines.push(
    "- If AGENTS.md exists at the worktree root, read it first and follow its conventions.",
  );
  lines.push("");
  lines.push("## Acceptance criteria");
  if (input.acceptance.length === 0) lines.push("(none stated)");
  input.acceptance.forEach((criterion, i) => lines.push(`${i + 1}. ${criterion}`));
  lines.push("");
  lines.push("## When finished");
  lines.push(
    "Commit your work on the current branch (writers only). Do not push, merge, or switch branches.",
  );
  lines.push("End your final message with the block your fleet protocol defines.");
  return lines.join("\n");
}
