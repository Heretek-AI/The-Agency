import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { git, gitRefExists } from "./git.js";

/**
 * Task worktrees on a fleet-owned clone (shared context 9.1, 9.2).
 *
 * - `allocate` in `branch` mode puts the worktree on `fleet/<taskId>` at its
 *   current tip when the branch exists, or creates it from `base` when it
 *   does not. A retry therefore keeps every commit on the task branch. In
 *   `detached` mode the worktree is anchored at `base` with no branch.
 * - Crash safety: the allocation is recorded in the register *before* the
 *   git work and confirmed after. A crash between the two leaves an
 *   unconfirmed row; on startup the engine lists unconfirmed allocations
 *   and `cleanupUnconfirmed` removes them, so a crash never leaves an
 *   untracked worktree.
 * - `release` removes the worktree and keeps the branch.
 * - `salvage` anchors `refs/fleet-salvage/<taskId>` at the branch tip, then
 *   deletes the branch.
 * - Landing worktrees under `<landingRoot>/<id>` are created and removed
 *   by the landing transaction only.
 * - Nothing here touches the repository's own HEAD or its base branch tip:
 *   no function switches, moves, or joins branches in the main checkout.
 */

export const taskBranch = (taskId: string): string => `fleet/${taskId}`;
export const integrationBranch = (missionId: string): string => `fleet/integration/${missionId}`;
export const salvageRef = (taskId: string): string => `refs/fleet-salvage/${taskId}`;

export function checkSlug(kind: string, value: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value))
    throw new Error(`${kind} ${JSON.stringify(value)} is not a slug`);
}

export interface AllocateInput {
  readonly repoDir: string;
  readonly treesDir: string;
  readonly taskId: string;
  readonly mode: "branch" | "detached";
  readonly base: string;
  readonly registry?: AllocationRegistry;
}

export interface Allocation {
  readonly taskId: string;
  readonly branch: string;
  readonly dir: string;
}

export interface AllocationRecord {
  readonly taskId: string;
  readonly worktree: string;
  readonly branch: string | null;
  readonly at: string;
}

/**
 * Store-backed allocation register (implemented by the Stage 1c store).
 * `record` runs before the git work, `confirm` after; a crash between
 * them leaves an unconfirmed row for startup cleanup.
 */
export interface AllocationRegistry {
  record(a: AllocationRecord): void | Promise<void>;
  confirm(worktree: string): void | Promise<void>;
  releaseWorktree(worktree: string): void | Promise<void>;
}

export interface InspectResult {
  readonly head: string;
  /** Branch name, or null when detached. */
  readonly branch: string | null;
  readonly dirty: boolean;
  /** Commits HEAD is ahead of `base`. */
  readonly ahead: number;
}

export async function allocate(input: AllocateInput): Promise<Allocation> {
  checkSlug("task id", input.taskId);
  const dir = path.join(input.treesDir, input.taskId);
  await mkdir(input.treesDir, { recursive: true });
  if (input.mode === "detached") {
    await input.registry?.record({
      taskId: input.taskId,
      worktree: dir,
      branch: null,
      at: new Date().toISOString(),
    });
    await git(input.repoDir, ["worktree", "add", "--detach", dir, input.base]);
    await input.registry?.confirm(dir);
    return { taskId: input.taskId, branch: "", dir };
  }
  const branch = taskBranch(input.taskId);
  await input.registry?.record({
    taskId: input.taskId,
    worktree: dir,
    branch,
    at: new Date().toISOString(),
  });
  if (await gitRefExists(input.repoDir, `refs/heads/${branch}`)) {
    // Existing branch: attach at its current tip. Never move it.
    await git(input.repoDir, ["worktree", "add", dir, branch]);
  } else {
    await git(input.repoDir, ["worktree", "add", "-b", branch, dir, input.base]);
  }
  await input.registry?.confirm(dir);
  return { taskId: input.taskId, branch, dir };
}

/**
 * Remove worktrees whose allocation was recorded but never confirmed
 * (a crash between register and confirm) and release their rows. Runs
 * on engine startup. Reports every failure instead of stopping at the
 * first, so one stuck worktree cannot hide the rest.
 */
export async function cleanupUnconfirmed(input: {
  repoDir: string;
  worktrees: string[];
  registry?: AllocationRegistry;
}): Promise<void> {
  const failures: string[] = [];
  for (const worktree of input.worktrees) {
    try {
      await git(input.repoDir, ["worktree", "remove", "--force", worktree]);
    } catch (err) {
      // The directory may predate the crash oddly; fall back to deleting
      // it so no untracked tree survives, then prune the metadata.
      try {
        await rm(worktree, { recursive: true, force: true });
        await git(input.repoDir, ["worktree", "prune"]);
      } catch {
        failures.push(`${worktree}: ${(err as Error).message}`);
        continue;
      }
    }
    try {
      await input.registry?.releaseWorktree(worktree);
    } catch (err) {
      failures.push(`${worktree}: ${(err as Error).message}`);
    }
  }
  if (failures.length > 0) throw new Error(`cleanupUnconfirmed failed for: ${failures.join("; ")}`);
}

/** Remove the worktree. The task branch (and its commits) stays. */
export async function release(input: {
  repoDir: string;
  worktree: string;
  registry?: AllocationRegistry;
}): Promise<void> {
  await git(input.repoDir, ["worktree", "remove", "--force", input.worktree]);
  await input.registry?.releaseWorktree(input.worktree);
}

/**
 * Anchor the branch tip at `refs/fleet-salvage/<taskId>`, then delete the
 * branch. Returns the anchored tip, or undefined when there is no branch.
 * Fails closed while any worktree still uses the branch: release first.
 */
export async function salvage(input: {
  repoDir: string;
  taskId: string;
}): Promise<string | undefined> {
  checkSlug("task id", input.taskId);
  const branch = taskBranch(input.taskId);
  if (!(await gitRefExists(input.repoDir, `refs/heads/${branch}`))) return undefined;
  const listing = await git(input.repoDir, ["worktree", "list", "--porcelain"]);
  let attached: string | undefined;
  let current: string | undefined;
  for (const line of listing.split("\n")) {
    if (line.startsWith("worktree ")) current = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}`) attached = current;
  }
  if (attached !== undefined) {
    throw new Error(
      `cannot salvage ${branch}: worktree at ${attached} still uses it; release first`,
    );
  }
  const tip = await git(input.repoDir, ["rev-parse", branch]);
  await git(input.repoDir, ["update-ref", salvageRef(input.taskId), tip]);
  await git(input.repoDir, ["branch", "-D", branch]);
  return tip;
}

/**
 * Create a throwaway landing worktree on `branch` (the mission's
 * integration branch). Only the landing transaction calls this.
 */
export async function addLandingWorktree(input: {
  repoDir: string;
  landingRoot: string;
  id: string;
  branch: string;
}): Promise<string> {
  checkSlug("landing id", input.id);
  const dir = path.join(input.landingRoot, input.id);
  await mkdir(input.landingRoot, { recursive: true });
  await git(input.repoDir, ["worktree", "add", dir, input.branch]);
  return dir;
}

/** Remove a landing worktree. Only the landing transaction calls this. */
export async function removeLandingWorktree(input: {
  repoDir: string;
  dir: string;
}): Promise<void> {
  await git(input.repoDir, ["worktree", "remove", "--force", input.dir]);
}

export async function inspect(input: {
  repoDir: string;
  worktree: string;
  base: string;
}): Promise<InspectResult> {
  const head = await git(input.worktree, ["rev-parse", "HEAD"]);
  const abbrev = await git(input.worktree, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = await git(input.worktree, ["status", "--porcelain"]);
  const aheadRaw = await git(input.worktree, ["rev-list", "--count", `${input.base}..HEAD`]);
  return {
    head,
    branch: abbrev === "HEAD" ? null : abbrev,
    dirty: status.length > 0,
    ahead: Number(aheadRaw),
  };
}
