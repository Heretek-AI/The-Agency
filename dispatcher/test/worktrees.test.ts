import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AllocationRecord } from "../src/worktrees.js";
import { allocate, inspect, release, salvage, taskBranch } from "../src/worktrees.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd })
    .toString()
    .trim();
}

function freshRepo(): { repo: string; trees: string; mainTip: string } {
  const repo = mkdtempSync(path.join(tmpdir(), "agency-wt-"));
  git(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(path.join(repo, "seed.txt"), "seed\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "seed"]);
  return { repo, trees: path.join(repo, "trees"), mainTip: git(repo, ["rev-parse", "main"]) };
}

function headOf(repo: string): string {
  return git(repo, ["rev-parse", "HEAD"]);
}

describe("worktrees", () => {
  test("a new task gets fleet/<id> from the base", async () => {
    const { repo, trees, mainTip } = freshRepo();
    const alloc = await allocate({
      repoDir: repo,
      treesDir: trees,
      taskId: "t-1",
      mode: "branch",
      base: "main",
    });
    expect(alloc.branch).toBe("fleet/t-1");
    expect(git(repo, ["rev-parse", "fleet/t-1"])).toBe(mainTip);
    expect(headOf(repo)).toBe(mainTip);
  });

  test("a detached allocation has no branch", async () => {
    const { repo, trees } = freshRepo();
    const alloc = await allocate({
      repoDir: repo,
      treesDir: trees,
      taskId: "t-9",
      mode: "detached",
      base: "main",
    });
    expect(alloc.branch).toBe("");
    const info = await inspect({ repoDir: repo, worktree: alloc.dir, base: "main" });
    expect(info.branch).toBeNull();
  });

  test("defect: retry keeps commits on the task branch", async () => {
    const { repo, trees, mainTip } = freshRepo();
    const records: AllocationRecord[] = [];
    const registry = {
      record: (r: AllocationRecord) => void records.push(r),
      confirm: () => {},
      releaseWorktree: () => {},
    };
    const first = await allocate({
      repoDir: repo,
      treesDir: trees,
      taskId: "t-2",
      mode: "branch",
      base: "main",
      registry,
    });
    writeFileSync(path.join(first.dir, "work.txt"), "work\n");
    git(first.dir, ["add", "."]);
    git(first.dir, ["commit", "-qm", "task work"]);
    const tip = git(repo, ["rev-parse", "fleet/t-2"]);
    expect(tip).not.toBe(mainTip);
    await release({ repoDir: repo, worktree: first.dir, registry });
    // The branch (and its commit) survives the release.
    expect(git(repo, ["rev-parse", "fleet/t-2"])).toBe(tip);
    const second = await allocate({
      repoDir: repo,
      treesDir: trees,
      taskId: "t-2",
      mode: "branch",
      base: "main",
      registry,
    });
    const info = await inspect({ repoDir: repo, worktree: second.dir, base: "main" });
    expect(info.branch).toBe("fleet/t-2");
    expect(info.head).toBe(tip);
    expect(info.ahead).toBe(1);
    expect(records.length).toBe(2);
    // The repository's own checkout never moved.
    expect(headOf(repo)).toBe(mainTip);
    expect(git(repo, ["rev-parse", "main"])).toBe(mainTip);
  });

  test("salvage creates the ref and removes the branch", async () => {
    const { repo, trees } = freshRepo();
    const alloc = await allocate({
      repoDir: repo,
      treesDir: trees,
      taskId: "t-3",
      mode: "branch",
      base: "main",
    });
    await expect(salvage({ repoDir: repo, taskId: "t-3" })).rejects.toThrow(/release first/);
    await release({ repoDir: repo, worktree: alloc.dir });
    const tip = await salvage({ repoDir: repo, taskId: "t-3" });
    expect(tip).toBe(git(repo, ["rev-parse", "refs/fleet-salvage/t-3"]));
    expect(taskBranch("t-3")).toBe("fleet/t-3");
    const branches = git(repo, ["branch", "--list", "fleet/t-3"]);
    expect(branches).toBe("");
  });

  test("inspect reports dirty state", async () => {
    const { repo, trees } = freshRepo();
    const alloc = await allocate({
      repoDir: repo,
      treesDir: trees,
      taskId: "t-4",
      mode: "branch",
      base: "main",
    });
    writeFileSync(path.join(alloc.dir, "dirty.txt"), "x\n");
    const info = await inspect({ repoDir: repo, worktree: alloc.dir, base: "main" });
    expect(info.dirty).toBe(true);
    expect(info.ahead).toBe(0);
  });

  test("an id with / or .. is rejected", async () => {
    const { repo, trees } = freshRepo();
    await expect(
      allocate({ repoDir: repo, treesDir: trees, taskId: "a/b", mode: "branch", base: "main" }),
    ).rejects.toThrow(/slug/);
    await expect(
      allocate({ repoDir: repo, treesDir: trees, taskId: "..", mode: "branch", base: "main" }),
    ).rejects.toThrow(/slug/);
    await expect(salvage({ repoDir: repo, taskId: "a/b" })).rejects.toThrow(/slug/);
  });
});
