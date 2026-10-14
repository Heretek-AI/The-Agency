/**
 * Scheduler tests (Stage 1c, Step 3). One scenario per rule, one per
 * status in the model, the D-12 guards (`every status is reachable`,
 * `dependents of a failed task are cancelled`), the D-11 guard
 * (`retry re-queues the same task`), the overlap rule, and determinism.
 *
 * Status literals stay out of this file (lint keeps them in model.ts);
 * statuses are reached through TaskStatuses and nextStatus.
 */
import { describe, expect, test } from "bun:test";
import { TaskStatuses, type Task } from "../src/model.js";
import { nextStatus, schedule } from "../src/scheduler.js";

let seq = 0;

function task(over: Partial<Task> & { id: string }): Task {
  seq += 1;
  return {
    missionId: "m",
    repo: "demo",
    title: over.id,
    kind: "expert-run",
    role: "build",
    expert: "backend",
    deps: [],
    trigger: "all_success",
    input: { objective: "o", acceptance: [], paths: [`src/${over.id}/*`] },
    ceilingUSD: null,
    policy: { strategy: "fail" },
    status: TaskStatuses.pending,
    attempts: 0,
    ...over,
  };
}

describe("scheduler", () => {
  test("readiness under all_success needs every dependency done", () => {
    const a = task({ id: "a", status: TaskStatuses.done });
    const b = task({ id: "b", status: TaskStatuses.pending });
    const c = task({ id: "c", deps: ["a", "b"] });
    const res = schedule([a, b, c], [], { fleet: 4 });
    expect(res.start).toEqual(["b"]);
    expect(res.cancel).toEqual([]);
  });

  test("readiness under one_success needs any dependency done", () => {
    const a = task({ id: "a", status: TaskStatuses.failed });
    const b = task({ id: "b", status: TaskStatuses.done });
    const c = task({ id: "c", deps: ["a", "b"], trigger: "one_success" });
    const res = schedule([a, b, c], [], { fleet: 4 });
    expect(res.start).toContain("c");
  });

  test("dependents of a failed task are cancelled", () => {
    const a = task({ id: "a", status: TaskStatuses.failed });
    const b = task({ id: "b", deps: ["a"] });
    const c = task({ id: "c", deps: ["b"] });
    const res = schedule([a, b, c], [], { fleet: 4 });
    expect(res.cancel).toEqual(["b", "c"]);
    expect(res.start).toEqual([]);
  });

  test("under one_success a task is cancelled only when all dependencies failed", () => {
    const a = task({ id: "a", status: TaskStatuses.failed });
    const b = task({ id: "b", status: TaskStatuses.pending });
    const c = task({ id: "c", deps: ["a", "b"], trigger: "one_success" });
    expect(schedule([a, b, c], [], { fleet: 4 }).cancel).toEqual([]);
    const bFailed = { ...b, status: TaskStatuses.failed };
    expect(schedule([a, bFailed, c], [], { fleet: 4 }).cancel).toEqual(["c"]);
  });

  test("starts are ordered by id and bounded by the fleet cap", () => {
    const tasks = ["d", "b", "a", "c"].map((id) => task({ id }));
    const res = schedule(tasks, [], { fleet: 2 });
    expect(res.start).toEqual(["a", "b"]);
    expect(res.ready).toEqual(["c", "d"]);
  });

  test("the per-expert cap bounds each expert", () => {
    const tasks = ["a", "b", "c"].map((id) => task({ id, expert: "backend" }));
    const res = schedule(tasks, [], { fleet: 8, perExpert: () => 1 });
    expect(res.start).toEqual(["a"]);
    expect(res.ready).toEqual(["b", "c"]);
  });

  test("overlapping expert-run paths never run together", () => {
    const running = task({
      id: "r",
      status: TaskStatuses.running,
      input: { objective: "o", acceptance: [], paths: ["src/*"] },
    });
    const queued = task({
      id: "q",
      input: { objective: "o", acceptance: [], paths: ["src/deep/*"] },
    });
    const other = task({ id: "s", input: { objective: "o", acceptance: [], paths: ["tests/*"] } });
    const res = schedule([running, queued, other], ["r"], { fleet: 4 });
    expect(res.start).toEqual(["s"]);
    expect(res.ready).toEqual(["q"]);
  });

  test("non-overlapping paths may run together", () => {
    const a = task({ id: "a", input: { objective: "o", acceptance: [], paths: ["src/*"] } });
    const b = task({ id: "b", input: { objective: "o", acceptance: [], paths: ["tests/*"] } });
    expect(schedule([a, b], [], { fleet: 4 }).start).toEqual(["a", "b"]);
  });

  test("a human-parked task never starts and never forces cancellation", () => {
    const parked = task({ id: "h", status: TaskStatuses.waitingHuman });
    const child = task({ id: "k", deps: ["h"] });
    const res = schedule([parked, child], [], { fleet: 4 });
    expect(res.start).toEqual([]);
    expect(res.cancel).toEqual([]);
    expect(res.ready).toEqual([]);
  });

  test("retry re-queues the same task", () => {
    const t = task({ id: "r", policy: { strategy: "retry", maxAttempts: 2 }, attempts: 1 });
    expect(nextStatus(t, "failure")).toBe(TaskStatuses.pending);
    const exhausted = { ...t, attempts: 3 };
    expect(nextStatus(exhausted, "failure")).toBe(TaskStatuses.failed);
  });

  test("fail is terminal and replan parks for a human", () => {
    expect(nextStatus(task({ id: "f" }), "failure")).toBe(TaskStatuses.failed);
    expect(nextStatus(task({ id: "p", policy: { strategy: "replan" } }), "failure")).toBe(
      TaskStatuses.waitingHuman,
    );
    expect(nextStatus(task({ id: "d" }), "success")).toBe(TaskStatuses.done);
  });

  test("every status is reachable", () => {
    // pending: the initial status.
    expect(task({ id: "pending-case" }).status).toBe(TaskStatuses.pending);
    // ready: met but cap-blocked.
    const blocked = schedule([task({ id: "x" }), task({ id: "y" })], [], { fleet: 1 });
    expect(blocked.ready).toContain("y");
    // running: started.
    expect(schedule([task({ id: "z" })], [], { fleet: 1 }).start).toContain("z");
    // done: success outcome.
    expect(nextStatus(task({ id: "ok" }), "success")).toBe(TaskStatuses.done);
    // failed: terminal failure outcome.
    expect(nextStatus(task({ id: "no" }), "failure")).toBe(TaskStatuses.failed);
    // cancelled: never runnable.
    const doomed = schedule(
      [task({ id: "bad", status: TaskStatuses.failed }), task({ id: "child", deps: ["bad"] })],
      [],
      { fleet: 1 },
    );
    expect(doomed.cancel).toContain("child");
    // the parked status: replan outcome.
    expect(nextStatus(task({ id: "park", policy: { strategy: "replan" } }), "failure")).toBe(
      TaskStatuses.waitingHuman,
    );
  });

  test("the same input always yields the same output", () => {
    const tasks = [
      task({ id: "b", deps: ["a"] }),
      task({ id: "a", status: TaskStatuses.done }),
      task({ id: "c", deps: ["a"], trigger: "one_success" }),
    ];
    const first = schedule(tasks, [], { fleet: 2 });
    const second = schedule([...tasks].reverse(), [], { fleet: 2 });
    expect(second).toEqual(first);
  });
});
