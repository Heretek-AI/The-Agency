/**
 * Landing tests with the local verifier fake and real git: the green
 * path (trailers, --no-ff, kept branch, untouched base), red on the task
 * branch, no-checks, conflict abort, merged-tree reset, the
 * green-apart/red-together case, and the per-mission lock.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { AuditLog } from "../src/audit.js";
import { baseEnv } from "../src/config.js";
import { land, MissionLocks, type LandingDeps } from "../src/landing.js";
import type { ChecksConfig } from "../src/registry-schema.js";
import { localVerifier } from "./support/local-verifier.fake.js";

function sh(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir }).toString().trim();
}

interface Layout {
  base: string;
  repo: string;
  landing: string;
  artifacts: string;
  auditDir: string;
}

function freshLayout(): Layout {
  const base = mkdtempSync(path.join(tmpdir(), "agency-landing-"));
  const repo = path.join(base, "repo");
  mkdirSync(repo, { recursive: true });
  sh(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(path.join(repo, "README.md"), "demo\n");
  sh(repo, ["add", "."]);
  sh(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"]);
  return {
    base,
    repo,
    landing: path.join(base, "landing"),
    artifacts: path.join(base, "artifacts"),
    auditDir: path.join(base, "audit"),
  };
}

function onBranch(
  repo: string,
  branch: string,
  files: Record<string, string>,
  message: string,
): void {
  let exists = true;
  try {
    sh(repo, ["rev-parse", "--verify", `refs/heads/${branch}`]);
  } catch {
    exists = false;
  }
  sh(repo, exists ? ["checkout", "-q", branch] : ["checkout", "-q", "-b", branch]);
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(repo, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  sh(repo, ["add", "-A"]);
  sh(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message]);
  sh(repo, ["checkout", "-q", "main"]);
}

const GREEN: ChecksConfig = {
  version: 1,
  setup: [],
  checks: [{ id: "always-green", run: "exit 0", timeoutSec: 30 }],
};

async function deps(
  layout: Layout,
  checks: ChecksConfig,
): Promise<{
  d: LandingDeps;
  audits: { event: string; data: unknown }[];
  close: () => Promise<void>;
}> {
  const audits: { event: string; data: unknown }[] = [];
  const journal = await AuditLog.open(layout.auditDir);
  const d: LandingDeps = {
    verifier: localVerifier({ artifactsDir: layout.artifacts, env: { ...baseEnv(), CI: "1" } }),
    checks,
    audit: async (event, data) => {
      audits.push({ event, data });
      await journal.append(event, data);
    },
    auditTip: () => ({ seq: journal.length, hash: journal.tipHash }),
    paths: { repoDir: layout.repo, landingRoot: layout.landing, artifactsDir: layout.artifacts },
  };
  return { d, audits, close: () => journal.close() };
}

describe("landing", () => {
  test("green path: landedSha, --no-ff, four trailers, kept branch, base untouched", async () => {
    const layout = freshLayout();
    const mainTip = sh(layout.repo, ["rev-parse", "main"]);
    const headBefore = sh(layout.repo, ["rev-parse", "HEAD"]);
    sh(layout.repo, ["branch", "fleet/integration/m-green", "main"]);
    onBranch(layout.repo, "fleet/docs-t1", { "README.md": "demo\n\nDocs\n" }, "docs work");
    const worktree = path.join(layout.base, "trees", "docs-t1");
    sh(layout.repo, ["worktree", "add", worktree, "fleet/docs-t1"]);
    const { d, audits, close } = await deps(layout, GREEN);
    try {
      const res = await land(
        {
          missionId: "m-green",
          taskId: "docs-t1",
          taskBranch: "fleet/docs-t1",
          integrationBranch: "fleet/integration/m-green",
          worktreeDir: worktree,
        },
        d,
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      // --no-ff: the merge commit has two parents.
      const parents = sh(layout.repo, ["rev-list", "--parents", "-n", "1", res.landedSha]).split(
        " ",
      );
      expect(parents.length).toBe(3);
      expect(sh(layout.repo, ["rev-parse", "fleet/integration/m-green"])).toBe(res.landedSha);
      const message = sh(layout.repo, ["log", "-1", "--format=%B", res.landedSha]);
      expect(message).toContain("Agency-Mission: m-green");
      expect(message).toContain("Agency-Task: docs-t1");
      expect(message).toContain("Agency-Verify: always-green=pass");
      const tipLine = message.split("\n").find((l) => l.startsWith("Agency-Audit-Tip: "));
      expect(tipLine).toBe(`Agency-Audit-Tip: ${res.auditTip}`);
      // The embedded tip is a real entry in the audit log.
      expect(audits.some((a) => (a.data as { auditTip?: string }).auditTip === res.auditTip)).toBe(
        true,
      );
      // The task branch is kept for the audit trail.
      expect(sh(layout.repo, ["rev-parse", "fleet/docs-t1"])).not.toBe("");
      // The base branch and the repository HEAD never moved.
      expect(sh(layout.repo, ["rev-parse", "main"])).toBe(mainTip);
      expect(sh(layout.repo, ["rev-parse", "HEAD"])).toBe(headBefore);
      // Landing worktrees are removed.
      expect(sh(layout.repo, ["worktree", "list", "--porcelain"])).not.toContain(layout.landing);
      expect(audits.map((a) => a.event)).toContain("landing.merged");
    } finally {
      await close();
    }
  }, 30_000);

  test("a red check on the task branch merges nothing", async () => {
    const layout = freshLayout();
    sh(layout.repo, ["branch", "fleet/integration/m-red", "main"]);
    const before = sh(layout.repo, ["rev-parse", "fleet/integration/m-red"]);
    onBranch(layout.repo, "fleet/docs-t2", { "README.md": "demo\n\nDocs\n" }, "docs work");
    const worktree = path.join(layout.base, "trees", "docs-t2");
    sh(layout.repo, ["worktree", "add", worktree, "fleet/docs-t2"]);
    const red: ChecksConfig = {
      version: 1,
      setup: [],
      checks: [{ id: "lint", run: "exit 1", timeoutSec: 30 }],
    };
    const { d, close } = await deps(layout, red);
    try {
      const res = await land(
        {
          missionId: "m-red",
          taskId: "docs-t2",
          taskBranch: "fleet/docs-t2",
          integrationBranch: "fleet/integration/m-red",
          worktreeDir: worktree,
        },
        d,
      );
      expect(res).toMatchObject({ ok: false, reason: "lint", stage: "task" });
      expect(sh(layout.repo, ["rev-parse", "fleet/integration/m-red"])).toBe(before);
    } finally {
      await close();
    }
  }, 30_000);

  test("an empty check list fails with no-checks", async () => {
    const layout = freshLayout();
    sh(layout.repo, ["branch", "fleet/integration/m-nc", "main"]);
    onBranch(layout.repo, "fleet/docs-t3", { "README.md": "x\n" }, "w");
    const worktree = path.join(layout.base, "trees", "docs-t3");
    sh(layout.repo, ["worktree", "add", worktree, "fleet/docs-t3"]);
    const empty: ChecksConfig = { version: 1, setup: [], checks: [] };
    const { d, close } = await deps(layout, empty);
    try {
      const res = await land(
        {
          missionId: "m-nc",
          taskId: "docs-t3",
          taskBranch: "fleet/docs-t3",
          integrationBranch: "fleet/integration/m-nc",
          worktreeDir: worktree,
        },
        // Bypass the typed minimum to prove the fail-closed default.
        { ...d, checks: { version: 1, setup: [], checks: [] } as ChecksConfig },
      );
      expect(res).toMatchObject({ ok: false, reason: "no-checks", stage: "task" });
      void empty;
    } finally {
      await close();
    }
  }, 30_000);

  test("a conflict aborts and names the files, integration unchanged", async () => {
    const layout = freshLayout();
    sh(layout.repo, ["branch", "fleet/integration/m-conf", "main"]);
    onBranch(
      layout.repo,
      "fleet/integration/m-conf",
      { "README.md": "demo\n\nIntegration side\n" },
      "integration change",
    );
    onBranch(layout.repo, "fleet/docs-t4", { "README.md": "demo\n\nTask side\n" }, "task change");
    const before = sh(layout.repo, ["rev-parse", "fleet/integration/m-conf"]);
    const worktree = path.join(layout.base, "trees", "docs-t4");
    sh(layout.repo, ["worktree", "add", worktree, "fleet/docs-t4"]);
    const { d, close } = await deps(layout, GREEN);
    try {
      const res = await land(
        {
          missionId: "m-conf",
          taskId: "docs-t4",
          taskBranch: "fleet/docs-t4",
          integrationBranch: "fleet/integration/m-conf",
          worktreeDir: worktree,
        },
        d,
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("conflict");
      expect(res.files).toContain("README.md");
      expect(sh(layout.repo, ["rev-parse", "fleet/integration/m-conf"])).toBe(before);
    } finally {
      await close();
    }
  }, 30_000);

  test("a red check on the merged tree resets to the recorded tip", async () => {
    const layout = freshLayout();
    sh(layout.repo, ["branch", "fleet/integration/m-mix", "main"]);
    // Integration gains a marker the check forbids; the task branch lacks it.
    onBranch(
      layout.repo,
      "fleet/integration/m-mix",
      { "marker.txt": "from integration\n" },
      "integration marker",
    );
    const tip = sh(layout.repo, ["rev-parse", "fleet/integration/m-mix"]);
    onBranch(layout.repo, "fleet/docs-t5", { "README.md": "demo\n\nDocs\n" }, "task work");
    const worktree = path.join(layout.base, "trees", "docs-t5");
    sh(layout.repo, ["worktree", "add", worktree, "fleet/docs-t5"]);
    const combo: ChecksConfig = {
      version: 1,
      setup: [],
      checks: [{ id: "no-marker", run: "test ! -f marker.txt", timeoutSec: 30 }],
    };
    const { d, audits, close } = await deps(layout, combo);
    try {
      const res = await land(
        {
          missionId: "m-mix",
          taskId: "docs-t5",
          taskBranch: "fleet/docs-t5",
          integrationBranch: "fleet/integration/m-mix",
          worktreeDir: worktree,
        },
        d,
      );
      expect(res).toMatchObject({ ok: false, reason: "no-marker", stage: "merged" });
      expect(sh(layout.repo, ["rev-parse", "fleet/integration/m-mix"])).toBe(tip);
      expect(audits.map((a) => a.event)).toContain("landing.reset");
    } finally {
      await close();
    }
  }, 30_000);

  test("two green-apart tasks that break together: the second landing resets", async () => {
    const layout = freshLayout();
    sh(layout.repo, ["branch", "fleet/integration/m-two", "main"]);
    const oneFile: ChecksConfig = {
      version: 1,
      setup: [],
      checks: [
        { id: "one-file", run: "test $(ls *.txt 2>/dev/null | wc -l) -eq 1", timeoutSec: 30 },
      ],
    };
    // Task A adds a.txt from main; task B adds b.txt from main.
    onBranch(layout.repo, "fleet/a-1", { "a.txt": "a\n" }, "add a");
    onBranch(layout.repo, "fleet/b-1", { "b.txt": "b\n" }, "add b");
    const wa = path.join(layout.base, "trees", "a-1");
    const wb = path.join(layout.base, "trees", "b-1");
    sh(layout.repo, ["worktree", "add", wa, "fleet/a-1"]);
    sh(layout.repo, ["worktree", "add", wb, "fleet/b-1"]);
    const { d, close } = await deps(layout, oneFile);
    try {
      const first = await land(
        {
          missionId: "m-two",
          taskId: "a-1",
          taskBranch: "fleet/a-1",
          integrationBranch: "fleet/integration/m-two",
          worktreeDir: wa,
        },
        d,
      );
      expect(first.ok).toBe(true);
      const tipAfterFirst = sh(layout.repo, ["rev-parse", "fleet/integration/m-two"]);
      const second = await land(
        {
          missionId: "m-two",
          taskId: "b-1",
          taskBranch: "fleet/b-1",
          integrationBranch: "fleet/integration/m-two",
          worktreeDir: wb,
        },
        d,
      );
      // b-1 was green alone (one *.txt) but the merged tree has two.
      expect(second).toMatchObject({ ok: false, stage: "merged" });
      expect(sh(layout.repo, ["rev-parse", "fleet/integration/m-two"])).toBe(tipAfterFirst);
    } finally {
      await close();
    }
  }, 30_000);

  test("per-mission landings never interleave", async () => {
    const locks = new MissionLocks();
    const order: string[] = [];
    const releaseFirst = await locks.acquire("m-x");
    const second = locks.acquire("m-x").then((release) => {
      order.push("second");
      release();
    });
    order.push("first");
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual(["first"]);
    releaseFirst();
    await second;
    expect(order).toEqual(["first", "second"]);
  });
});
