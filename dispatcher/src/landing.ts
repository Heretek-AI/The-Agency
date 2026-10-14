/**
 * Landing transaction (shared context 9.4). Landing a task is one
 * transaction:
 *
 * 1. Verify in the task worktree. A failure fails the landing with the
 *    check's name as the reason and merges nothing. An empty check list
 *    fails with `no-checks`.
 * 2. Merge `fleet/<taskId>` into the mission's integration branch with
 *    `--no-ff` inside a throwaway worktree, after recording the
 *    pre-merge tip. On conflict, abort and report the conflicting files.
 * 3. Verify the merged tree. On failure, reset the integration branch to
 *    the recorded tip and fail the landing.
 * 4. On success the task's `landedSha` is the merge commit, whose message
 *    carries the four Agency trailers (mission, task, verify passes, and
 *    the audit tip hash at the moment of the merge).
 *
 * Each outcome is audited (`landing.merged` or `landing.reset`). Callers
 * hold one `MissionLocks` slot per mission so two landings on the same
 * mission never interleave.
 */
import { git } from "./git.js";
import type { ChecksConfig } from "./registry-schema.js";
import type { Verifier } from "./verify.js";
import { addLandingWorktree, removeLandingWorktree } from "./worktrees.js";

export interface LandingPaths {
  repoDir: string;
  landingRoot: string;
  artifactsDir: string;
}

export interface LandingDeps {
  verifier: Verifier;
  checks: ChecksConfig;
  audit(event: string, data: unknown): Promise<void>;
  /** Current audit tip, embedded in the merge commit at merge time. */
  auditTip(): { seq: number; hash: string };
  paths: LandingPaths;
}

export interface LandInput {
  missionId: string;
  /** Producer expert-run task id. */
  taskId: string;
  taskBranch: string;
  integrationBranch: string;
  /** Task worktree directory (verified as-is). */
  worktreeDir: string;
}

export type LandResult =
  | { ok: true; landedSha: string; verify: string[]; auditTip: string }
  | { ok: false; reason: string; stage: "task" | "merge" | "merged"; files?: string[] };

/** In-process per-mission mutex: two landings never interleave. */
export class MissionLocks {
  private readonly held = new Map<string, Promise<void>>();

  async acquire(missionId: string): Promise<() => void> {
    const previous = this.held.get(missionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.held.set(
      missionId,
      previous.then(() => current),
    );
    await previous;
    return () => {
      release();
      if (this.held.get(missionId) === current) this.held.delete(missionId);
    };
  }
}

async function conflictedFiles(dir: string): Promise<string[]> {
  const out = await git(dir, ["diff", "--name-only", "--diff-filter=U"]);
  return out
    .split("\n")
    .filter((s) => s !== "")
    .sort();
}

export async function land(input: LandInput, deps: LandingDeps): Promise<LandResult> {
  const { verifier, checks, paths } = deps;
  const setup = checks.setup;

  if (checks.checks.length === 0) {
    await deps.audit("landing.reset", {
      mission: input.missionId,
      task: input.taskId,
      stage: "task",
      reason: "no-checks",
    });
    return { ok: false, reason: "no-checks", stage: "task" };
  }

  // 1. Verify in the task worktree.
  const pre = await verifier.run({
    taskId: input.taskId,
    dir: input.worktreeDir,
    setup,
    checks: checks.checks,
  });
  await deps.audit("verify.result", {
    mission: input.missionId,
    task: input.taskId,
    stage: "task",
    ok: pre.ok,
    reason: pre.reason,
  });
  if (!pre.ok) {
    const reason =
      pre.reason === "setup"
        ? "setup"
        : (pre.checks.find((c) => c.exit !== 0)?.id ?? pre.reason ?? "checks");
    await deps.audit("landing.reset", {
      mission: input.missionId,
      task: input.taskId,
      stage: "task",
      reason,
    });
    return { ok: false, reason, stage: "task" };
  }

  // 2. Record the pre-merge tip, then merge --no-ff in a throwaway worktree.
  const tip = await git(paths.repoDir, ["rev-parse", input.integrationBranch]);
  const landingId = `${input.taskId}`;
  const dir = await addLandingWorktree({
    repoDir: paths.repoDir,
    landingRoot: paths.landingRoot,
    id: landingId,
    branch: input.integrationBranch,
  });
  try {
    const auditTip = deps.auditTip();
    const message = [
      `land ${input.taskBranch} into ${input.integrationBranch}`,
      "",
      `Agency-Mission: ${input.missionId}`,
      `Agency-Task: ${input.taskId}`,
      `Agency-Verify: ${checks.checks.map((c) => `${c.id}=pass`).join(" ")}`,
      `Agency-Audit-Tip: ${auditTip.hash}`,
    ].join("\n");
    let merged = true;
    let conflictFiles: string[] = [];
    try {
      await git(dir, [
        "-c",
        "user.name=agency-dispatcher",
        "-c",
        "user.email=dispatcher@agency.invalid",
        "merge",
        "--no-ff",
        input.taskBranch,
        "-m",
        message,
      ]);
    } catch (err) {
      // A real conflict leaves unmerged paths; anything else is rethrown.
      conflictFiles = await conflictedFiles(dir).catch(() => [] as string[]);
      if (conflictFiles.length === 0) throw err;
      merged = false;
      await git(dir, ["merge", "--abort"]).catch(() => {});
      await deps.audit("landing.reset", {
        mission: input.missionId,
        task: input.taskId,
        stage: "merge",
        reason: "conflict",
        files: conflictFiles,
      });
    }
    if (!merged) return { ok: false, reason: "conflict", stage: "merge", files: conflictFiles };

    // 3. Verify the merged tree; on red, reset to the recorded tip.
    const post = await verifier.run({ taskId: input.taskId, dir, setup, checks: checks.checks });
    await deps.audit("verify.result", {
      mission: input.missionId,
      task: input.taskId,
      stage: "merged",
      ok: post.ok,
      reason: post.reason,
    });
    if (!post.ok) {
      const reason =
        post.reason === "setup"
          ? "setup"
          : (post.checks.find((c) => c.exit !== 0)?.id ?? post.reason ?? "checks");
      await git(dir, ["reset", "--hard", tip]);
      await deps.audit("landing.reset", {
        mission: input.missionId,
        task: input.taskId,
        stage: "merged",
        reason,
        resetTo: tip,
      });
      return { ok: false, reason, stage: "merged" };
    }

    // 4. Success: the merge commit is the landed SHA.
    const landedSha = await git(dir, ["rev-parse", "HEAD"]);
    await deps.audit("landing.merged", {
      mission: input.missionId,
      task: input.taskId,
      landedSha,
      verify: checks.checks.map((c) => c.id),
      auditTip: auditTip.hash,
    });
    return {
      ok: true,
      landedSha,
      verify: checks.checks.map((c) => `${c.id}=pass`),
      auditTip: auditTip.hash,
    };
  } finally {
    await removeLandingWorktree({ repoDir: paths.repoDir, dir });
  }
}
