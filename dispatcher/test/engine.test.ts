/**
 * Engine tests (Stage 1c, Step 8): provider limits (transient retry with
 * `Continue.`, usage-limit pause and resume), startup recovery (lost,
 * idle-collect, busy re-attach, stale allocations), the D-01 guard
 * (`mission is not done without landedSha`), decide flows, and an
 * end-to-end mission through tick() to a landed commit with a full audit
 * chain. Everything runs against the fake OpenCode server, temporary git
 * repositories, and the local verifier fake.
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { loadFleet } from "../src/config.js";
import { Engine, type EngineDeps, type RepoRegistry } from "../src/engine.js";
import { MissionStatuses, TaskStatuses } from "../src/model.js";
import { OpenCodeClient } from "../src/opencode.js";
import type { DirectorTask } from "../src/plan.js";
import { Store } from "../src/store.js";
import { allocate } from "../src/worktrees.js";
import { localVerifier } from "./support/local-verifier.fake.js";
import { startFakeOpenCode, type FakeOpenCode, type FakeScript } from "./support/fake-opencode.js";

const ROOT = path.resolve(import.meta.dir, "..", "..");
const PASSWORD = "stage1c-engine-pw";

function sh(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir }).toString().trim();
}

const RESULT_BLOCK = (summary: string) => `## RESULT
\`\`\`json
{
  "status": "done",
  "summary": ${JSON.stringify(summary)},
  "changes": [],
  "verification": [],
  "assumptions": [],
  "risks": [],
  "handoffs": [],
  "artifacts": [],
  "question": null
}
\`\`\``;

interface Harness {
  engine: Engine;
  deps: EngineDeps;
  store: Store;
  workspaceRoot: string;
  artifactsRoot: string;
  fakes: FakeOpenCode[];
  now: { at: number };
  close: () => Promise<void>;
}

async function makeHarness(opts?: {
  checks?: { id: string; run: string; timeoutSec: number }[];
  taskTimeoutSec?: number;
  probeIntervalMs?: number;
}): Promise<Harness> {
  const base = mkdtempSync(path.join(tmpdir(), "agency-engine-"));
  const workspaceRoot = path.join(base, "workspace");
  const artifactsRoot = path.join(base, "artifacts");
  const repo = path.join(workspaceRoot, "demo", "repo");
  mkdirSync(repo, { recursive: true });
  sh(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(path.join(repo, "README.md"), "demo\n");
  sh(repo, ["add", "."]);
  sh(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"]);
  const store = await Store.open({
    dbPath: path.join(base, "state", "dispatcher.db"),
    auditDir: path.join(base, "state", "audit"),
  });
  const fleet = await loadFleet(path.join(ROOT, "fleet.yaml"));
  const example = await loadFleet(path.join(ROOT, "fleet.yaml")).catch(() => null);
  void example;
  const { loadRegistry } = await import("../src/config.js");
  const reg = await loadRegistry(path.join(ROOT, "registry.example", "demo"));
  const registry: RepoRegistry = {
    repo: reg.repo,
    ownership: reg.ownership,
    checks: {
      version: 1,
      setup: [],
      checks: opts?.checks ?? [{ id: "ok", run: "exit 0", timeoutSec: 30 }],
    },
  };
  const now = { at: Date.now() };
  const deps: EngineDeps = {
    store,
    fleet,
    registries: new Map([["demo", registry]]),
    workspaceRoot,
    artifactsRoot,
    clients: new Map(),
    verifier: localVerifier({ artifactsDir: artifactsRoot }),
    clock: { now: () => now.at, sleep: async () => {} },
    taskTimeoutSec: opts?.taskTimeoutSec ?? 60,
    probeIntervalMs: opts?.probeIntervalMs ?? 60_000,
    triageProbeMs: 1000,
  };
  const fakes: FakeOpenCode[] = [];
  return {
    engine: new Engine(deps),
    deps,
    store,
    workspaceRoot,
    artifactsRoot,
    fakes,
    now,
    close: async () => {
      for (const f of fakes) await f.close();
      await store.close();
    },
  };
}

async function attachFake(h: Harness, script: FakeScript): Promise<FakeOpenCode> {
  const fake = await startFakeOpenCode({ password: PASSWORD, script });
  h.fakes.push(fake);
  const client = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
  h.deps.clients.set("scout", client);
  h.deps.clients.set("docs", client);
  return fake;
}

const scoutTask = (id: string): DirectorTask => ({
  id,
  title: "recon",
  role: "recon",
  expert: "scout",
  input: { objective: "look around", acceptance: ["report"], paths: [] },
});

const docsTask = (id: string): DirectorTask => ({
  id,
  title: "document",
  role: "docs",
  expert: "docs",
  input: { objective: "update the readme", acceptance: ["readme updated"], paths: ["README.md"] },
});

describe("engine limits", () => {
  test("a scripted transient error is retried with Continue.", async () => {
    const h = await makeHarness();
    try {
      const fake = await attachFake(h, {
        rules: [
          {
            matchPrompt: "Continue.",
            steps: [{ kind: "message", role: "assistant", content: RESULT_BLOCK("recovered") }],
          },
        ],
        defaultSteps: [{ kind: "error", message: "boom", status: 500 }],
      });
      const m = await h.engine.createMission({
        id: "m-transient",
        repo: "demo",
        source: "api",
        playbook: "direct",
        objective: "o",
      });
      await h.engine.submitPlan(m.id, [scoutTask("scout-t1")]);
      await h.engine.tick();
      const view = h.engine.getMission(m.id);
      expect(view.tasks[0]?.status).toBe(TaskStatuses.done);
      const prompts = fake.requests.filter((r) => r.path.endsWith("/prompt"));
      expect(prompts.length).toBe(2);
      expect((prompts[1]?.body as { text: string }).text).toBe("Continue.");
    } finally {
      await h.close();
    }
  }, 30_000);

  test("a scripted usage limit pauses all running missions with pausedUntil, then resumes", async () => {
    const h = await makeHarness({ probeIntervalMs: 60_000 });
    try {
      // The envelope hits the limit; the resume prompt succeeds. Same
      // server, same session: quota lifts and work continues.
      const fake = await attachFake(h, {
        rules: [
          {
            matchPrompt: "Continue.",
            steps: [{ kind: "message", role: "assistant", content: RESULT_BLOCK("after quota") }],
          },
        ],
        defaultSteps: [{ kind: "error", message: "quota exhausted", status: 429 }],
      });
      const m = await h.engine.createMission({
        id: "m-quota",
        repo: "demo",
        source: "api",
        playbook: "direct",
        objective: "o",
      });
      await h.engine.submitPlan(m.id, [scoutTask("scout-q1")]);
      await h.engine.tick();
      let view = h.engine.getMission(m.id);
      expect(view.mission.status).toBe(MissionStatuses.paused);
      expect(view.mission.pausedUntil).toBe(new Date(h.now.at + 60_000).toISOString());
      // The task is left as it is, with its session recorded.
      expect(view.tasks[0]?.status).toBe(TaskStatuses.running);
      expect(view.tasks[0]?.sessionId).toBeDefined();
      h.now.at += 61_000;
      await h.engine.tick();
      view = h.engine.getMission(m.id);
      expect(view.mission.status).toBe(MissionStatuses.done);
      expect(view.tasks[0]?.status).toBe(TaskStatuses.done);
      const prompts = fake.requests.filter((r) => r.path.endsWith("/prompt"));
      expect(prompts.some((p) => (p.body as { text: string }).text === "Continue.")).toBe(true);
    } finally {
      await h.close();
    }
  }, 30_000);
});

describe("engine recovery", () => {
  test("a task whose session is gone fails with lost", async () => {
    const h = await makeHarness();
    try {
      await attachFake(h, { rules: [] });
      const m = await h.engine.createMission({
        id: "m-lost",
        repo: "demo",
        source: "api",
        playbook: "direct",
        objective: "o",
      });
      await h.engine.submitPlan(m.id, [scoutTask("scout-lost")]);
      await h.store.transition("task.started", {}, (tx) =>
        tx.putTask({
          ...h.store.getTask("scout-lost")!,
          status: TaskStatuses.running,
          sessionId: "ses-gone",
          attempts: 1,
        }),
      );
      const report = await h.engine.startup();
      expect(report.lost).toEqual(["scout-lost"]);
      expect(h.store.getTask("scout-lost")?.status).toBe(TaskStatuses.failed);
      expect(h.store.getTask("scout-lost")?.reason).toBe("lost");
    } finally {
      await h.close();
    }
  }, 30_000);

  test("an idle session is collected, a busy one re-attached", async () => {
    const h = await makeHarness({ taskTimeoutSec: 1 });
    const fake = await startFakeOpenCode({
      password: PASSWORD,
      script: {
        rules: [
          {
            matchPrompt: "idle-work",
            steps: [
              { kind: "message", role: "assistant", content: RESULT_BLOCK("idle collected") },
            ],
          },
          { matchPrompt: "busy-work", steps: [{ kind: "hang" }] },
        ],
      },
    });
    h.fakes.push(fake);
    const client = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
    h.deps.clients.set("scout", client);
    h.deps.clients.set("docs", client);
    try {
      const m = await h.engine.createMission({
        id: "m-rec",
        repo: "demo",
        source: "api",
        playbook: "direct",
        objective: "o",
      });
      await h.engine.submitPlan(m.id, [scoutTask("scout-idle"), scoutTask("scout-busy")]);
      const paths = {
        repoDir: path.join(h.workspaceRoot, "demo", "repo"),
        treesDir: path.join(h.workspaceRoot, "demo", "trees"),
      };
      const idleAlloc = await allocate({
        repoDir: paths.repoDir,
        treesDir: paths.treesDir,
        taskId: "scout-idle",
        mode: "detached",
        base: "main",
      });
      const busyAlloc = await allocate({
        repoDir: paths.repoDir,
        treesDir: paths.treesDir,
        taskId: "scout-busy",
        mode: "detached",
        base: "main",
      });
      const idleSession = await client.createSession({
        title: "idle",
        location: { directory: idleAlloc.dir },
      });
      await client.prompt(idleSession.id, "idle-work");
      await client.waitIdle(idleSession.id, 10_000);
      const busySession = await client.createSession({
        title: "busy",
        location: { directory: busyAlloc.dir },
      });
      await client.prompt(busySession.id, "busy-work");
      await new Promise((r) => setTimeout(r, 200));
      await h.store.transition("task.started", {}, (tx) => {
        tx.putTask({
          ...h.store.getTask("scout-idle")!,
          status: TaskStatuses.running,
          sessionId: idleSession.id,
          worktree: idleAlloc.dir,
          branch: "",
          attempts: 1,
        });
        tx.putTask({
          ...h.store.getTask("scout-busy")!,
          status: TaskStatuses.running,
          sessionId: busySession.id,
          worktree: busyAlloc.dir,
          branch: "",
          attempts: 1,
        });
      });
      const report = await h.engine.startup();
      expect(report.collected.sort()).toEqual(["scout-busy", "scout-idle"]);
      expect(h.store.getTask("scout-idle")?.status).toBe(TaskStatuses.done);
      // The busy session was re-attached, waited on, and timed out.
      expect(h.store.getTask("scout-busy")?.status).toBe(TaskStatuses.failed);
      expect(h.store.getTask("scout-busy")?.reason).toBe("timeout");
    } finally {
      await h.close();
    }
  }, 60_000);

  test("stale allocations are cleaned on startup", async () => {
    const h = await makeHarness();
    try {
      await attachFake(h, { rules: [] });
      const ghost = path.join(h.workspaceRoot, "demo", "trees", "ghost");
      mkdirSync(ghost, { recursive: true });
      await h.store.transition("worktree.allocated", {}, (tx) =>
        tx.recordAllocation(ghost, "ghost", "fleet/ghost"),
      );
      const report = await h.engine.startup();
      expect(report.recovered).toEqual([ghost]);
      expect(h.store.listUnconfirmedAllocations()).toEqual([]);
    } finally {
      await h.close();
    }
  }, 30_000);
});

describe("engine done-gate", () => {
  test("mission is not done without landedSha", async () => {
    const h = await makeHarness();
    try {
      await attachFake(h, { rules: [] });
      const m = await h.engine.createMission({
        id: "m-d01",
        repo: "demo",
        source: "api",
        playbook: "direct",
        objective: "o",
      });
      await h.engine.submitPlan(m.id, [docsTask("docs-d01")]);
      // Force the land task to done with no landedSha: the gate must hold.
      await h.store.transition("task.finished", {}, (tx) => {
        tx.putTask({ ...h.store.getTask("docs-d01")!, status: TaskStatuses.done });
        tx.putTask({ ...h.store.getTask("docs-d01-verify")!, status: TaskStatuses.done });
        tx.putTask({ ...h.store.getTask("docs-d01-land")!, status: TaskStatuses.done });
      });
      await expect(h.engine.closeMission(m.id, "done")).rejects.toThrow(/landedSha/);
    } finally {
      await h.close();
    }
  }, 30_000);
});

describe("engine decide", () => {
  test("accept releases verify and land; rework re-runs the same session and branch", async () => {
    const h = await makeHarness();
    try {
      const fake = await attachFake(h, {
        rules: [
          { steps: [{ kind: "message", role: "assistant", content: RESULT_BLOCK("first") }] },
        ],
      });
      const m = await h.engine.createMission({
        id: "m-decide",
        repo: "demo",
        source: "api",
        playbook: "direct",
        objective: "o",
      });
      await h.engine.submitPlan(m.id, [docsTask("docs-r1")]);
      await h.engine.tick();
      expect(h.store.getTask("docs-r1")?.status).toBe(TaskStatuses.done);
      const firstSession = h.store.getTask("docs-r1")?.sessionId;
      await h.engine.decide("docs-r1", "accept", "looks good");
      expect(h.store.getTask("docs-r1-verify")?.status).toBe(TaskStatuses.pending);
      expect(h.store.getTask("docs-r1-land")?.status).toBe(TaskStatuses.pending);
      expect(h.store.listDecisions(m.id).length).toBe(1);
      // Rework the finished run with notes: same session and branch.
      await h.engine.decide("docs-r1", "rework", "add more detail");
      const reworked = h.store.getTask("docs-r1")!;
      expect(reworked.status).toBe(TaskStatuses.pending);
      expect(reworked.attempts).toBe(2);
      await h.engine.tick();
      const prompts = fake.requests.filter((r) => r.path.endsWith("/prompt"));
      expect(prompts.length).toBe(2);
      expect((prompts[1]?.body as { text: string }).text).toContain("add more detail");
      const rerun = h.store.getTask("docs-r1")!;
      expect(rerun.sessionId).toBe(firstSession);
      expect(rerun.status).toBe(TaskStatuses.done);
    } finally {
      await h.close();
    }
  }, 60_000);

  test("abandon salvages the branch", async () => {
    const h = await makeHarness();
    try {
      await attachFake(h, {
        rules: [
          { steps: [{ kind: "message", role: "assistant", content: RESULT_BLOCK("abandoned") }] },
        ],
      });
      const m = await h.engine.createMission({
        id: "m-abandon",
        repo: "demo",
        source: "api",
        playbook: "direct",
        objective: "o",
      });
      await h.engine.submitPlan(m.id, [docsTask("docs-a1")]);
      await h.engine.tick();
      await h.engine.decide("docs-a1", "abandon", "wrong direction");
      const repo = path.join(h.workspaceRoot, "demo", "repo");
      expect(sh(repo, ["rev-parse", "refs/fleet-salvage/docs-a1"])).not.toBe("");
      expect(() => sh(repo, ["rev-parse", "refs/heads/fleet/docs-a1"])).toThrow();
      expect(h.store.getTask("docs-a1")?.status).toBe(TaskStatuses.cancelled);
    } finally {
      await h.close();
    }
  }, 30_000);
});

describe("engine end-to-end", () => {
  test("scout reports and docs lands through tick(), with a full audit chain", async () => {
    const h = await makeHarness();
    try {
      const fake = await attachFake(h, {
        rules: [
          {
            matchPrompt: "Task scout-e2e",
            steps: [
              {
                kind: "write",
                path: `${h.artifactsRoot}/scout-e2e/report.md`,
                content: "languages: typescript; tests: bun test\n",
              },
              { kind: "message", role: "assistant", content: RESULT_BLOCK("recon complete") },
            ],
          },
          {
            matchPrompt: "Task docs-e2e",
            steps: [
              { kind: "write", path: "README.md", content: "demo\n\nRunning the tests\n" },
              { kind: "commit", message: "docs: running the tests" },
              { kind: "message", role: "assistant", content: RESULT_BLOCK("documented") },
            ],
          },
        ],
      });
      void fake;
      const m = await h.engine.createMission({
        id: "m-e2e",
        repo: "demo",
        source: "api",
        playbook: "direct",
        objective: "o",
      });
      await h.engine.submitPlan(m.id, [scoutTask("scout-e2e"), docsTask("docs-e2e")]);
      await h.engine.tick();
      expect(h.store.getTask("scout-e2e")?.status).toBe(TaskStatuses.done);
      expect(h.store.getTask("docs-e2e")?.status).toBe(TaskStatuses.done);
      // Parked for a human until accepted.
      expect(h.engine.getMission(m.id).mission.status).toBe(MissionStatuses.waitingHuman);
      await h.engine.decide("docs-e2e", "accept", "ship it");
      await h.engine.tick();
      expect(h.store.getTask("docs-e2e-verify")?.status).toBe(TaskStatuses.done);
      await h.engine.tick();
      const landTask = h.store.getTask("docs-e2e-land")!;
      expect(landTask.status).toBe(TaskStatuses.done);
      const landedSha: string = landTask.landedSha ?? "";
      expect(landedSha).not.toBe("");
      await h.engine.tick();
      expect(h.engine.getMission(m.id).mission.status).toBe(MissionStatuses.done);
      // The scout's session wrote the report; the test only reads it.
      expect(readFileSync(path.join(h.artifactsRoot, "scout-e2e", "report.md"), "utf8")).toContain(
        "bun test",
      );
      // The landed commit is on the integration branch with new README text.
      const repo = path.join(h.workspaceRoot, "demo", "repo");
      expect(sh(repo, ["rev-parse", "fleet/integration/m-e2e"])).toBe(landedSha);
      expect(sh(repo, ["show", `${landedSha}:README.md`])).toContain("Running the tests");
      // The audit log holds the full chain.
      const events = h.store.listAudit().map((e) => e.event);
      for (const expected of [
        "mission.created",
        "plan.submitted",
        "task.started",
        "task.finished",
        "decision",
        "verify.result",
        "landing.merged",
        "mission.closed",
      ]) {
        expect(events).toContain(expected);
      }
      expect((await h.store.verifyAudit()).ok).toBe(true);
    } finally {
      await h.close();
    }
  }, 60_000);
});
