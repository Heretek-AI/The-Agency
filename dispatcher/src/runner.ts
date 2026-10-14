/**
 * Expert-run task runner (Stage 1c, Step 6). Runs one `expert-run` task
 * as an OpenCode session:
 *
 * 1. Allocate the worktree (`fleet/<taskId>` branch for `scoped`
 *    experts, detached for `ro` experts; base is the task's `base` or the
 *    mission's integration branch).
 * 2. Build session permissions (edit allow per grant plus shared, edit
 *    deny per protected path, one MCP allow per server the expert uses).
 * 3. createSession + prompt with the envelope.
 * 4. Supervise: relay SSE events to the task event log; reject every
 *    pending permission request with the headless-fleet message.
 * 5. Wait for idle; interrupt at the timeout and fail with `timeout`.
 * 6. Collect the final message, diff, commits, artifacts; commit leftover
 *    uncommitted changes as the Dispatcher and record it.
 * 7. Parse the RESULT block; one follow-up, then `no-block`.
 * 8. Policy check (`scope`, `ro-violation`, shared flags).
 * 9. Return the outcome with `headSha`; the engine persists it and calls
 *    the wake-up hook.
 *
 * An unreachable expert fails the task with `unreachable`. Timers come
 * from an injected clock so tests do not sleep.
 */
import type { FleetConfig } from "./fleet-schema.js";
import { buildEnvelope } from "./envelope.js";
import { git } from "./git.js";
import type { Mission, Task } from "./model.js";
import { OpenCodeClient, OpenCodeError, type FileDiff, type StreamEvent } from "./opencode.js";
import { changedFiles, checkPolicy, type OwnershipGrant } from "./policy.js";
import { extractBlock, type ResultBlock } from "./protocol.js";
import type { OwnershipConfig } from "./registry-schema.js";
import { allocate, integrationBranch, taskBranch, type AllocationRegistry } from "./worktrees.js";

export const PERMISSION_REJECT_MESSAGE =
  "Headless fleet: this action is outside your permissions. Continue without it or report it as blocked.";

const FOLLOWUP_PREFIX = "Your final message did not contain a valid RESULT block";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

export interface RunnerHooks {
  /** Append an audit event (engine: store.transition). */
  audit(event: string, data: unknown): Promise<void>;
  /** Relay one SSE event to the task's event log. */
  eventLog(taskId: string, event: StreamEvent): Promise<void>;
  /** Crash-safe allocation register (engine: store-backed). */
  registry: AllocationRegistry;
  /** Wake-up hook (Stage 1d connects it to the Director). */
  onWake(taskId: string): void;
}

export interface RunnerOptions {
  client: OpenCodeClient;
  fleet: FleetConfig;
  ownership: OwnershipConfig;
  /** Task timeout in seconds (fleet default when the task sets none). */
  taskTimeoutSec: number;
  /** Follow-up wait in ms for the missing RESULT block. Defaults to 5 min. */
  followupTimeoutMs?: number;
  /** Permission poll interval in ms. Defaults to 2 s. */
  permissionPollMs?: number;
  clock?: Clock;
  hooks: RunnerHooks;
  /** Roots for this repository's workspace layout. */
  paths: {
    repoDir: string;
    treesDir: string;
    artifactsDir: string;
  };
}

export type RunReason =
  "timeout" | "unreachable" | "no-block" | "scope" | "ro-violation" | "provider";

export interface ProviderFailure {
  kind: "quota" | "transient" | "auth";
  type?: string;
  message: string;
  status?: number;
}

export interface ExpertRunResult {
  outcome: "done" | "failed";
  reason?: RunReason;
  sessionId: string;
  branch: string;
  worktree: string;
  headSha?: string;
  result?: ResultBlock;
  resultRaw?: string;
  diff?: FileDiff[];
  commits?: string[];
  artifacts?: string[];
  sharedFlags?: string[];
  permissionRejections?: { requestID: string; tool?: string }[];
  collectedUncommitted?: boolean;
  providerError?: ProviderFailure;
}

interface SessionPermission {
  action: string;
  resource: string;
  effect: "allow" | "deny";
}

/** Session permissions for a task (spike Q7: evaluated after agent rules). */
export function sessionPermissions(
  fleet: FleetConfig,
  ownership: OwnershipConfig,
  task: Task,
): SessionPermission[] {
  const rules: SessionPermission[] = [];
  const expert = task.expert !== undefined ? fleet.experts[task.expert] : undefined;
  const mcpAllows = (expert?.mcp ?? []).map((key) => ({
    action: `${key}_*`,
    resource: "*",
    effect: "allow" as const,
  }));
  if (expert?.access === "scoped") {
    const grant = task.expert !== undefined ? ownership.experts[task.expert] : undefined;
    const writes = grant?.writes ?? [];
    for (const p of [...writes, ...ownership.shared])
      rules.push({ action: "edit", resource: p, effect: "allow" });
    for (const p of ownership.protected)
      rules.push({ action: "edit", resource: p, effect: "deny" });
  }
  return [...rules, ...mcpAllows];
}

export function grantFor(ownership: OwnershipConfig, expert: string): OwnershipGrant {
  const entry = ownership.experts[expert];
  return { writes: entry?.writes ?? [], shared: ownership.shared, protected: ownership.protected };
}

function messageText(message: { content?: unknown; parts?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null) {
          const text = (part as Record<string, unknown>)["text"];
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

/** Provider refusal envelope in a transcript message (spike Q8 shape). */
export function findProviderError(
  messages: { [key: string]: unknown }[],
): ProviderFailure | undefined {
  for (const message of messages) {
    const error = (message as Record<string, unknown>)["error"] as
      { type?: unknown; message?: unknown; status?: unknown } | undefined;
    if (
      typeof error === "object" &&
      error !== null &&
      typeof error.type === "string" &&
      error.type.startsWith("provider.")
    ) {
      const type = error.type;
      const status = typeof error.status === "number" ? error.status : undefined;
      const text = typeof error.message === "string" ? error.message : type;
      if (type === "provider.quota" || type === "provider.rate-limit" || status === 429)
        return { kind: "quota", type, message: text, status };
      if (type === "provider.auth") return { kind: "auth", type, message: text, status };
      return { kind: "transient", type, message: text, status };
    }
  }
  return undefined;
}

function isUnreachable(err: unknown): boolean {
  if (err instanceof OpenCodeError) return false;
  if (err instanceof TypeError) return true;
  const code = (err as { code?: unknown }).code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN";
}

async function listArtifacts(artifactsDir: string, taskId: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const root = `${artifactsDir}/${taskId}`;
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: { name: string; isDirectory(): boolean }[];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as typeof entries;
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  };
  await walk(root);
  return out.sort();
}

export async function runExpertTask(
  task: Task,
  mission: Mission,
  options: RunnerOptions,
): Promise<ExpertRunResult> {
  const { client, fleet, ownership, hooks, paths } = options;
  const clock = options.clock ?? realClock;
  const pollMs = options.permissionPollMs ?? 2000;
  const followupMs = options.followupTimeoutMs ?? 300_000;
  if (task.expert === undefined) throw new Error(`task ${task.id} names no expert`);
  const expert = fleet.experts[task.expert];
  if (expert === undefined || !expert.enabled)
    throw new Error(`task ${task.id} names unknown or disabled expert ${task.expert}`);
  const scoped = expert.access === "scoped";
  const base = task.input.base ?? integrationBranch(mission.id);

  await hooks.audit("task.started", { task: task.id, mission: mission.id, expert: task.expert });
  const alloc = await allocate({
    repoDir: paths.repoDir,
    treesDir: paths.treesDir,
    taskId: task.id,
    mode: scoped ? "branch" : "detached",
    base,
    registry: hooks.registry,
  });
  const branch = scoped ? taskBranch(task.id) : "";

  const permissions = sessionPermissions(fleet, ownership, task);
  let sessionId: string;
  try {
    const created = await client.createSession({
      title: `Task ${task.id}: ${task.title}`,
      agent: task.expert,
      location: { directory: alloc.dir },
      permissions,
      metadata: { taskId: task.id, missionId: mission.id, role: task.role },
    });
    sessionId = created.id;
  } catch (err) {
    if (isUnreachable(err))
      return {
        outcome: "failed",
        reason: "unreachable",
        sessionId: "",
        branch,
        worktree: alloc.dir,
      };
    throw err;
  }

  const events: StreamEvent[] = [];
  const sub = client.subscribeEvents({
    reconnectMs: 1000,
    onEvent: (event) => {
      events.push(event);
      void hooks.eventLog(task.id, event).catch(() => {});
    },
  });

  const permissionRejections: { requestID: string; tool?: string }[] = [];
  let supervising = true;
  const supervisor = (async (): Promise<void> => {
    while (supervising) {
      await clock.sleep(pollMs);
      if (!supervising) break;
      let pending: { requestID: string; tool?: string }[];
      try {
        pending = await client.pendingPermissions(sessionId);
      } catch {
        continue;
      }
      for (const request of pending) {
        try {
          await client.replyPermission(
            sessionId,
            request.requestID,
            "reject",
            PERMISSION_REJECT_MESSAGE,
          );
        } catch {
          continue;
        }
        permissionRejections.push({ requestID: request.requestID, tool: request.tool });
        await hooks.audit("permission.rejected", {
          task: task.id,
          session: sessionId,
          requestID: request.requestID,
          tool: request.tool,
        });
      }
    }
  })();

  const finish = async (): Promise<void> => {
    supervising = false;
    await supervisor;
    sub.close();
  };

  const timeoutMs = options.taskTimeoutSec * 1000;
  try {
    await client.prompt(
      sessionId,
      buildEnvelope({
        taskId: task.id,
        title: task.title,
        missionId: mission.id,
        role: task.role,
        expert: task.expert ?? "",
        objective: task.input.objective,
        context: task.input.context,
        constraints: task.input.constraints,
        acceptance: task.input.acceptance,
        worktree: alloc.dir,
        branch: scoped ? branch : null,
        grantedPaths: task.input.paths,
      }),
    );
  } catch (err) {
    await finish();
    if (isUnreachable(err))
      return { outcome: "failed", reason: "unreachable", sessionId, branch, worktree: alloc.dir };
    throw err;
  }

  try {
    await client.waitIdle(sessionId, timeoutMs);
  } catch (err) {
    await finish();
    if (err instanceof OpenCodeError && err.status === 408) {
      await client.interrupt(sessionId).catch(() => {});
      return {
        outcome: "failed",
        reason: "timeout",
        sessionId,
        branch,
        worktree: alloc.dir,
        permissionRejections,
      };
    }
    if (isUnreachable(err))
      return { outcome: "failed", reason: "unreachable", sessionId, branch, worktree: alloc.dir };
    if (err instanceof OpenCodeError && err.status === 429)
      return {
        outcome: "failed",
        reason: "provider",
        sessionId,
        branch,
        worktree: alloc.dir,
        providerError: { kind: "quota", message: err.message, status: 429 },
      };
    if (err instanceof OpenCodeError && err.status >= 500)
      return {
        outcome: "failed",
        reason: "provider",
        sessionId,
        branch,
        worktree: alloc.dir,
        providerError: { kind: "transient", message: err.message, status: err.status },
      };
    throw err;
  }

  // Collect: transcript, provider refusals, diff, commits, artifacts.
  let messages: { [key: string]: unknown }[];
  try {
    messages = (await client.messages(sessionId)) as typeof messages;
  } catch (err) {
    await finish();
    if (isUnreachable(err))
      return { outcome: "failed", reason: "unreachable", sessionId, branch, worktree: alloc.dir };
    throw err;
  }
  const providerError = findProviderError(messages);
  if (providerError !== undefined) {
    await finish();
    return {
      outcome: "failed",
      reason: "provider",
      sessionId,
      branch,
      worktree: alloc.dir,
      providerError,
      permissionRejections,
    };
  }

  const lastText = (msgs: { [key: string]: unknown }[]): string =>
    [...msgs]
      .reverse()
      .map((m) => messageText(m))
      .find((t) => t.trim() !== "") ?? "";
  const first = extractBlock(lastText(messages), "RESULT");
  let block: ResultBlock;
  let blockRaw: string;
  if (first.ok) {
    block = first.value as ResultBlock;
    blockRaw = first.raw;
  } else {
    try {
      await client.prompt(
        sessionId,
        `${FOLLOWUP_PREFIX} (${first.reason}). Reply now with your final message ending in a ## RESULT heading followed by one fenced json block matching the fleet protocol. Do not do any further work.`,
      );
      await client.waitIdle(sessionId, followupMs);
    } catch (err) {
      await finish();
      if (err instanceof OpenCodeError && err.status === 408) {
        await client.interrupt(sessionId).catch(() => {});
        return { outcome: "failed", reason: "timeout", sessionId, branch, worktree: alloc.dir };
      }
      throw err;
    }
    try {
      messages = (await client.messages(sessionId)) as typeof messages;
    } catch (err) {
      await finish();
      if (isUnreachable(err))
        return { outcome: "failed", reason: "unreachable", sessionId, branch, worktree: alloc.dir };
      throw err;
    }
    const second = extractBlock(lastText(messages), "RESULT");
    if (!second.ok) {
      await finish();
      return {
        outcome: "failed",
        reason: "no-block",
        sessionId,
        branch,
        worktree: alloc.dir,
        resultRaw: second.raw,
        permissionRejections,
      };
    }
    block = second.value as ResultBlock;
    blockRaw = second.raw;
  }

  // Commit leftover uncommitted changes as the Dispatcher and record it.
  let collectedUncommitted = false;
  const status = await git(alloc.dir, ["status", "--porcelain"]);
  if (status !== "" && scoped) {
    await git(alloc.dir, ["add", "-A"]);
    await git(alloc.dir, [
      "-c",
      "user.name=agency-dispatcher",
      "-c",
      "user.email=dispatcher@agency.invalid",
      "commit",
      "-m",
      `dispatcher: collect uncommitted work for ${task.id}`,
    ]);
    collectedUncommitted = true;
  }

  const changed = await changedFiles(alloc.dir, base);
  const policy = checkPolicy(changed, grantFor(ownership, task.expert), scoped ? "scoped" : "ro");
  await hooks.audit("policy.result", {
    task: task.id,
    ok: policy.ok,
    ...(policy.ok
      ? { sharedTouched: policy.sharedTouched }
      : { reason: policy.reason, files: policy.files }),
  });
  if (!policy.ok) {
    await finish();
    const head = await git(alloc.dir, ["rev-parse", "HEAD"]).catch(() => undefined);
    return {
      outcome: "failed",
      reason: policy.reason,
      sessionId,
      branch,
      worktree: alloc.dir,
      headSha: head,
      result: block,
      resultRaw: blockRaw,
      collectedUncommitted,
      permissionRejections,
    };
  }

  const headSha = await git(alloc.dir, ["rev-parse", "HEAD"]);
  const sessionDiff = await client.diff(sessionId).catch(() => [] as FileDiff[]);
  const commitsRaw = await git(alloc.dir, ["log", "--format=%H", `${base}..HEAD`]).catch(() => "");
  const commits = commitsRaw.split("\n").filter((s) => s !== "");
  const artifacts = await listArtifacts(paths.artifactsDir, task.id);
  await hooks.audit("task.finished", {
    task: task.id,
    mission: mission.id,
    headSha,
    commits,
    artifacts,
    collectedUncommitted,
    sharedTouched: policy.sharedTouched,
  });
  await finish();
  hooks.onWake(task.id);
  return {
    outcome: "done",
    sessionId,
    branch,
    worktree: alloc.dir,
    headSha,
    result: block,
    resultRaw: blockRaw,
    diff: sessionDiff,
    commits,
    artifacts,
    sharedFlags: policy.sharedTouched,
    permissionRejections,
    collectedUncommitted,
  };
}
