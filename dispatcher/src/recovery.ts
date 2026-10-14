/**
 * Startup recovery (Stage 1c, Step 8). For every task recorded as
 * `running`: if the expert still has the session and it is busy,
 * re-attach; if it is idle, collect; if the session is gone, fail the
 * task with reason `lost` so its failure policy applies. Stale (recorded
 * but unconfirmed) worktree allocations are cleaned.
 */
import type { Task } from "./model.js";
import { OpenCodeClient, OpenCodeError } from "./opencode.js";
import { Store } from "./store.js";
import { cleanupUnconfirmed, type AllocationRegistry } from "./worktrees.js";

export type RecoveryAction =
  | { action: "reattach"; taskId: string; sessionId: string }
  | { action: "collect"; taskId: string; sessionId: string }
  | { action: "lost"; taskId: string };

/**
 * Triage one running task. `probeMs` bounds the idle check: a session
 * still busy when it fires is re-attached, not failed.
 */
export async function triageTask(
  client: OpenCodeClient,
  task: Task,
  probeMs: number,
): Promise<RecoveryAction> {
  if (task.sessionId === undefined || task.sessionId === "")
    return { action: "lost", taskId: task.id };
  try {
    await client.sessionInfo(task.sessionId);
  } catch (err) {
    if (err instanceof OpenCodeError && err.status === 404)
      return { action: "lost", taskId: task.id };
    return { action: "lost", taskId: task.id };
  }
  try {
    await client.waitIdle(task.sessionId, probeMs);
    return { action: "collect", taskId: task.id, sessionId: task.sessionId };
  } catch (err) {
    if (err instanceof OpenCodeError && err.status === 408)
      return { action: "reattach", taskId: task.id, sessionId: task.sessionId };
    return { action: "lost", taskId: task.id };
  }
}

/** Remove recorded-but-unconfirmed worktrees under one repository root. */
export async function recoverWorktrees(
  store: Store,
  repoRoot: string,
  repoDir: string,
  registry: AllocationRegistry,
): Promise<string[]> {
  const unconfirmed = store
    .listUnconfirmedAllocations()
    .map((a) => a.worktree)
    .filter((w) => w === repoRoot || w.startsWith(`${repoRoot}/`));
  if (unconfirmed.length === 0) return [];
  await cleanupUnconfirmed({ repoDir, worktrees: unconfirmed, registry });
  return unconfirmed;
}
