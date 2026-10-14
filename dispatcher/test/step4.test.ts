/**
 * Step 4 tests: allocation register crash safety, policy outcomes, plan
 * expansion and validation. Uses real temporary git repositories.
 */
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { loadFleet } from "../src/config.js";
import { git } from "../src/git.js";
import { TaskStatuses, type Mission } from "../src/model.js";
import { expandPlan, PlanError, type DirectorTask } from "../src/plan.js";
import { changedFiles, checkPolicy } from "../src/policy.js";
import type { OwnershipConfig } from "../src/registry-schema.js";
import { allocate, cleanupUnconfirmed, type AllocationRecord } from "../src/worktrees.js";

const ROOT = path.resolve(import.meta.dir, "..", "..");

function sh(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir }).toString().trim();
}

function freshRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agency-step4-"));
  sh(dir, ["init", "-q", "-b", "main"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "README.md"), "demo\n");
  writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  sh(dir, ["add", "."]);
  sh(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"]);
  return dir;
}

const GRANT = {
  writes: ["src/*"],
  shared: ["package.json"],
  protected: [".github/*"],
};

describe("allocation register", () => {
  test("a crash between register and confirm leaves a tracked, cleanable worktree", async () => {
    const repo = freshRepo();
    const trees = path.join(repo, "trees");
    const events: string[] = [];
    const released: string[] = [];
    const registry = {
      record: (r: AllocationRecord) => void events.push(`record:${r.worktree}`),
      confirm: (_w: string) => {
        throw new Error("simulated crash before confirm");
      },
      releaseWorktree: (w: string) => void released.push(w),
    };
    await expect(
      allocate({
        repoDir: repo,
        treesDir: trees,
        taskId: "t-1",
        mode: "branch",
        base: "main",
        registry,
      }),
    ).rejects.toThrow(/simulated crash/);
    // Register ran before the git work; confirm never did.
    expect(events).toEqual([`record:${path.join(trees, "t-1")}`]);
    // The worktree exists (git work finished) but is tracked, not orphaned.
    expect(sh(repo, ["worktree", "list", "--porcelain"])).toContain(path.join(trees, "t-1"));
    await cleanupUnconfirmed({ repoDir: repo, worktrees: [path.join(trees, "t-1")], registry });
    expect(sh(repo, ["worktree", "list", "--porcelain"])).not.toContain(path.join(trees, "t-1"));
    expect(released).toEqual([path.join(trees, "t-1")]);
  });
});

describe("policy", () => {
  test("writes inside the grant are allowed", async () => {
    const repo = freshRepo();
    writeFileSync(path.join(repo, "src", "b.ts"), "export const b = 2;\n");
    sh(repo, ["add", "."]);
    sh(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "add b"]);
    const changed = await changedFiles(repo, "HEAD~1");
    expect(changed.map((c) => c.path)).toEqual(["src/b.ts"]);
    expect(checkPolicy(changed, GRANT, "scoped")).toEqual({ ok: true, sharedTouched: [] });
  });

  test("a write outside the grant is a scope failure", async () => {
    const changed = [{ path: "elsewhere/x.ts", status: "A", symlink: false }];
    const res = checkPolicy(changed, GRANT, "scoped");
    expect(res).toEqual({ ok: false, reason: "scope", files: ["elsewhere/x.ts"] });
  });

  test("a write to a shared file is allowed and flagged", async () => {
    const changed = [{ path: "package.json", status: "M", symlink: false }];
    expect(checkPolicy(changed, GRANT, "scoped")).toEqual({
      ok: true,
      sharedTouched: ["package.json"],
    });
  });

  test("a write to a protected path is a scope failure", async () => {
    const changed = [{ path: ".github/workflows/ci.yml", status: "A", symlink: false }];
    expect(checkPolicy(changed, GRANT, "scoped")).toEqual({
      ok: false,
      reason: "scope",
      files: [".github/workflows/ci.yml"],
    });
  });

  test("a rename out of scope fails with both sides checked", async () => {
    const repo = freshRepo();
    sh(repo, ["mv", "src/a.ts", "elsewhere-a.ts"]);
    sh(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "move"]);
    const changed = await changedFiles(repo, "HEAD~1");
    expect(changed.map((c) => c.path).sort()).toEqual(["elsewhere-a.ts", "src/a.ts"]);
    const res = checkPolicy(changed, GRANT, "scoped");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("scope");
  });

  test("a new or changed symlink is a scope failure", async () => {
    const repo = freshRepo();
    symlinkSync("a.ts", path.join(repo, "src", "link.ts"));
    sh(repo, ["add", "."]);
    sh(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "link"]);
    const changed = await changedFiles(repo, "HEAD~1");
    expect(changed.find((c) => c.path === "src/link.ts")?.symlink).toBe(true);
    const res = checkPolicy(changed, GRANT, "scoped");
    expect(res.ok).toBe(false);
  });

  test("an ro expert that changes anything fails with ro-violation", async () => {
    const changed = [{ path: "notes.txt", status: "M", symlink: false }];
    expect(checkPolicy(changed, GRANT, "ro")).toEqual({
      ok: false,
      reason: "ro-violation",
      files: ["notes.txt"],
    });
    expect(checkPolicy([], GRANT, "ro")).toEqual({ ok: true, sharedTouched: [] });
  });
});

const missionOf = (id: string): Mission => ({
  id,
  repo: "demo",
  source: "api",
  playbook: "direct",
  objective: "o",
  priority: 1,
  status: "planning",
  plan: {},
  tasks: [],
  decisions: [],
  integrationBranch: `fleet/integration/${id}`,
  baseSha: "0".repeat(40),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("plan", () => {
  test("expansion appends verify and land behind every scoped expert-run", async () => {
    const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
    const ownership = (await import("../src/config.js")).loadRegistry;
    const reg = await ownership(path.join(ROOT, "registry.example", "demo"));
    const docs: DirectorTask = {
      id: "docs-1",
      title: "document",
      role: "docs",
      expert: "docs",
      input: { objective: "write docs", acceptance: ["readme updated"], paths: ["README.md"] },
    };
    const { tasks, needsApproval } = expandPlan(
      missionOf("m-plan"),
      fleet,
      reg.ownership as OwnershipConfig,
      [docs],
      3,
    );
    expect(needsApproval).toBe(false);
    expect(tasks.map((t) => [t.id, t.kind, t.status])).toEqual([
      ["docs-1", "expert-run", TaskStatuses.pending],
      ["docs-1-verify", "verify", TaskStatuses.waitingHuman],
      ["docs-1-land", "land", TaskStatuses.waitingHuman],
    ]);
    expect(tasks[1]!.deps).toEqual(["docs-1"]);
    expect(tasks[2]!.deps).toEqual(["docs-1-verify"]);
  });

  test("an ro expert-run gets no verify or land tasks", async () => {
    const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
    const { loadRegistry } = await import("../src/config.js");
    const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
    const scout: DirectorTask = {
      id: "scout-1",
      title: "recon",
      role: "recon",
      expert: "scout",
      input: { objective: "look", acceptance: ["report"], paths: [] },
    };
    const { tasks } = expandPlan(missionOf("m-ro"), fleet, reg.ownership, [scout], 3);
    expect(tasks.map((t) => t.id)).toEqual(["scout-1"]);
  });

  test("each validation failure throws", async () => {
    const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
    const { loadRegistry } = await import("../src/config.js");
    const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
    const base: DirectorTask = {
      id: "x-1",
      title: "x",
      role: "docs",
      expert: "docs",
      input: { objective: "o", acceptance: [], paths: ["README.md"] },
    };
    const mission = missionOf("m-val");
    expect(() =>
      expandPlan(mission, fleet, reg.ownership, [{ ...base, expert: "ghost" }], 3),
    ).toThrow(PlanError);
    expect(() =>
      expandPlan(
        mission,
        fleet,
        reg.ownership,
        [{ ...base, input: { ...base.input, paths: ["src/evil.ts"] } }],
        3,
      ),
    ).toThrow(/outside.*grant/);
    expect(() =>
      expandPlan(
        mission,
        fleet,
        reg.ownership,
        [
          { ...base, id: "a" },
          { ...base, id: "b", deps: ["b"] },
        ],
        3,
      ),
    ).toThrow();
    // More expert-runs than the threshold parks the mission for approval.
    const many: DirectorTask[] = ["p-1", "p-2", "p-3", "p-4"].map((id) => ({ ...base, id }));
    expect(expandPlan(mission, fleet, reg.ownership, many, 3).needsApproval).toBe(true);
  });

  test("git.ts runs git: rev-parse round trip", async () => {
    const repo = freshRepo();
    expect(await git(repo, ["rev-parse", "--show-toplevel"])).toBe(repo);
  });
});
