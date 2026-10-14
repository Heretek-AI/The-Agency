/**
 * Plan expansion (Stage 1c, Step 4). `expandPlan` turns the Director's
 * tasks into the full graph: behind every `scoped` expert-run it appends
 * a `verify` task and a `land` task. Stage 2a replaces this one function
 * with the playbook engine, so nothing else may know how the graph was
 * built: callers use only `expandPlan`.
 *
 * Validation: every expert exists and is enabled; every path falls inside
 * that expert's grant (its ownership `writes`, or `shared`); the graph is
 * acyclic. A plan with more expert-run tasks than `planApprovalAbove`
 * parks the mission as waiting-for-approval (`needsApproval`).
 */
import type { FleetConfig } from "./fleet-schema.js";
import { validateDag } from "./graph.js";
import { TaskStatuses, type Mission, type Task, type TaskPolicy } from "./model.js";
import type { OwnershipConfig } from "./registry-schema.js";
import { checkSlug } from "./worktrees.js";
import { match as wildcardMatch } from "./wildcard.js";

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

export interface DirectorTaskInput {
  objective: string;
  context?: string;
  constraints?: string;
  acceptance: string[];
  paths: string[];
  base?: string;
}

export interface DirectorTask {
  id: string;
  title: string;
  role: string;
  expert: string;
  deps?: string[];
  trigger?: "all_success" | "one_success";
  input: DirectorTaskInput;
  policy?: TaskPolicy;
}

export interface ExpandPlanResult {
  tasks: Task[];
  /** True when the mission must wait for a human before running. */
  needsApproval: boolean;
}

const VERIFY_SUFFIX = "-verify";
const LAND_SUFFIX = "-land";

function baseTask(
  mission: Mission,
  id: string,
  kind: Task["kind"],
  role: string,
  deps: string[],
): Task {
  return {
    id,
    missionId: mission.id,
    repo: mission.repo,
    title: id,
    kind,
    role,
    deps,
    trigger: "all_success",
    input: { objective: "", acceptance: [], paths: [] },
    ceilingUSD: null,
    policy: { strategy: "fail" },
    status: TaskStatuses.pending,
    attempts: 0,
  };
}

export function expandPlan(
  mission: Mission,
  fleet: FleetConfig,
  ownership: OwnershipConfig,
  directorTasks: DirectorTask[],
  planApprovalAbove: number,
): ExpandPlanResult {
  const tasks: Task[] = [];
  const seen = new Set<string>();

  for (const dt of directorTasks) {
    checkSlug("task id", dt.id);
    if (seen.has(dt.id)) throw new PlanError(`duplicate task id ${JSON.stringify(dt.id)}`);
    seen.add(dt.id);
    const expert = fleet.experts[dt.expert];
    if (expert === undefined) throw new PlanError(`unknown expert ${JSON.stringify(dt.expert)}`);
    if (!expert.enabled) throw new PlanError(`expert ${JSON.stringify(dt.expert)} is disabled`);
    const grant = ownership.experts[dt.expert];
    if (grant === undefined && expert.access === "scoped")
      throw new PlanError(`scoped expert ${JSON.stringify(dt.expert)} has no ownership entry`);
    for (const p of dt.input.paths) {
      const inside =
        grant !== undefined &&
        (grant.writes.some((w) => wildcardMatch(p, w)) ||
          ownership.shared.some((s) => wildcardMatch(p, s)));
      if (!inside)
        throw new PlanError(
          `task ${JSON.stringify(dt.id)} path ${JSON.stringify(p)} is outside ${JSON.stringify(dt.expert)}'s grant`,
        );
    }
    if (grant === undefined && dt.input.paths.length > 0)
      throw new PlanError(
        `task ${JSON.stringify(dt.id)} grants paths to ${JSON.stringify(dt.expert)} with no ownership entry`,
      );
    if (expert.access === "ro" && dt.input.paths.length > 0)
      throw new PlanError(
        `task ${JSON.stringify(dt.id)} grants paths to read-only expert ${JSON.stringify(dt.expert)}`,
      );

    const run: Task = {
      ...baseTask(mission, dt.id, "expert-run", dt.role, dt.deps ?? []),
      title: dt.title,
      expert: dt.expert,
      trigger: dt.trigger ?? "all_success",
      input: {
        objective: dt.input.objective,
        context: dt.input.context,
        constraints: dt.input.constraints,
        acceptance: dt.input.acceptance,
        paths: dt.input.paths,
        base: dt.input.base,
      },
      policy: dt.policy ?? { strategy: "fail" },
    };
    tasks.push(run);

    if (expert.access === "scoped") {
      const verifyId = `${dt.id}${VERIFY_SUFFIX}`;
      const landId = `${dt.id}${LAND_SUFFIX}`;
      checkSlug("task id", verifyId);
      checkSlug("task id", landId);
      // Verify and land wait for a human accept on the expert-run task
      // (released by `decide`); the scheduler never starts them meanwhile.
      const verify: Task = {
        ...baseTask(mission, verifyId, "verify", "verify", [dt.id]),
        title: `verify ${dt.id}`,
        status: TaskStatuses.waitingHuman,
      };
      const land: Task = {
        ...baseTask(mission, landId, "land", "land", [verifyId]),
        title: `land ${dt.id}`,
        status: TaskStatuses.waitingHuman,
      };
      tasks.push(verify, land);
    }
  }

  validateDag(tasks);
  const expertRuns = directorTasks.length;
  return {
    tasks,
    needsApproval: expertRuns > planApprovalAbove,
  };
}
