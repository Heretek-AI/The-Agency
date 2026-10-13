import { describe, expect, test } from "bun:test";
import { DagError, findCycle, topoSort, validateDag } from "../src/graph.js";
import type { Task } from "../src/model.js";

function tasks(specs: Array<{ id: string; deps?: string[]; status?: Task["status"] }>): Task[] {
  return specs.map((s, i) => ({
    id: s.id,
    missionId: "m-1",
    repo: "demo",
    title: `task ${s.id}`,
    kind: "expert-run" as const,
    role: "build",
    deps: s.deps ?? [],
    trigger: "all_success" as const,
    input: { objective: `do ${s.id}`, acceptance: [`done ${s.id}`], paths: [] as string[] },
    ceilingUSD: null,
    policy: { strategy: "fail" } as const,
    status: s.status ?? ("pending" as const),
    attempts: i,
  }));
}

describe("validateDag", () => {
  test("accepts a valid diamond", () => {
    expect(() =>
      validateDag(
        tasks([
          { id: "a" },
          { id: "b", deps: ["a"] },
          { id: "c", deps: ["a"] },
          { id: "d", deps: ["b", "c"] },
        ]),
      ),
    ).not.toThrow();
  });

  test("rejects duplicate ids", () => {
    expect(() => validateDag(tasks([{ id: "a" }, { id: "a" }]))).toThrow(DagError);
  });

  test("rejects unknown deps", () => {
    expect(() => validateDag(tasks([{ id: "a", deps: ["ghost"] }]))).toThrow(DagError);
  });

  test("rejects self-deps", () => {
    expect(() => validateDag(tasks([{ id: "a", deps: ["a"] }]))).toThrow(DagError);
  });

  test("rejects cycles with the cycle path in the error", () => {
    expect(() =>
      validateDag(
        tasks([
          { id: "a", deps: ["c"] },
          { id: "b", deps: ["a"] },
          { id: "c", deps: ["b"] },
        ]),
      ),
    ).toThrow(/cycle/);
  });
});

describe("findCycle", () => {
  test("returns null for acyclic graphs", () => {
    expect(findCycle(tasks([{ id: "a" }, { id: "b", deps: ["a"] }]))).toBeNull();
  });

  test("returns the cycle path", () => {
    const cycle = findCycle(
      tasks([
        { id: "a", deps: ["b"] },
        { id: "b", deps: ["a"] },
      ]),
    );
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
    expect(new Set(cycle!).has("a") && new Set(cycle!).has("b")).toBe(true);
  });
});

describe("topoSort", () => {
  test("orders deps before dependents", () => {
    const order = topoSort(
      tasks([
        { id: "d", deps: ["b", "c"] },
        { id: "c", deps: ["a"] },
        { id: "b", deps: ["a"] },
        { id: "a" },
      ]),
    ).map((t) => t.id);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
  });

  test("is deterministic", () => {
    const specs = [{ id: "c" }, { id: "a" }, { id: "b" }];
    const once = topoSort(tasks(specs)).map((t) => t.id);
    const twice = topoSort(tasks(specs)).map((t) => t.id);
    expect(once).toEqual(twice);
    expect(once).toEqual(["a", "b", "c"]);
  });
});
