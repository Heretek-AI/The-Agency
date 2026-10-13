import type { Task } from "./model.js";

export class DagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DagError";
  }
}

export type TaskMap = Map<string, Task>;

export function toMap(tasks: Task[]): TaskMap {
  const map = new Map<string, Task>();
  for (const t of tasks) {
    if (map.has(t.id)) throw new DagError(`duplicate task id ${JSON.stringify(t.id)}`);
    map.set(t.id, t);
  }
  return map;
}

/** Validate: known deps, no self-deps, no cycles. Throws DagError. */
export function validateDag(tasks: Task[]): void {
  const map = toMap(tasks);
  const ids = [...map.keys()].sort();
  for (const id of ids) {
    const task = map.get(id)!;
    for (const dep of task.deps) {
      if (!map.has(dep))
        throw new DagError(
          `task ${JSON.stringify(id)} depends on unknown task ${JSON.stringify(dep)}`,
        );
      if (dep === id) throw new DagError(`task ${JSON.stringify(id)} depends on itself`);
    }
  }
  const cycle = findCycle(tasks);
  if (cycle) throw new DagError(`dependency cycle: ${cycle.join(" -> ")}`);
}

/**
 * Find a dependency cycle via iterative DFS (id-sorted for determinism).
 * Returns the cycle path, or null when acyclic.
 */
export function findCycle(tasks: Task[]): string[] | null {
  const map = toMap(tasks);
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  for (const id of map.keys()) color.set(id, WHITE);

  const visit = (start: string): string[] | null => {
    const work: Array<{ id: string; childIdx: number }> = [{ id: start, childIdx: 0 }];
    while (work.length > 0) {
      const top = work[work.length - 1]!;
      if (color.get(top.id) === WHITE) {
        color.set(top.id, GRAY);
        stack.push(top.id);
      }
      const task = map.get(top.id);
      const deps = (task?.deps ?? []).filter((d) => map.has(d) && d !== top.id).sort();
      if (top.childIdx < deps.length) {
        const dep = deps[top.childIdx]!;
        top.childIdx++;
        const c = color.get(dep);
        if (c === GRAY) {
          const from = stack.indexOf(dep);
          return [...stack.slice(from), dep];
        }
        if (c === WHITE) work.push({ id: dep, childIdx: 0 });
      } else {
        color.set(top.id, BLACK);
        stack.pop();
        work.pop();
      }
    }
    return null;
  };

  for (const id of [...map.keys()].sort()) {
    if (color.get(id) === WHITE) {
      const cycle = visit(id);
      if (cycle) return cycle;
    }
  }
  return null;
}

/**
 * Topological order (Kahn's algorithm, id-sorted queue for determinism).
 * Throws DagError on unknown deps or cycles. Scheduling (readiness,
 * cancellation, rework) is Stage 1c; this module only orders the graph.
 */
export function topoSort(tasks: Task[]): Task[] {
  validateDag(tasks);
  const map = toMap(tasks);
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of map.keys()) {
    indegree.set(id, 0);
    dependents.set(id, []);
  }
  for (const t of map.values()) {
    for (const dep of t.deps) {
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
      dependents.get(dep)!.push(t.id);
    }
  }
  const queue = [...map.keys()].filter((id) => indegree.get(id) === 0).sort();
  const order: Task[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(map.get(id)!);
    for (const next of dependents.get(id)!.sort()) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }
  if (order.length !== map.size) throw new DagError("dependency cycle detected");
  return order;
}
