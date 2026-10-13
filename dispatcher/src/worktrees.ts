import { mkdir } from "node:fs/promises";
import path from "node:path";
import { baseEnv } from "./config.js";
import { execCmd } from "./util/exec.js";

/**
 * Task worktrees on a fleet-owned clone (shared context 9.1, 9.2).
 *
 * - `allocate` in `branch` mode puts the worktree on `fleet/<taskId>` at its
 *   current tip when the branch exists, or creates it from `base` when it
 *   does not. A retry therefore keeps every commit on the task branch. In
 *   `detached` mode the worktree is anchored at `base` with no branch.
 * - `release` removes the worktree and keeps the branch.
 * - `salvage` anchors `refs/fleet-salvage/<taskId>` at the branch tip, then
 *   deletes the branch.
 * - Nothing here touches the repository's own HEAD or its base branch tip:
 *   no function switches, moves, or joins branches in the main checkout.
 * - The crash-safe allocation register needs the store and arrives in
 *   Stage 1c; `registry` is the typed hook it will plug into.
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

/** Stage 1c store hook: records allocations so a crash leaves no orphan. */
export interface AllocationRegistry {
  record(a: AllocationRecord): void | Promise<void>;
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

async function git(repoDir: string, args: string[]): Promise<string> {
  const res = await execCmd(["git", ...args], { cwd: repoDir, env: baseEnv(), timeoutMs: 60_000 });
  if (res.exit !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr.trim().slice(0, 500)}`);
  return res.stdout.trim();
}

async function refExists(repoDir: string, ref: string): Promise<boolean> {
  const res = await execCmd(["git", "rev-parse", "--verify", ref], {
    cwd: repoDir,
    env: baseEnv(),
    timeoutMs: 60_000,
  });
  return res.exit === 0;
}

export async function allocate(input: AllocateInput): Promise<Allocation> {
  checkSlug("task id", input.taskId);
  const dir = path.join(input.treesDir, input.taskId);
  await mkdir(input.treesDir, { recursive: true });
  if (input.mode === "detached") {
    await git(input.repoDir, ["worktree", "add", "--detach", dir, input.base]);
    await input.registry?.record({
      taskId: input.taskId,
      worktree: dir,
      branch: null,
      at: new Date().toISOString(),
    });
    return { taskId: input.taskId, branch: "", dir };
  }
  const branch = taskBranch(input.taskId);
  if (await refExists(input.repoDir, `refs/heads/${branch}`)) {
    // Existing branch: attach at its current tip. Never move it.
    await git(input.repoDir, ["worktree", "add", dir, branch]);
  } else {
    await git(input.repoDir, ["worktree", "add", "-b", branch, dir, input.base]);
  }
  await input.registry?.record({
    taskId: input.taskId,
    worktree: dir,
    branch,
    at: new Date().toISOString(),
  });
  return { taskId: input.taskId, branch, dir };
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
  if (!(await refExists(input.repoDir, `refs/heads/${branch}`))) return undefined;
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
