/**
 * Dispatcher engine (Stage 1c, Step 8). Ties the modules together behind
 * one programmatic API that Stage 1d will expose: `createMission`,
 * `submitPlan`, `approve`, `reject`, `cancel`, `getMission`,
 * `taskResult`, `taskDiff`, `decide`, `wait`, `closeMission`, `gc`.
 * `tick()` advances the loop once for tests; `start()` runs it on the
 * injected clock.
 *
 * `decide(taskId, decision, notes)`:
 * - `accept` releases the task's verify and land steps (waitingHuman to
 *   pending) and appends to the decision log;
 * - `rework` sends the notes into the same session, increments `attempts`,
 *   and re-runs the task on its existing branch;
 * - `abandon` salvages the branch and cancels the task.
 */
import type { FleetConfig } from "./fleet-schema.js";
import { git } from "./git.js";
import { land, MissionLocks } from "./landing.js";
import { backoffMs, classifyProviderFailure } from "./limits.js";
import {
  MissionStatuses,
  TaskStatuses,
  type Mission,
  type MissionStatus,
  type Task,
  type TaskStatus,
} from "./model.js";
import { OpenCodeClient } from "./opencode.js";
import { expandPlan, type DirectorTask } from "./plan.js";
import { recoverWorktrees, triageTask } from "./recovery.js";
import {
  realClock,
  runExpertTask,
  type Clock,
  type ExpertRunResult,
  type RunnerHooks,
} from "./runner.js";
import { nextStatus, schedule } from "./scheduler.js";
import { Store, storeRegistry } from "./store.js";
import type { ChecksConfig, OwnershipConfig, RepoConfig } from "./registry-schema.js";
import type { Verifier } from "./verify.js";
import { release, salvage } from "./worktrees.js";

export interface RepoRegistry {
  repo: RepoConfig;
  ownership: OwnershipConfig;
  checks: ChecksConfig;
}

export interface EngineDeps {
  store: Store;
  fleet: FleetConfig;
  registries: Map<string, RepoRegistry>;
  workspaceRoot: string;
  artifactsRoot: string;
  clients: Map<string, OpenCodeClient>;
  verifier: Verifier;
  clock?: Clock;
  taskTimeoutSec?: number;
  /** Usage-limit probe interval in ms. Defaults to 60 s. */
  probeIntervalMs?: number;
  /** Idle-probe bound in ms for startup triage. Defaults to 2 s. */
  triageProbeMs?: number;
  locks?: MissionLocks;
}

export interface MissionView {
  mission: Mission;
  tasks: Task[];
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

const TERMINAL_MISSION: ReadonlySet<MissionStatus> = new Set([
  MissionStatuses.done,
  MissionStatuses.failed,
  MissionStatuses.cancelled,
]);

const TERMINAL_TASK: ReadonlySet<TaskStatus> = new Set([
  TaskStatuses.done,
  TaskStatuses.failed,
  TaskStatuses.cancelled,
]);

let missionSeq = 0;

export class Engine {
  private readonly providerStreak = new Map<string, number>();

  constructor(private readonly deps: EngineDeps) {}

  private get store(): Store {
    return this.deps.store;
  }

  private clock(): Clock {
    return this.deps.clock ?? realClock;
  }

  private nowIso(): string {
    return new Date(this.clock().now()).toISOString();
  }

  private locks(): MissionLocks {
    if (this.deps.locks === undefined) {
      this.deps.locks = new MissionLocks();
    }
    return this.deps.locks;
  }

  private registryFor(repoId: string): RepoRegistry {
    const reg = this.deps.registries.get(repoId);
    if (reg === undefined) throw new EngineError(`unknown repository ${JSON.stringify(repoId)}`);
    return reg;
  }

  private repoPaths(repoId: string): { repoDir: string; treesDir: string; landingRoot: string } {
    const root = `${this.deps.workspaceRoot}/${repoId}`;
    return { repoDir: `${root}/repo`, treesDir: `${root}/trees`, landingRoot: `${root}/landing` };
  }

  private clientFor(expert: string): OpenCodeClient {
    const client = this.deps.clients.get(expert);
    if (client === undefined) throw new EngineError(`no OpenCode client for expert ${expert}`);
    return client;
  }

  private hooks(): RunnerHooks {
    const store = this.store;
    return {
      audit: (event, data) => store.transition(event, data, () => {}).then(() => {}),
      eventLog: (taskId, event) =>
        store
          .transition("task.event", { task: taskId, event }, (tx) =>
            tx.appendTaskEvent(taskId, event),
          )
          .then(() => {}),
      registry: storeRegistry(store),
      onWake: () => {},
    };
  }

  // -- Mission lifecycle -------------------------------------------------

  async createMission(input: {
    id?: string;
    repo: string;
    source: Mission["source"];
    sourceRef?: string;
    playbook: string;
    objective: string;
    priority?: number;
    directorSessionId?: string;
  }): Promise<Mission> {
    const reg = this.registryFor(input.repo);
    const id = input.id ?? `m-${this.clock().now().toString(36)}-${(missionSeq += 1)}`;
    if (this.store.getMission(id) !== undefined)
      throw new EngineError(`mission ${id} already exists`);
    const paths = this.repoPaths(input.repo);
    const baseSha = await git(paths.repoDir, ["rev-parse", reg.repo.defaultBranch]);
    const now = this.nowIso();
    const mission: Mission = {
      id,
      repo: input.repo,
      source: input.source,
      sourceRef: input.sourceRef,
      playbook: input.playbook,
      objective: input.objective,
      priority: input.priority ?? 1,
      status: MissionStatuses.planning,
      plan: { director: [], lastVerifyOk: false, approved: false },
      tasks: [],
      decisions: [],
      directorSessionId: input.directorSessionId,
      integrationBranch: `fleet/integration/${id}`,
      baseSha,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.transition("mission.created", { mission: id, repo: input.repo }, (tx) =>
      tx.putMission(mission),
    );
    const { mkdir } = await import("node:fs/promises");
    await mkdir(paths.treesDir, { recursive: true });
    await mkdir(paths.landingRoot, { recursive: true });
    await git(paths.repoDir, ["branch", mission.integrationBranch, baseSha]);
    return mission;
  }

  async submitPlan(missionId: string, directorTasks: DirectorTask[]): Promise<Task[]> {
    const mission = this.requireMission(missionId);
    if (mission.status !== MissionStatuses.planning)
      throw new EngineError(`mission ${missionId} is not planning`);
    const reg = this.registryFor(mission.repo);
    const { tasks, needsApproval } = expandPlan(
      mission,
      this.deps.fleet,
      reg.ownership,
      directorTasks,
      reg.repo.planApprovalAbove,
    );
    const updated: Mission = {
      ...mission,
      plan: { director: directorTasks, lastVerifyOk: false, approved: !needsApproval },
      updatedAt: this.nowIso(),
      status: needsApproval ? MissionStatuses.waitingHuman : MissionStatuses.running,
    };
    await this.store.transition(
      "plan.submitted",
      { mission: missionId, tasks: tasks.length, needsApproval },
      (tx) => {
        tx.putMission(updated);
        for (const task of tasks) tx.putTask(task);
      },
    );
    return tasks;
  }

  async approve(missionId: string): Promise<void> {
    const mission = this.requireMission(missionId);
    if (mission.status !== MissionStatuses.waitingHuman)
      throw new EngineError(`mission ${missionId} is not waiting for approval`);
    const plan = mission.plan as { director?: DirectorTask[]; lastVerifyOk?: boolean };
    await this.store.transition("plan.approved", { mission: missionId }, (tx) =>
      tx.putMission({
        ...mission,
        status: MissionStatuses.running,
        plan: {
          director: plan.director ?? [],
          lastVerifyOk: plan.lastVerifyOk ?? false,
          approved: true,
        },
        updatedAt: this.nowIso(),
      }),
    );
  }

  async reject(missionId: string, reason: string): Promise<void> {
    const mission = this.requireMission(missionId);
    if (
      mission.status !== MissionStatuses.planning &&
      mission.status !== MissionStatuses.waitingHuman
    )
      throw new EngineError(`mission ${missionId} cannot be rejected from ${mission.status}`);
    await this.store.transition("plan.rejected", { mission: missionId, reason }, (tx) =>
      tx.putMission({ ...mission, status: MissionStatuses.cancelled, updatedAt: this.nowIso() }),
    );
  }

  async cancel(missionId: string): Promise<void> {
    const mission = this.requireMission(missionId);
    if (TERMINAL_MISSION.has(mission.status)) return;
    const tasks = this.store.tasksForMission(missionId);
    await this.store.transition(
      "mission.closed",
      { mission: missionId, outcome: "cancelled" },
      (tx) => {
        tx.putMission({ ...mission, status: MissionStatuses.cancelled, updatedAt: this.nowIso() });
        for (const task of tasks) {
          if (!TERMINAL_TASK.has(task.status))
            tx.putTask({ ...task, status: TaskStatuses.cancelled });
        }
      },
    );
  }

  getMission(missionId: string): MissionView {
    return {
      mission: this.requireMission(missionId),
      tasks: this.store.tasksForMission(missionId),
    };
  }

  taskResult(taskId: string): unknown {
    return this.requireTask(taskId).result;
  }

  async taskDiff(taskId: string): Promise<string> {
    const task = this.requireTask(taskId);
    const mission = this.requireMission(task.missionId);
    if (task.worktree === undefined || task.worktree === "")
      throw new EngineError(`task ${taskId} has no worktree`);
    const base = task.input.base ?? mission.integrationBranch;
    return git(task.worktree, ["diff", `${base}...HEAD`]);
  }

  async decide(
    taskId: string,
    decision: "accept" | "rework" | "abandon",
    notes?: string,
  ): Promise<void> {
    const task = this.requireTask(taskId);
    const mission = this.requireMission(task.missionId);
    if (TERMINAL_MISSION.has(mission.status) && decision !== "abandon")
      throw new EngineError(`mission ${mission.id} is ${mission.status}; ${decision} is closed`);
    const plan = mission.plan as { approved?: boolean };
    if ((decision === "accept" || decision === "rework") && plan.approved !== true)
      throw new EngineError(`mission ${mission.id} has no approved plan; approve it first`);
    await this.store.transition(
      "decision",
      { mission: mission.id, task: taskId, decision, notes },
      (tx) => tx.appendDecision(mission.id, { taskId, decision, notes }),
    );
    // A decision restarts a mission parked for a human (plan approvals go
    // through approve(), never here).
    if (
      (decision === "accept" || decision === "rework") &&
      mission.status === MissionStatuses.waitingHuman
    ) {
      await this.store.transition(
        "mission.updated",
        { mission: mission.id, to: "running", reason: `decision-${decision}` },
        (tx) =>
          tx.putMission({ ...mission, status: MissionStatuses.running, updatedAt: this.nowIso() }),
      );
    }
    if (decision === "accept") {
      const released = this.releaseSubtree(mission.id, taskId);
      if (released.length === 0) throw new EngineError(`nothing to accept behind task ${taskId}`);
      for (const id of released) {
        const t = this.requireTask(id);
        await this.store.transition("task.ready", { task: id, releasedBy: taskId }, (tx) =>
          tx.putTask({ ...t, status: TaskStatuses.pending }),
        );
      }
    } else if (decision === "rework") {
      if (task.kind !== "expert-run")
        throw new EngineError(`only expert-run tasks take rework (task ${taskId} is ${task.kind})`);
      if (task.sessionId === undefined || task.worktree === undefined || task.branch === undefined)
        throw new EngineError(`task ${taskId} never ran; nothing to rework`);
      if (notes === undefined || notes.trim() === "")
        throw new EngineError(`rework of task ${taskId} needs notes`);
      await this.store.transition("task.ready", { task: taskId, decision: "rework" }, (tx) =>
        tx.putTask({
          ...task,
          status: TaskStatuses.pending,
          attempts: task.attempts + 1,
          result: {
            ...(typeof task.result === "object" && task.result !== null ? task.result : {}),
            reworkNotes: notes,
          },
        }),
      );
    } else {
      if (task.kind !== "expert-run")
        throw new EngineError(
          `only expert-run tasks take abandon (task ${taskId} is ${task.kind})`,
        );
      const paths = this.repoPaths(mission.repo);
      if (task.worktree !== undefined && task.worktree !== "") {
        await release({
          repoDir: paths.repoDir,
          worktree: task.worktree,
          registry: storeRegistry(this.store),
        }).catch(() => {});
      }
      if (task.branch !== undefined && task.branch !== "") {
        await salvage({ repoDir: paths.repoDir, taskId: task.id });
      }
      await this.store.transition("task.finished", { task: taskId, decision: "abandon" }, (tx) =>
        tx.putTask({ ...task, status: TaskStatuses.cancelled }),
      );
    }
  }

  /** Waiting-human verify/land steps reachable from `taskId` through deps. */
  private releaseSubtree(missionId: string, taskId: string): string[] {
    const tasks = this.store.tasksForMission(missionId);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const downstream = new Map<string, string[]>();
    for (const t of tasks) {
      for (const dep of t.deps) {
        const list = downstream.get(dep) ?? [];
        list.push(t.id);
        downstream.set(dep, list);
      }
    }
    const out: string[] = [];
    const queue = [...(downstream.get(taskId) ?? [])];
    const seen = new Set(queue);
    if (byId.get(taskId)?.status === TaskStatuses.waitingHuman) {
      out.push(taskId);
    }
    while (queue.length > 0) {
      const id = queue.shift()!;
      const t = byId.get(id);
      if (t === undefined) continue;
      if (t.status === TaskStatuses.waitingHuman && (t.kind === "verify" || t.kind === "land")) {
        out.push(id);
      }
      for (const next of downstream.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return [...new Set(out)].sort();
  }

  async wait(missionId: string, timeoutMs: number): Promise<MissionStatus> {
    const clock = this.clock();
    const deadline = clock.now() + timeoutMs;
    for (;;) {
      const mission = this.requireMission(missionId);
      if (TERMINAL_MISSION.has(mission.status)) return mission.status;
      if (clock.now() >= deadline) return mission.status;
      await clock.sleep(25);
    }
  }

  async closeMission(missionId: string, outcome: "done" | "failed" | "cancelled"): Promise<void> {
    const mission = this.requireMission(missionId);
    const tasks = this.store.tasksForMission(missionId);
    if (outcome === "done") this.assertDoneable(mission, tasks);
    await this.store.transition("mission.closed", { mission: missionId, outcome }, (tx) =>
      tx.putMission({ ...mission, status: outcome, updatedAt: this.nowIso() }),
    );
  }

  private assertDoneable(mission: Mission, tasks: Task[]): void {
    const open = tasks.filter((t) => !TERMINAL_TASK.has(t.status)).map((t) => t.id);
    if (open.length > 0)
      throw new EngineError(`mission ${mission.id} is not done: open tasks ${open.join(", ")}`);
    const failed = tasks.filter((t) => t.status === TaskStatuses.failed).map((t) => t.id);
    if (failed.length > 0)
      throw new EngineError(`mission ${mission.id} is not done: failed tasks ${failed.join(", ")}`);
    // Done requires evidence (shared context 4.5): a code change is done
    // only with a landed commit SHA.
    const unlanded = tasks
      .filter(
        (t) =>
          t.kind === "land" &&
          t.status === TaskStatuses.done &&
          (t.landedSha === undefined || t.landedSha === ""),
      )
      .map((t) => t.id);
    if (unlanded.length > 0)
      throw new EngineError(
        `mission ${mission.id} is not done without landedSha: ${unlanded.join(", ")}`,
      );
    if (tasks.some((t) => t.kind === "land")) {
      const plan = mission.plan as { lastVerifyOk?: unknown };
      if (plan.lastVerifyOk !== true)
        throw new EngineError(
          `mission ${mission.id} is not done: no green verify on the integration branch`,
        );
    }
  }

  async gc(): Promise<{ missions: number; worktreesRemoved: number; errors: string[] }> {
    const errors: string[] = [];
    let worktreesRemoved = 0;
    let missions = 0;
    for (const mission of this.store.listMissions()) {
      if (!TERMINAL_MISSION.has(mission.status)) continue;
      missions += 1;
      const paths = this.repoPaths(mission.repo);
      const registry = storeRegistry(this.store);
      for (const task of this.store.tasksForMission(mission.id)) {
        if (task.worktree === undefined || task.worktree === "") continue;
        try {
          await release({ repoDir: paths.repoDir, worktree: task.worktree, registry });
          worktreesRemoved += 1;
        } catch (err) {
          errors.push(`${task.id}: ${(err as Error).message}`);
        }
      }
    }
    return { missions, worktreesRemoved, errors };
  }

  // -- Startup -----------------------------------------------------------

  /** Refuse to start when any operation is missing on any enabled expert. */
  async assertContracts(): Promise<void> {
    const missing: string[] = [];
    for (const [name, expert] of Object.entries(this.deps.fleet.experts)) {
      if (!expert.enabled) continue;
      const client = this.deps.clients.get(name);
      if (client === undefined) {
        missing.push(`${name}: no client`);
        continue;
      }
      try {
        await client.assertContract();
      } catch (err) {
        missing.push(`${name}: ${(err as Error).message}`);
      }
    }
    if (missing.length > 0)
      throw new EngineError(`refusing to start: OpenCode contract failed: ${missing.join("; ")}`);
  }

  async startup(): Promise<{ recovered: string[]; lost: string[]; collected: string[] }> {
    const recovered: string[] = [];
    const lost: string[] = [];
    const collected: string[] = [];
    const registry = storeRegistry(this.store);
    for (const repoId of this.deps.registries.keys()) {
      const cleaned = await recoverWorktrees(
        this.store,
        `${this.deps.workspaceRoot}/${repoId}`,
        `${this.deps.workspaceRoot}/${repoId}/repo`,
        registry,
      );
      recovered.push(...cleaned);
    }
    const probeMs = this.deps.triageProbeMs ?? 2000;
    for (const mission of this.store.listMissions()) {
      if (TERMINAL_MISSION.has(mission.status)) continue;
      for (const task of this.store.tasksForMission(mission.id)) {
        if (task.status !== TaskStatuses.running) continue;
        if (task.kind !== "expert-run" || task.expert === undefined) {
          await this.applyFailure(mission, task, "lost");
          lost.push(task.id);
          continue;
        }
        const action = await triageTask(this.clientFor(task.expert), task, probeMs);
        if (action.action === "lost") {
          await this.applyFailure(mission, task, "lost");
          lost.push(task.id);
        } else {
          const outcome = await runExpertTask(
            task,
            mission,
            this.runnerOptions(mission, task, {
              sessionId: action.sessionId,
              worktree: task.worktree ?? "",
              branch: task.branch ?? "",
            }),
          );
          await this.applyExpertOutcome(mission, task, outcome);
          collected.push(task.id);
        }
      }
    }
    return { recovered, lost, collected };
  }

  // -- Loop --------------------------------------------------------------

  async tick(): Promise<void> {
    for (const mission of this.store.listMissions()) {
      if (TERMINAL_MISSION.has(mission.status)) continue;
      if (mission.status === MissionStatuses.paused) {
        await this.maybeResume(mission);
        continue;
      }
      if (mission.status !== MissionStatuses.running) continue;
      await this.tickMission(mission);
    }
  }

  private async maybeResume(mission: Mission): Promise<void> {
    if (mission.pausedUntil === undefined) return;
    if (this.clock().now() < Date.parse(mission.pausedUntil)) return;
    await this.store.transition(
      "mission.updated",
      { mission: mission.id, to: "running", reason: "usage-resumed" },
      (tx) =>
        tx.putMission({
          ...mission,
          status: MissionStatuses.running,
          pausedUntil: undefined,
          updatedAt: this.nowIso(),
        }),
    );
    const running = this.store
      .tasksForMission(mission.id)
      .filter((t) => t.status === TaskStatuses.running);
    for (const task of running) {
      if (task.kind !== "expert-run" || task.sessionId === undefined || task.sessionId === "") {
        await this.applyFailure(mission, task, "lost");
        continue;
      }
      try {
        await this.clientFor(task.expert ?? "").prompt(task.sessionId, "Continue.");
      } catch {
        await this.applyFailure(mission, task, "lost");
        continue;
      }
      const outcome = await runExpertTask(
        task,
        mission,
        this.runnerOptions(mission, task, {
          sessionId: task.sessionId,
          worktree: task.worktree ?? "",
          branch: task.branch ?? "",
        }),
      );
      await this.applyExpertOutcome(mission, this.requireTask(task.id), outcome);
    }
    await this.progressMission(this.requireMission(mission.id));
  }

  private async tickMission(mission: Mission): Promise<void> {
    const tasks = this.store.tasksForMission(mission.id);
    const runningIds = tasks.filter((t) => t.status === TaskStatuses.running).map((t) => t.id);
    const caps = {
      fleet: this.deps.fleet.defaults.maxConcurrent,
      perExpert: () => this.deps.fleet.defaults.maxConcurrent,
    };
    const { start, ready, cancel } = schedule(tasks, runningIds, caps);
    for (const id of cancel) {
      const task = this.requireTask(id);
      if (TERMINAL_TASK.has(task.status)) continue;
      await this.store.transition("task.cancelled", { task: id, mission: mission.id }, (tx) =>
        tx.putTask({ ...task, status: TaskStatuses.cancelled }),
      );
    }
    for (const id of ready) {
      const task = this.requireTask(id);
      if (task.status === TaskStatuses.pending) {
        await this.store.transition("task.ready", { task: id, mission: mission.id }, (tx) =>
          tx.putTask({ ...task, status: TaskStatuses.ready }),
        );
      }
    }
    for (const id of start) {
      const task = this.requireTask(id);
      await this.store.transition("task.started", { task: id, mission: mission.id }, (tx) =>
        tx.putTask({ ...task, status: TaskStatuses.running, attempts: task.attempts + 1 }),
      );
      const running = this.requireTask(id);
      if (running.kind === "expert-run") {
        await this.startExpertRun(mission, running);
      } else if (running.kind === "verify") {
        await this.startVerify(mission, running);
      } else if (running.kind === "land") {
        await this.startLand(mission, running);
      } else {
        await this.store.transition("task.finished", { task: id, kind: "human" }, (tx) =>
          tx.putTask({ ...running, status: TaskStatuses.waitingHuman }),
        );
      }
    }
    await this.progressMission(this.requireMission(mission.id));
  }

  private runnerOptions(
    mission: Mission,
    task: Task,
    resume?: { sessionId: string; worktree: string; branch: string; prompt?: string },
  ): Parameters<typeof runExpertTask>[2] {
    const reg = this.registryFor(mission.repo);
    const paths = this.repoPaths(mission.repo);
    return {
      client: this.clientFor(task.expert ?? ""),
      fleet: this.deps.fleet,
      ownership: reg.ownership,
      taskTimeoutSec: this.deps.taskTimeoutSec ?? this.deps.fleet.defaults.taskTimeoutSec,
      followupTimeoutMs: 300_000,
      permissionPollMs: 1000,
      clock: this.clock(),
      hooks: this.hooks(),
      paths: {
        repoDir: paths.repoDir,
        treesDir: paths.treesDir,
        artifactsDir: this.deps.artifactsRoot,
      },
      resume,
    };
  }

  private async startExpertRun(mission: Mission, task: Task): Promise<void> {
    const reworkNotes =
      typeof task.result === "object" && task.result !== null
        ? (task.result as { reworkNotes?: unknown }).reworkNotes
        : undefined;
    const resume =
      typeof reworkNotes === "string" &&
      task.sessionId !== undefined &&
      task.worktree !== undefined &&
      task.branch !== undefined
        ? {
            sessionId: task.sessionId,
            worktree: task.worktree,
            branch: task.branch,
            prompt: reworkNotes,
          }
        : undefined;
    let outcome = await runExpertTask(task, mission, this.runnerOptions(mission, task, resume));
    // Provider refusals are handled here, authoritatively: transient ones
    // retry with backoff in the same session, usage-limit ones pause every
    // running mission, the rest fail the task. applyExpertOutcome below
    // never re-classifies, so the streak counts each refusal exactly once.
    while (
      outcome.outcome === "failed" &&
      outcome.reason === "provider" &&
      outcome.providerError !== undefined
    ) {
      const streak = (this.providerStreak.get(task.id) ?? 0) + 1;
      this.providerStreak.set(task.id, streak);
      const disposition = classifyProviderFailure(outcome.providerError, streak);
      if (disposition === "pause-missions") {
        // The task is left as it is (still running), but its session is
        // recorded so the resume tick can re-prompt it.
        const parked = this.requireTask(task.id);
        await this.store.transition(
          "task.updated",
          { task: task.id, session: outcome.sessionId },
          (tx) =>
            tx.putTask({
              ...parked,
              sessionId: outcome.sessionId,
              branch: outcome.branch,
              worktree: outcome.worktree,
            }),
        );
        await this.pauseMission(mission, outcome.providerError);
        return;
      }
      if (disposition === "fail-task" || streak >= 5) break;
      await this.clock().sleep(backoffMs(streak));
      try {
        await this.clientFor(task.expert ?? "").prompt(outcome.sessionId, "Continue.");
      } catch {
        this.providerStreak.delete(task.id);
        await this.applyFailure(mission, this.requireTask(task.id), "unreachable");
        return;
      }
      outcome = await runExpertTask(
        task,
        mission,
        this.runnerOptions(mission, task, {
          sessionId: outcome.sessionId,
          worktree: outcome.worktree,
          branch: outcome.branch,
        }),
      );
    }
    await this.applyExpertOutcome(mission, this.requireTask(task.id), outcome);
  }

  private async pauseMission(mission: Mission, failure: { message: string }): Promise<void> {
    const probeMs = this.deps.probeIntervalMs ?? 60_000;
    const pausedUntil = new Date(this.clock().now() + probeMs).toISOString();
    await this.store.transition(
      "mission.updated",
      { mission: mission.id, to: "paused", reason: failure.message },
      (tx) =>
        tx.putMission({
          ...mission,
          status: MissionStatuses.paused,
          pausedUntil,
          updatedAt: this.nowIso(),
        }),
    );
  }

  private async applyExpertOutcome(
    mission: Mission,
    task: Task,
    outcome: ExpertRunResult,
  ): Promise<void> {
    if (outcome.outcome === "done") {
      this.providerStreak.delete(task.id);
      await this.store.transition(
        "task.finished",
        { task: task.id, outcome: "done", headSha: outcome.headSha },
        (tx) =>
          tx.putTask({
            ...task,
            status: TaskStatuses.done,
            result: {
              block: outcome.result,
              headSha: outcome.headSha,
              commits: outcome.commits,
              artifacts: outcome.artifacts,
              sharedFlags: outcome.sharedFlags,
              collectedUncommitted: outcome.collectedUncommitted,
            },
            sessionId: outcome.sessionId,
            branch: outcome.branch,
            worktree: outcome.worktree,
            headSha: outcome.headSha,
          }),
      );
      return;
    }
    if (outcome.reason === "provider") this.providerStreak.delete(task.id);
    await this.applyFailure(
      this.requireMission(mission.id),
      task,
      outcome.reason ?? "provider",
      outcome,
    );
  }

  private async applyFailure(
    mission: Mission,
    task: Task,
    reason: string,
    outcome?: ExpertRunResult,
  ): Promise<void> {
    const current = this.requireTask(task.id);
    const next = nextStatus(current, "failure");
    await this.store.transition("task.finished", { task: task.id, outcome: next, reason }, (tx) =>
      tx.putTask({
        ...current,
        status: next,
        reason,
        result: {
          ...(typeof current.result === "object" && current.result !== null ? current.result : {}),
          ...(outcome?.result !== undefined ? { block: outcome.result } : {}),
          ...(outcome?.headSha !== undefined ? { headSha: outcome.headSha } : {}),
          failureReason: reason,
        },
        ...(outcome?.sessionId !== undefined && outcome.sessionId !== ""
          ? { sessionId: outcome.sessionId }
          : {}),
        ...(outcome?.branch !== undefined && outcome.branch !== ""
          ? { branch: outcome.branch }
          : {}),
        ...(outcome?.worktree !== undefined && outcome.worktree !== ""
          ? { worktree: outcome.worktree }
          : {}),
        ...(outcome?.headSha !== undefined ? { headSha: outcome.headSha } : {}),
      }),
    );
  }

  private async startVerify(mission: Mission, task: Task): Promise<void> {
    const reg = this.registryFor(mission.repo);
    const producerId = task.deps[0];
    const producer = producerId !== undefined ? this.store.getTask(producerId) : undefined;
    if (producer?.worktree === undefined || producer.worktree === "") {
      await this.store.transition(
        "task.finished",
        { task: task.id, outcome: "failed", reason: "no-worktree" },
        (tx) => tx.putTask({ ...task, status: TaskStatuses.failed, reason: "no-worktree" }),
      );
      return;
    }
    let result;
    try {
      result = await this.deps.verifier.run({
        taskId: task.id,
        dir: producer.worktree,
        setup: reg.checks.setup,
        checks: reg.checks.checks,
      });
    } catch {
      await this.store.transition(
        "task.finished",
        { task: task.id, outcome: "failed", reason: "unreachable" },
        (tx) => tx.putTask({ ...task, status: TaskStatuses.failed, reason: "unreachable" }),
      );
      return;
    }
    if (result.reason === "busy") {
      // Transient: requeue for the next tick.
      await this.store.transition("task.ready", { task: task.id, outcome: "requeued-busy" }, (tx) =>
        tx.putTask({ ...task, status: TaskStatuses.pending }),
      );
      return;
    }
    const final = result.ok ? TaskStatuses.done : TaskStatuses.failed;
    const reason = result.ok
      ? undefined
      : result.reason === "setup"
        ? "setup"
        : (result.checks.find((c) => c.exit !== 0)?.id ?? result.reason ?? "checks");
    await this.store.transition(
      "verify.result",
      { task: task.id, mission: mission.id, ok: result.ok, reason },
      (tx) =>
        tx.putTask({
          ...task,
          status: final,
          ...(reason !== undefined ? { reason } : {}),
          result: { checks: result.checks, setup: result.setup },
        }),
    );
  }

  private async startLand(mission: Mission, task: Task): Promise<void> {
    const reg = this.registryFor(mission.repo);
    const paths = this.repoPaths(mission.repo);
    const verifyId = task.deps[0];
    const verifyTask = verifyId !== undefined ? this.store.getTask(verifyId) : undefined;
    const producerId = verifyTask?.deps[0];
    const producer = producerId !== undefined ? this.store.getTask(producerId) : undefined;
    if (
      producer?.worktree === undefined ||
      producer.worktree === "" ||
      producer.branch === undefined ||
      producer.branch === ""
    ) {
      await this.store.transition(
        "task.finished",
        { task: task.id, outcome: "failed", reason: "no-worktree" },
        (tx) => tx.putTask({ ...task, status: TaskStatuses.failed, reason: "no-worktree" }),
      );
      return;
    }
    const release = await this.locks().acquire(mission.id);
    try {
      const result = await land(
        {
          missionId: mission.id,
          taskId: producer.id,
          taskBranch: producer.branch,
          integrationBranch: mission.integrationBranch,
          worktreeDir: producer.worktree,
        },
        {
          verifier: this.deps.verifier,
          checks: reg.checks,
          audit: (event, data) => this.store.transition(event, data, () => {}).then(() => {}),
          auditTip: () => {
            const tip = this.store.auditTip();
            return { seq: tip.seq, hash: tip.hash };
          },
          paths: {
            repoDir: paths.repoDir,
            landingRoot: paths.landingRoot,
            artifactsDir: this.deps.artifactsRoot,
          },
        },
      );
      if (result.ok) {
        const plan = mission.plan as {
          director?: DirectorTask[];
          lastVerifyOk?: boolean;
          approved?: boolean;
        };
        const updated: Mission = {
          ...this.requireMission(mission.id),
          plan: {
            director: plan.director ?? [],
            lastVerifyOk: true,
            approved: plan.approved ?? true,
          },
          updatedAt: this.nowIso(),
        };
        await this.store.transition(
          "task.finished",
          { task: task.id, outcome: "done", landedSha: result.landedSha },
          (tx) => {
            tx.putMission(updated);
            tx.putTask({
              ...task,
              status: TaskStatuses.done,
              landedSha: result.landedSha,
              result: { verify: result.verify },
            });
          },
        );
      } else {
        await this.store.transition(
          "task.finished",
          { task: task.id, outcome: "failed", reason: result.reason },
          (tx) =>
            tx.putTask({
              ...task,
              status: TaskStatuses.failed,
              reason: result.reason,
              result: { stage: result.stage, files: result.files },
            }),
        );
      }
    } finally {
      release();
    }
  }

  private async progressMission(mission: Mission): Promise<void> {
    const tasks = this.store.tasksForMission(mission.id);
    const open = tasks.filter((t) => !TERMINAL_TASK.has(t.status));
    if (open.length === 0) {
      const failed = tasks.filter((t) => t.status === TaskStatuses.failed);
      if (failed.length > 0) {
        await this.closeMission(mission.id, "failed");
        return;
      }
      try {
        await this.closeMission(mission.id, "done");
      } catch {
        await this.closeMission(mission.id, "failed");
      }
      return;
    }
    const actionable = open.filter(
      (t) =>
        t.status === TaskStatuses.pending ||
        t.status === TaskStatuses.ready ||
        t.status === TaskStatuses.running,
    );
    if (actionable.length > 0) return;
    // Nothing runnable is left: any terminal failure fails the mission,
    // otherwise it waits for a human (replan parks, decisions release).
    if (open.some((t) => t.status === TaskStatuses.failed)) {
      await this.closeMission(mission.id, "failed");
      return;
    }
    const current = this.requireMission(mission.id);
    if (current.status !== MissionStatuses.waitingHuman) {
      await this.store.transition(
        "mission.updated",
        { mission: mission.id, to: MissionStatuses.waitingHuman },
        (tx) =>
          tx.putMission({
            ...current,
            status: MissionStatuses.waitingHuman,
            updatedAt: this.nowIso(),
          }),
      );
    }
  }

  async start(opts?: { pollMs?: number; stop?: () => boolean }): Promise<void> {
    await this.assertContracts();
    await this.startup();
    const pollMs = opts?.pollMs ?? 5000;
    for (;;) {
      if (opts?.stop?.() === true) return;
      await this.tick();
      if (opts?.stop?.() === true) return;
      await this.clock().sleep(pollMs);
    }
  }

  private requireMission(missionId: string): Mission {
    const mission = this.store.getMission(missionId);
    if (mission === undefined) throw new EngineError(`unknown mission ${missionId}`);
    return mission;
  }

  private requireTask(taskId: string): Task {
    const task = this.store.getTask(taskId);
    if (task === undefined) throw new EngineError(`unknown task ${taskId}`);
    return task;
  }
}
