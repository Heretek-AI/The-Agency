/**
 * Expert-run runner tests (Stage 1c, Step 6), each against the fake
 * OpenCode server and a temporary repository. Includes the D-02 guard
 * (`expert-run creates a session and sends the envelope`) and the D-05
 * guard (`uncommitted changes are committed by the Dispatcher`).
 */
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { loadFleet, loadRegistry } from "../src/config.js";
import type { Mission, Task } from "../src/model.js";
import { OpenCodeClient } from "../src/opencode.js";
import {
  PERMISSION_REJECT_MESSAGE,
  finalMessageText,
  runExpertTask,
  type RunnerHooks,
} from "../src/runner.js";
import type { StreamEvent } from "../src/opencode.js";
import { buildEnvelope } from "../src/envelope.js";
import { startFakeOpenCode } from "./support/fake-opencode.js";

const ROOT = path.resolve(import.meta.dir, "..", "..");
const PASSWORD = "stage1c-runner-pw";

function sh(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir }).toString().trim();
}

function freshClone(): { repo: string; trees: string; artifacts: string } {
  const base = mkdtempSync(path.join(tmpdir(), "agency-runner-"));
  const repo = path.join(base, "repo");
  mkdirSync(repo, { recursive: true });
  sh(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(path.join(repo, "README.md"), "demo\n");
  writeFileSync(path.join(repo, "package.json"), '{"name":"demo"}\n');
  sh(repo, ["add", "."]);
  sh(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"]);
  return { repo, trees: path.join(base, "trees"), artifacts: path.join(base, "artifacts") };
}

function mission(id: string): Mission {
  return {
    id,
    repo: "demo",
    source: "api",
    playbook: "direct",
    objective: "o",
    priority: 1,
    status: "running",
    plan: {},
    tasks: [],
    decisions: [],
    integrationBranch: `fleet/integration/${id}`,
    baseSha: "0".repeat(40),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function docsTask(id: string, m: string): Task {
  return {
    id,
    missionId: m,
    repo: "demo",
    title: "document things",
    kind: "expert-run",
    role: "docs",
    expert: "docs",
    deps: [],
    trigger: "all_success",
    input: {
      objective: "update the readme",
      acceptance: ["readme updated"],
      paths: ["README*"],
      base: "main",
    },
    ceilingUSD: null,
    policy: { strategy: "fail" },
    status: "running",
    attempts: 1,
  };
}

const RESULT_BLOCK = `## RESULT
\`\`\`json
{
  "status": "done",
  "summary": "Updated the README with a tests section.",
  "changes": [{ "commit": "abc123", "files": ["README.md"] }],
  "verification": [{ "command": "cat README.md", "exit": 0, "observed": "section present" }],
  "assumptions": [],
  "risks": [],
  "handoffs": [],
  "artifacts": [],
  "question": null
}
\`\`\``;

function hooks(): RunnerHooks & {
  audits: { event: string; data: unknown }[];
  events: StreamEvent[];
  woken: string[];
} {
  const h = {
    audits: [] as { event: string; data: unknown }[],
    events: [] as StreamEvent[],
    woken: [] as string[],
    audit: async (event: string, data: unknown) => void h.audits.push({ event, data }),
    eventLog: async (_taskId: string, event: StreamEvent) => void h.events.push(event),
    registry: {
      records: [] as string[],
      record: function (r: { worktree: string }) {
        void h.registry.records.push(r.worktree);
      },
      confirm: () => {},
      releaseWorktree: () => {},
    },
    onWake: (taskId: string) => void h.woken.push(taskId),
  };
  return h;
}

describe("runner", () => {
  test("defect: newest-first transcripts resolve the final assistant message", () => {
    const block = '## RESULT\n```json\n{"status":"done"}\n```';
    // Real v2 shape, newest-first: the final assistant reply carries the
    // block while the older envelope (and a newer user follow-up) do not.
    const newestFirst = [
      { id: "u2", type: "user", text: "follow-up prompt", time: { created: 300 } },
      {
        id: "a2",
        type: "assistant",
        content: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: block },
        ],
        time: { created: 200 },
      },
      { id: "u1", type: "user", text: "# Task t: envelope", time: { created: 100 } },
    ];
    expect(finalMessageText(newestFirst)).toContain("## RESULT");
    // Fake shape, oldest-first: the newest entry is last and typeless.
    const oldestFirst = [
      { id: "u1", role: "user", content: "# Task t: envelope", at: "2026-01-01T00:00:00Z" },
      { id: "a1", role: "assistant", content: block, at: "2026-01-01T00:00:01Z" },
    ];
    expect(finalMessageText(oldestFirst)).toContain("## RESULT");
  });

  test("expert-run creates a session and sends the envelope", async () => {
    const layout = freshClone();
    const m = mission("m-env");
    const t = docsTask("docs-env", m.id);
    const fake = await startFakeOpenCode({
      password: PASSWORD,
      script: {
        rules: [
          {
            steps: [
              { kind: "write", path: "README.md", content: "demo\n\nTests\n" },
              { kind: "commit", message: "docs: tests section" },
              { kind: "message", role: "assistant", content: RESULT_BLOCK },
            ],
          },
        ],
      },
    });
    try {
      const client = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
      const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
      const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
      const h = hooks();
      const out = await runExpertTask(t, m, {
        client,
        fleet,
        ownership: reg.ownership,
        taskTimeoutSec: 60,
        followupTimeoutMs: 5000,
        permissionPollMs: 10,
        hooks: h,
        paths: { repoDir: layout.repo, treesDir: layout.trees, artifactsDir: layout.artifacts },
      });
      expect(out.outcome).toBe("done");
      const created = fake.requests.find((r) => r.method === "POST" && r.path === "/api/session");
      const body = created?.body as Record<string, unknown>;
      expect(body["agent"]).toBe("docs");
      expect((body["location"] as { directory: string }).directory).toBe(
        path.join(layout.trees, "docs-env"),
      );
      const permissions = body["permissions"] as {
        action: string;
        resource: string;
        effect: string;
      }[];
      expect(permissions).toContainEqual({ action: "edit", resource: "README*", effect: "allow" });
      expect(permissions).toContainEqual({ action: "edit", resource: ".github/*", effect: "deny" });
      expect(body["metadata"]).toMatchObject({ taskId: "docs-env", missionId: "m-env" });
      const prompted = fake.requests.find((r) => r.path.endsWith("/prompt"));
      const expected = buildEnvelope({
        taskId: "docs-env",
        title: "document things",
        missionId: "m-env",
        role: "docs",
        expert: "docs",
        objective: "update the readme",
        acceptance: ["readme updated"],
        worktree: path.join(layout.trees, "docs-env"),
        branch: "fleet/docs-env",
        grantedPaths: ["README*"],
      });
      expect((prompted?.body as { text: string }).text).toBe(expected);
      expect(out.headSha).toBe(sh(layout.repo, ["rev-parse", "fleet/docs-env"]));
    } finally {
      await fake.close();
    }
  }, 30_000);

  test("a scripted permission request is rejected with the exact message and recorded", async () => {
    const layout = freshClone();
    const m = mission("m-perm");
    const t = docsTask("docs-perm", m.id);
    const fake = await startFakeOpenCode({
      password: PASSWORD,
      script: {
        rules: [
          {
            steps: [
              { kind: "permission", tool: "shell", detail: "run tests" },
              { kind: "message", role: "assistant", content: RESULT_BLOCK },
            ],
          },
        ],
      },
    });
    try {
      const client = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
      const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
      const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
      const h = hooks();
      const out = await runExpertTask(t, m, {
        client,
        fleet,
        ownership: reg.ownership,
        taskTimeoutSec: 60,
        followupTimeoutMs: 5000,
        permissionPollMs: 10,
        hooks: h,
        paths: { repoDir: layout.repo, treesDir: layout.trees, artifactsDir: layout.artifacts },
      });
      expect(out.outcome).toBe("done");
      expect(out.permissionRejections?.length).toBe(1);
      const replied = fake.requests.find((r) => r.path.endsWith("/reply"));
      expect(replied?.body).toEqual({ decision: "reject", message: PERMISSION_REJECT_MESSAGE });
      expect(h.audits.some((a) => a.event === "permission.rejected")).toBe(true);
    } finally {
      await fake.close();
    }
  }, 30_000);

  test("a scripted hang is interrupted at the timeout and fails with timeout", async () => {
    const layout = freshClone();
    const m = mission("m-hang");
    const t = docsTask("docs-hang", m.id);
    const fake = await startFakeOpenCode({
      password: PASSWORD,
      script: { rules: [{ steps: [{ kind: "hang" }] }] },
    });
    try {
      const client = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
      const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
      const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
      const h = hooks();
      const out = await runExpertTask(t, m, {
        client,
        fleet,
        ownership: reg.ownership,
        taskTimeoutSec: 1,
        followupTimeoutMs: 1000,
        permissionPollMs: 10,
        hooks: h,
        paths: { repoDir: layout.repo, treesDir: layout.trees, artifactsDir: layout.artifacts },
      });
      expect(out.outcome).toBe("failed");
      expect((out as { reason: string }).reason).toBe("timeout");
      expect(fake.requests.some((r) => r.path.endsWith("/interrupt"))).toBe(true);
    } finally {
      await fake.close();
    }
  }, 30_000);

  test("uncommitted changes are committed by the Dispatcher", async () => {
    const layout = freshClone();
    const m = mission("m-dirty");
    const t = docsTask("docs-dirty", m.id);
    const fake = await startFakeOpenCode({
      password: PASSWORD,
      script: {
        rules: [
          {
            steps: [
              { kind: "write", path: "README.md", content: "demo\n\nUncommitted\n" },
              { kind: "message", role: "assistant", content: RESULT_BLOCK },
            ],
          },
        ],
      },
    });
    try {
      const client = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
      const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
      const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
      const h = hooks();
      const out = await runExpertTask(t, m, {
        client,
        fleet,
        ownership: reg.ownership,
        taskTimeoutSec: 60,
        followupTimeoutMs: 5000,
        permissionPollMs: 10,
        hooks: h,
        paths: { repoDir: layout.repo, treesDir: layout.trees, artifactsDir: layout.artifacts },
      });
      expect(out.outcome).toBe("done");
      expect(out.collectedUncommitted).toBe(true);
      const log = sh(path.join(layout.trees, "docs-dirty"), ["log", "--oneline", "-1"]);
      expect(log).toContain("dispatcher: collect uncommitted work for docs-dirty");
    } finally {
      await fake.close();
    }
  }, 30_000);

  test("no block, then a block after the follow-up: done", async () => {
    const layout = freshClone();
    const m = mission("m-follow");
    const t = docsTask("docs-follow", m.id);
    const fake = await startFakeOpenCode({
      password: PASSWORD,
      script: {
        rules: [
          {
            matchPrompt: "valid RESULT block",
            steps: [{ kind: "message", role: "assistant", content: RESULT_BLOCK }],
          },
        ],
        defaultSteps: [
          { kind: "message", role: "assistant", content: "I did the work but forgot the block." },
        ],
      },
    });
    try {
      const client = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
      const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
      const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
      const h = hooks();
      const out = await runExpertTask(t, m, {
        client,
        fleet,
        ownership: reg.ownership,
        taskTimeoutSec: 60,
        followupTimeoutMs: 5000,
        permissionPollMs: 10,
        hooks: h,
        paths: { repoDir: layout.repo, treesDir: layout.trees, artifactsDir: layout.artifacts },
      });
      expect(out.outcome).toBe("done");
      expect(fake.requests.filter((r) => r.path.endsWith("/prompt")).length).toBe(2);
    } finally {
      await fake.close();
    }
  }, 30_000);

  test("no block twice: no-block", async () => {
    const layout = freshClone();
    const m = mission("m-noblock");
    const t = docsTask("docs-noblock", m.id);
    const fake = await startFakeOpenCode({
      password: PASSWORD,
      script: {
        rules: [{ steps: [{ kind: "message", role: "assistant", content: "still no block" }] }],
      },
    });
    try {
      const client = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
      const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
      const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
      const h = hooks();
      const out = await runExpertTask(t, m, {
        client,
        fleet,
        ownership: reg.ownership,
        taskTimeoutSec: 60,
        followupTimeoutMs: 5000,
        permissionPollMs: 10,
        hooks: h,
        paths: { repoDir: layout.repo, treesDir: layout.trees, artifactsDir: layout.artifacts },
      });
      expect(out.outcome).toBe("failed");
      expect((out as { reason: string }).reason).toBe("no-block");
    } finally {
      await fake.close();
    }
  }, 30_000);

  test("a scripted write outside the grant: scope", async () => {
    const layout = freshClone();
    const m = mission("m-scope");
    const t = docsTask("docs-scope", m.id);
    const fake = await startFakeOpenCode({
      password: PASSWORD,
      script: {
        rules: [
          {
            steps: [
              { kind: "write", path: "src/evil.ts", content: "x\n" },
              { kind: "commit", message: "out of scope" },
              { kind: "message", role: "assistant", content: RESULT_BLOCK },
            ],
          },
        ],
      },
    });
    try {
      const client = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
      const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
      const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
      const h = hooks();
      const out = await runExpertTask(t, m, {
        client,
        fleet,
        ownership: reg.ownership,
        taskTimeoutSec: 60,
        followupTimeoutMs: 5000,
        permissionPollMs: 10,
        hooks: h,
        paths: { repoDir: layout.repo, treesDir: layout.trees, artifactsDir: layout.artifacts },
      });
      expect(out.outcome).toBe("failed");
      expect((out as { reason: string }).reason).toBe("scope");
    } finally {
      await fake.close();
    }
  }, 30_000);

  test("a write to a shared file: done with a flag", async () => {
    const layout = freshClone();
    const m = mission("m-shared");
    const t = docsTask("docs-shared", m.id);
    const fake = await startFakeOpenCode({
      password: PASSWORD,
      script: {
        rules: [
          {
            steps: [
              { kind: "write", path: "package.json", content: '{"name":"demo","v":2}\n' },
              { kind: "commit", message: "bump manifest" },
              { kind: "message", role: "assistant", content: RESULT_BLOCK },
            ],
          },
        ],
      },
    });
    try {
      const client = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
      const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
      const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
      const h = hooks();
      const out = await runExpertTask(t, m, {
        client,
        fleet,
        ownership: reg.ownership,
        taskTimeoutSec: 60,
        followupTimeoutMs: 5000,
        permissionPollMs: 10,
        hooks: h,
        paths: { repoDir: layout.repo, treesDir: layout.trees, artifactsDir: layout.artifacts },
      });
      expect(out.outcome).toBe("done");
      expect(out.sharedFlags).toEqual(["package.json"]);
    } finally {
      await fake.close();
    }
  }, 30_000);

  test("an ro expert whose script writes to the worktree: ro-violation", async () => {
    const layout = freshClone();
    const m = mission("m-ro");
    const t: Task = {
      ...docsTask("scout-ro", m.id),
      role: "recon",
      expert: "scout",
      input: { objective: "look around", acceptance: ["report"], paths: [], base: "main" },
    };
    const fake = await startFakeOpenCode({
      password: PASSWORD,
      script: {
        rules: [
          {
            steps: [
              { kind: "write", path: "sneaky.txt", content: "x\n" },
              { kind: "commit", message: "sneaky" },
              { kind: "message", role: "assistant", content: RESULT_BLOCK },
            ],
          },
        ],
      },
    });
    try {
      const client = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
      const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
      const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
      const h = hooks();
      const out = await runExpertTask(t, m, {
        client,
        fleet,
        ownership: reg.ownership,
        taskTimeoutSec: 60,
        followupTimeoutMs: 5000,
        permissionPollMs: 10,
        hooks: h,
        paths: { repoDir: layout.repo, treesDir: layout.trees, artifactsDir: layout.artifacts },
      });
      expect(out.outcome).toBe("failed");
      expect((out as { reason: string }).reason).toBe("ro-violation");
      const created = fake.requests.find((r) => r.method === "POST" && r.path === "/api/session");
      const permissions = (created?.body as Record<string, unknown>)["permissions"] as unknown[];
      expect(permissions.some((p) => (p as { action: string }).action === "edit")).toBe(false);
    } finally {
      await fake.close();
    }
  }, 30_000);

  test("the fake stopped: unreachable", async () => {
    const layout = freshClone();
    const m = mission("m-down");
    const t = docsTask("docs-down", m.id);
    const fake = await startFakeOpenCode({ password: PASSWORD });
    const url = fake.url;
    await fake.close();
    const client = new OpenCodeClient({ baseUrl: url, password: PASSWORD });
    const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
    const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
    const h = hooks();
    const out = await runExpertTask(t, m, {
      client,
      fleet,
      ownership: reg.ownership,
      taskTimeoutSec: 60,
      followupTimeoutMs: 5000,
      permissionPollMs: 10,
      hooks: h,
      paths: { repoDir: layout.repo, treesDir: layout.trees, artifactsDir: layout.artifacts },
    });
    expect(out.outcome).toBe("failed");
    expect((out as { reason: string }).reason).toBe("unreachable");
  }, 30_000);
});
