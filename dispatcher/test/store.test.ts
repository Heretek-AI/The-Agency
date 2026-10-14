/**
 * Store tests: transitions write a row plus an audit event, state
 * survives reopen, the crash-orphan case recovers, and anchors match.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { AuditLog } from "../src/audit.js";
import { MissionStatuses, TaskStatuses, type Mission, type Task } from "../src/model.js";
import { Store } from "../src/store.js";

function mission(id: string): Mission {
  return {
    id,
    repo: "demo",
    source: "api",
    playbook: "direct",
    objective: "test mission",
    priority: 1,
    status: MissionStatuses.planning,
    plan: {},
    tasks: [],
    decisions: [],
    integrationBranch: `fleet/integration/${id}`,
    baseSha: "0".repeat(40),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function task(id: string, missionId: string): Task {
  return {
    id,
    missionId,
    repo: "demo",
    title: `task ${id}`,
    kind: "expert-run",
    role: "scout",
    expert: "scout",
    deps: [],
    trigger: "all_success",
    input: { objective: "look around", acceptance: [], paths: [] },
    ceilingUSD: null,
    policy: { strategy: "fail" },
    status: TaskStatuses.pending,
    attempts: 0,
  };
}

function openStore(): Promise<{ store: Store; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "agency-store-"));
  return Store.open({ dbPath: join(dir, "dispatcher.db"), auditDir: join(dir, "audit") }).then(
    (store) => ({ store, dir }),
  );
}

describe("store", () => {
  test("a transition writes both a row and an audit event", async () => {
    const { store } = await openStore();
    try {
      const m = mission("m-1");
      const res = await store.transition("mission.created", { mission: "m-1" }, (tx) =>
        tx.putMission(m),
      );
      expect(res.seq).toBeGreaterThan(0);
      expect(store.getMission("m-1")?.objective).toBe("test mission");
      expect(store.anchorMatches(res.seq, res.hash)).toBe(true);
      const tip = store.auditTip();
      expect(tip.seq).toBe(res.seq);
      expect(tip.hash).toBe(res.hash);
    } finally {
      await store.close();
    }
  });

  test("reopening the store returns the same state", async () => {
    const { store, dir } = await openStore();
    await store.transition("mission.created", { mission: "m-2" }, (tx) => {
      tx.putMission(mission("m-2"));
      tx.putTask(task("t-1", "m-2"));
      tx.appendDecision("m-2", { taskId: "t-1", decision: "accept" });
    });
    await store.close();
    const reopened = await Store.open({
      dbPath: join(dir, "dispatcher.db"),
      auditDir: join(dir, "audit"),
    });
    try {
      expect(reopened.getMission("m-2")?.id).toBe("m-2");
      expect(reopened.getTask("t-1")?.title).toBe("task t-1");
      expect(reopened.listDecisions("m-2").length).toBe(1);
      expect((await reopened.verifyAudit()).ok).toBe(true);
    } finally {
      await reopened.close();
    }
  });

  test("the orphan case: a crash between audit append and commit recovers", async () => {
    const { store, dir } = await openStore();
    await store.transition("mission.created", { mission: "m-3" }, (tx) =>
      tx.putMission(mission("m-3")),
    );
    const anchored = store.auditTip().seq;
    await store.close();
    // Simulate the crashed process: its audit append survived, its commit
    // did not. A separate handle appends the orphaned entry.
    const journal = await AuditLog.open(join(dir, "audit"));
    try {
      await journal.append("task.started", { task: "t-orphan" }, "dispatcher");
    } finally {
      await journal.close();
    }
    const recovered = await Store.open({
      dbPath: join(dir, "dispatcher.db"),
      auditDir: join(dir, "audit"),
    });
    try {
      const events = recovered.listAudit().map((e) => e.event);
      expect(events).toContain("dispatcher.recovered");
      const entry = recovered.listAudit().find((e) => e.event === "dispatcher.recovered");
      // The orphan is named by sequence number; the orphaned entry itself
      // (task.started for t-orphan) is still in the log for inspection.
      expect(JSON.stringify(entry?.data)).toContain("3");
      const orphan = recovered.listAudit().find((e) => e.seq === 3);
      expect(orphan?.event).toBe("task.started");
      expect(JSON.stringify(orphan?.data)).toContain("t-orphan");
      // Continues from the database: the orphaned task was never committed.
      expect(recovered.getTask("t-orphan")).toBeUndefined();
      expect(recovered.getMission("m-3")?.id).toBe("m-3");
      expect((await recovered.verifyAudit()).ok).toBe(true);
      void anchored;
    } finally {
      await recovered.close();
    }
  });

  test("the audit anchor in the database matches the log", async () => {
    const { store } = await openStore();
    try {
      const t = task("t-9", "m-9");
      const r1 = await store.transition("mission.created", {}, (tx) =>
        tx.putMission(mission("m-9")),
      );
      const r2 = await store.transition("task.finished", {}, (tx) =>
        tx.putTask({ ...t, status: TaskStatuses.done }),
      );
      for (const [seq, hash] of [
        [r1.seq, r1.hash],
        [r2.seq, r2.hash],
      ] as const) {
        expect(store.anchorMatches(seq, hash)).toBe(true);
      }
      expect(store.getTask("t-9")?.status).toBe(TaskStatuses.done);
    } finally {
      await store.close();
    }
  });

  test("allocations record unconfirmed and confirm on success", async () => {
    const { store } = await openStore();
    try {
      await store.transition("task.started", {}, (tx) =>
        tx.recordAllocation("/work/demo/trees/t-1", "t-1", "fleet/t-1"),
      );
      expect(store.listUnconfirmedAllocations().length).toBe(1);
      await store.transition("worktree.confirmed", {}, (tx) =>
        tx.confirmAllocation("/work/demo/trees/t-1"),
      );
      expect(store.listUnconfirmedAllocations().length).toBe(0);
      await store.transition("worktree.released", {}, (tx) =>
        tx.releaseAllocation("/work/demo/trees/t-1"),
      );
      expect(store.listAllocationsForTask("t-1").length).toBe(0);
    } finally {
      await store.close();
    }
  });
});
