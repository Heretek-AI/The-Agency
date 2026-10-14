import { timingSafeEqual } from "node:crypto";
import { Engine, EngineError, type RepoRegistry } from "./engine.js";
import type { FleetConfig } from "./fleet-schema.js";
import { DagError } from "./graph.js";
import { MissionStatuses, TaskStatuses, type Mission, type Task } from "./model.js";
import { OpenCodeClient } from "./opencode.js";
import { PlanError, type DirectorTask } from "./plan.js";

/**
 * The `fleet` MCP server (Stage 1d, Step 1). Served on `/mcp` as
 * Streamable HTTP with a bearer `FLEET_MCP_TOKEN`. Nine tools, each a
 * thin call into the Stage 1c engine API and nothing else. Every result
 * is bounded in size and names where the full data lives.
 */

export const MCP_DEFAULT_MAX_BYTES = 8000;
export const MCP_HARD_MAX_BYTES = 65536;
const HEALTH_PROBE_MS = 5000;
const WAIT_POLL_MS = 200;

export interface McpContext {
  token: string;
  engine: Engine;
  fleet: FleetConfig;
  clients: Map<string, OpenCodeClient>;
  registries: Map<string, RepoRegistry>;
  defaultRepo: string;
  /** Stage 1d wake-up: called with the task id after a successful decide. */
  notify?: (taskId: string) => void;
}

export interface McpHttpRequest {
  method: string;
  headers: Headers;
  bodyText: string;
}

export interface McpHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export class McpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpError";
  }
}

function tokensEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function bearerOf(headers: Headers): string | undefined {
  const header = headers.get("authorization");
  if (header === null) return undefined;
  const match = /^Bearer (.+)$/.exec(header.trim());
  const token = match?.[1]?.trim();
  return token !== undefined && token !== "" ? token : undefined;
}

/** Bound a tool's text payload and name where the full data lives. */
export function boundText(text: string, maxBytes: number, fullWhere: string): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= maxBytes) return `${text}\nFull data: ${fullWhere}`;
  let cut = maxBytes;
  while (cut > 0 && (encoded[cut] === undefined || (encoded[cut]! & 0xc0) === 0x80)) cut -= 1;
  const head = new TextDecoder().decode(encoded.slice(0, cut));
  return (
    `${head}\n[output truncated: showing ${cut} of ${encoded.length} bytes; ` +
    `Full data: ${fullWhere}]`
  );
}

function clampMaxBytes(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new McpError("maxBytes must be a positive integer");
  return Math.min(value, MCP_HARD_MAX_BYTES);
}

function textResult(text: string): { content: { type: string; text: string }[] } {
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): {
  content: { type: string; text: string }[];
  isError: boolean;
} {
  return { content: [{ type: "text", text: `error: ${message}` }], isError: true };
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOL_DEFS: ToolDef[] = [
  {
    name: "fleet_roster",
    description: "Experts with description, handles, delegates, access, health, and load.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "fleet_mission_create",
    description: "Create a mission in planning. Returns the mission id and the ownership summary.",
    inputSchema: {
      type: "object",
      properties: { objective: { type: "string" }, repo: { type: "string" } },
      required: ["objective"],
      additionalProperties: false,
    },
  },
  {
    name: "fleet_plan_submit",
    description: "Validate and expand a plan, then start it or park the mission for approval.",
    inputSchema: {
      type: "object",
      properties: { missionId: { type: "string" }, tasks: { type: "array" } },
      required: ["missionId", "tasks"],
      additionalProperties: false,
    },
  },
  {
    name: "fleet_mission_get",
    description: "Objective, plan, every task status and reason, and decisions.",
    inputSchema: {
      type: "object",
      properties: { missionId: { type: "string" } },
      required: ["missionId"],
      additionalProperties: false,
    },
  },
  {
    name: "fleet_task_result",
    description:
      "Parsed block, report text, changed files, commits, policy, rejections, verify, artifacts.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" }, maxBytes: { type: "number" } },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
  {
    name: "fleet_task_diff",
    description: "Bounded unified diff for a task, optionally one file.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        file: { type: "string" },
        maxBytes: { type: "number" },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
  {
    name: "fleet_decide",
    description: "Accept, rework, or abandon a task. Appended to the mission log.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        decision: { type: "string", enum: ["accept", "rework", "abandon"] },
        notes: { type: "string" },
      },
      required: ["taskId", "decision"],
      additionalProperties: false,
    },
  },
  {
    name: "fleet_wait",
    description: "Return when anything in the mission changes, or at the timeout (at most 600s).",
    inputSchema: {
      type: "object",
      properties: { missionId: { type: "string" }, timeoutSec: { type: "number" } },
      required: ["missionId"],
      additionalProperties: false,
    },
  },
  {
    name: "fleet_mission_close",
    description: "Mark the mission done with the Director report. Refused unless done holds.",
    inputSchema: {
      type: "object",
      properties: { missionId: { type: "string" }, summary: { type: "string" } },
      required: ["missionId", "summary"],
      additionalProperties: false,
    },
  },
];

export function toolNames(): string[] {
  return TOOL_DEFS.map((t) => t.name);
}

/** Validate raw plan input into Director tasks. Shared by MCP and REST. */
export function parsePlanTasks(rawTasks: unknown): DirectorTask[] {
  if (!Array.isArray(rawTasks) || rawTasks.length === 0)
    throw new McpError("tasks must be a non-empty array");
  return rawTasks.map((raw, i) => {
    const r = asRecord(raw, `tasks[${i}]`);
    const key = asString(r["key"], `tasks[${i}].key`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(key))
      throw new McpError(`tasks[${i}].key must be a slug`);
    const expert = asString(r["expert"], `tasks[${i}].expert`);
    return {
      id: key,
      title: optionalString(r["title"], `tasks[${i}].title`) ?? key,
      role: optionalString(r["role"], `tasks[${i}].role`) ?? expert,
      expert,
      deps: r["deps"] === undefined ? [] : asStringArray(r["deps"], `tasks[${i}].deps`),
      trigger: "all_success" as const,
      input: {
        objective: asString(r["objective"], `tasks[${i}].objective`),
        context: optionalString(r["context"], `tasks[${i}].context`),
        constraints: optionalString(r["constraints"], `tasks[${i}].constraints`),
        acceptance:
          r["acceptance"] === undefined
            ? []
            : asStringArray(r["acceptance"], `tasks[${i}].acceptance`),
        paths: r["paths"] === undefined ? [] : asStringArray(r["paths"], `tasks[${i}].paths`),
      },
      policy: { strategy: "fail" as const },
    };
  });
}

/** Keep one file's hunks of a unified diff. Undefined when the file is absent. */
export function filterDiff(diff: string, file: string): string | undefined {
  const chunks = diff.split(/(?=\ndiff --git )/).flatMap((c) => c.split(/(?=^diff --git )/m));
  const kept = chunks.filter(
    (c) => c.includes(`a/${file}`) || c.includes(`b/${file}`) || c.includes(`+++ b/${file}`),
  );
  if (kept.length === 0) return undefined;
  return kept.join("").replace(/^\n/, "");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new McpError(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new McpError(`${what} is required`);
  return value;
}

function asStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new McpError(`${what} must be an array of strings`);
  for (const item of value) {
    if (typeof item !== "string") throw new McpError(`${what} must be an array of strings`);
  }
  return value as string[];
}

function optionalString(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new McpError(`${what} must be a string`);
  return value;
}

async function probeHealth(client: OpenCodeClient): Promise<string> {
  try {
    await Promise.race([
      client.info(),
      sleep(HEALTH_PROBE_MS).then(() => {
        throw new Error("health probe timed out");
      }),
    ]);
    return "healthy";
  } catch (err) {
    return `unreachable: ${(err as Error).message}`;
  }
}

function taskLine(t: Task): string {
  const bits = [`${t.id} [${t.kind}/${t.role}]`, `status=${t.status}`];
  if (t.expert !== undefined) bits.push(`expert=${t.expert}`);
  if (t.reason !== undefined) bits.push(`reason=${t.reason}`);
  bits.push(`attempts=${t.attempts}`);
  if (t.headSha !== undefined) bits.push(`head=${t.headSha.slice(0, 12)}`);
  if (t.landedSha !== undefined) bits.push(`landed=${t.landedSha.slice(0, 12)}`);
  return bits.join(" ");
}

function snapshotOf(missions: Mission[], tasksOf: (id: string) => Task[]): string {
  const snap = missions.map((m) => ({
    id: m.id,
    status: m.status,
    tasks: tasksOf(m.id).map((t) => ({
      id: t.id,
      status: t.status,
      reason: t.reason ?? null,
      attempts: t.attempts,
      head: t.headSha ?? null,
      landed: t.landedSha ?? null,
    })),
  }));
  return JSON.stringify(snap);
}

function diffFiles(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split("\n")) {
    const match = /^\+\+\+ b\/(.+)$/.exec(line.trimEnd());
    if (match?.[1] !== undefined && match[1] !== "/dev/null") files.push(match[1]);
  }
  return [...new Set(files)];
}

async function callTool(
  ctx: McpContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const engine = ctx.engine;
  switch (name) {
    case "fleet_roster": {
      const lines: string[] = [];
      for (const [expertName, expert] of Object.entries(ctx.fleet.experts)) {
        if (!expert.enabled) continue;
        const client = ctx.clients.get(expertName);
        const health = client === undefined ? "no client" : await probeHealth(client);
        let load = 0;
        for (const id of engine.listMissionIds()) {
          for (const t of engine.getMission(id).tasks) {
            if (t.expert === expertName && t.status === TaskStatuses.running) load += 1;
          }
        }
        lines.push(
          [
            `${expertName} [${expert.access}] health=${health} load=${load}`,
            `  description: ${expert.description}`,
            `  handles: ${expert.handles.join("; ")}`,
            `  delegates: ${expert.delegates.join("; ")}`,
          ].join("\n"),
        );
      }
      return textResult(
        boundText(lines.join("\n"), MCP_DEFAULT_MAX_BYTES, "GET /api/fleet for the full roster"),
      );
    }
    case "fleet_mission_create": {
      const objective = asString(args["objective"], "objective");
      const repo = optionalString(args["repo"], "repo") ?? ctx.defaultRepo;
      const mission = await engine.createMission({
        repo,
        source: "chat",
        playbook: "director",
        objective,
      });
      const reg = ctx.registries.get(repo);
      const summary =
        reg === undefined
          ? "no ownership summary"
          : [
              `${Object.keys(reg.ownership.experts).length} experts hold write grants`,
              `shared: ${reg.ownership.shared.slice(0, 10).join(", ") || "(none)"}`,
              `protected: ${reg.ownership.protected.length} patterns`,
            ].join("; ");
      return textResult(
        boundText(
          `missionId: ${mission.id}\nstatus: ${mission.status}\nrepo: ${repo}\nownership: ${summary}`,
          MCP_DEFAULT_MAX_BYTES,
          `GET /api/missions/${mission.id} for the full mission`,
        ),
      );
    }
    case "fleet_plan_submit": {
      const missionId = asString(args["missionId"], "missionId");
      const tasks = parsePlanTasks(args["tasks"]);
      const expanded = await engine.submitPlan(missionId, tasks);
      const status = engine.getMission(missionId).mission.status;
      return textResult(
        boundText(
          [
            `missionId: ${missionId}`,
            `status: ${status}`,
            `tasks: ${expanded.map((t) => t.id).join(", ")}`,
            status === MissionStatuses.waitingHuman
              ? "parked: the plan exceeds the approval threshold; a human must approve"
              : "started: the engine loop picks up ready tasks",
          ].join("\n"),
          MCP_DEFAULT_MAX_BYTES,
          `GET /api/missions/${missionId} for the full mission`,
        ),
      );
    }
    case "fleet_mission_get": {
      const missionId = asString(args["missionId"], "missionId");
      const view = engine.getMission(missionId);
      const decisions = engine.listDecisions(missionId);
      const maxBytes = clampMaxBytes(args["maxBytes"], MCP_DEFAULT_MAX_BYTES);
      const lines = [
        `missionId: ${view.mission.id}`,
        `objective: ${view.mission.objective}`,
        `status: ${view.mission.status}`,
        `repo: ${view.mission.repo}`,
        `integrationBranch: ${view.mission.integrationBranch}`,
        `directorSession: ${view.mission.directorSessionId ?? "(none)"}`,
        `tasks (${view.tasks.length}):`,
        ...view.tasks.map((t) => `  ${taskLine(t)}`),
        `decisions (${decisions.length}):`,
        ...decisions.slice(-20).map((d) => `  ${JSON.stringify(d)}`),
      ];
      return textResult(
        boundText(
          lines.join("\n"),
          maxBytes,
          `GET /api/missions/${missionId} for the full mission`,
        ),
      );
    }
    case "fleet_task_result": {
      const taskId = asString(args["taskId"], "taskId");
      const maxBytes = clampMaxBytes(args["maxBytes"], MCP_DEFAULT_MAX_BYTES);
      const holder = engine.listMissionIds().flatMap((id) => engine.getMission(id).tasks);
      const task = holder.find((t) => t.id === taskId);
      if (task === undefined) throw new McpError(`unknown task ${JSON.stringify(taskId)}`);
      const result = (task.result ?? {}) as Record<string, unknown>;
      const raw = typeof result["raw"] === "string" ? (result["raw"] as string) : "";
      const report = raw !== "" ? raw : JSON.stringify(result["block"] ?? result);
      const artifacts = Array.isArray(result["artifacts"])
        ? (result["artifacts"] as unknown[]).map((a) => String(a))
        : [];
      const commits = Array.isArray(result["commits"])
        ? (result["commits"] as unknown[]).map((c) => String(c))
        : [];
      const rejections = Array.isArray(result["permissionRejections"])
        ? (result["permissionRejections"] as unknown[]).map((r) => JSON.stringify(r))
        : [];
      let changed: string[] = [];
      try {
        changed = diffFiles(await engine.taskDiff(taskId));
      } catch {
        changed = [];
      }
      const verifyTasks = engine
        .getMission(task.missionId)
        .tasks.filter((t) => (t.kind === "verify" || t.kind === "land") && t.deps.includes(taskId));
      const lines = [
        `task: ${taskLine(task)}`,
        `policy: ${JSON.stringify(task.policy)}`,
        `parsed block: ${JSON.stringify(result["block"] ?? null)}`,
        `report:`,
        report,
        `changed files: ${changed.join(", ") || "(none or no worktree)"}`,
        `commits: ${commits.join(", ") || "(none)"}`,
        `rejected permissions: ${rejections.join("; ") || "(none)"}`,
        `verify: ${verifyTasks.map((t) => `${t.id}=${t.status}${t.reason ? `:${t.reason}` : ""}`).join(", ") || "(none)"}`,
        `artifacts: ${artifacts.join(", ") || "(none)"}`,
      ];
      return textResult(
        boundText(
          lines.join("\n"),
          maxBytes,
          `artifact files under /artifacts/${taskId}/ and GET /api/tasks/${taskId} for the full result`,
        ),
      );
    }
    case "fleet_task_diff": {
      const taskId = asString(args["taskId"], "taskId");
      const file = optionalString(args["file"], "file");
      const maxBytes = clampMaxBytes(args["maxBytes"], MCP_DEFAULT_MAX_BYTES);
      let diff: string;
      try {
        diff = await engine.taskDiff(taskId);
      } catch (err) {
        throw new McpError((err as Error).message);
      }
      if (file !== undefined) {
        const scoped = filterDiff(diff, file);
        if (scoped === undefined) throw new McpError(`no diff for file ${JSON.stringify(file)}`);
        diff = scoped;
      }
      if (diff.trim() === "") diff = "(empty diff)";
      return textResult(
        boundText(diff, maxBytes, `GET /api/tasks/${taskId}/diff for the full diff`),
      );
    }
    case "fleet_decide": {
      const taskId = asString(args["taskId"], "taskId");
      const decision = args["decision"];
      if (decision !== "accept" && decision !== "rework" && decision !== "abandon")
        throw new McpError('decision must be "accept", "rework", or "abandon"');
      const notes = optionalString(args["notes"], "notes") ?? "";
      await engine.decide(taskId, decision, notes === "" ? undefined : notes);
      try {
        ctx.notify?.(taskId);
      } catch {
        // Wake-up failures never fail the decision itself.
      }
      return textResult(
        boundText(
          `task ${taskId}: ${decision} recorded in the mission log`,
          MCP_DEFAULT_MAX_BYTES,
          "fleet_mission_get for the mission state after this decision",
        ),
      );
    }
    case "fleet_wait": {
      const missionId = asString(args["missionId"], "missionId");
      const timeoutRaw = args["timeoutSec"] ?? 60;
      if (typeof timeoutRaw !== "number" || !Number.isFinite(timeoutRaw) || timeoutRaw < 1)
        throw new McpError("timeoutSec must be at least 1");
      if (timeoutRaw > 600) throw new McpError("timeoutSec is at most 600");
      const deadline = Date.now() + Math.floor(timeoutRaw * 1000);
      const before = snapshotOf(
        engine.listMissionIds().map((id) => engine.getMission(id).mission),
        (id) => engine.getMission(id).tasks,
      );
      void engine.getMission(missionId);
      const started = Date.now();
      for (;;) {
        await sleep(WAIT_POLL_MS);
        const after = snapshotOf(
          engine.listMissionIds().map((id) => engine.getMission(id).mission),
          (id) => engine.getMission(id).tasks,
        );
        if (after !== before) {
          const status = engine.getMission(missionId).mission.status;
          return textResult(
            `mission ${missionId}: changed after ${Date.now() - started}ms; status=${status}\nFull data: fleet_mission_get for ${missionId}`,
          );
        }
        if (Date.now() >= deadline) {
          const status = engine.getMission(missionId).mission.status;
          return textResult(
            `mission ${missionId}: no change within ${timeoutRaw}s; status=${status}\nFull data: fleet_mission_get for ${missionId}`,
          );
        }
      }
    }
    case "fleet_mission_close": {
      const missionId = asString(args["missionId"], "missionId");
      const summary = asString(args["summary"], "summary");
      await engine.closeMission(missionId, "done");
      await engine.recordReport(missionId, summary);
      return textResult(
        `mission ${missionId} closed done; report stored in the decision log\nFull data: GET /api/missions/${missionId} for the closed mission`,
      );
    }
    default:
      throw new McpError(`unknown tool ${JSON.stringify(name)}`);
  }
}

function jsonResponse(status: number, body: unknown): McpHttpResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * One Streamable-HTTP exchange. Authentication is checked before any
 * parsing: a missing or wrong bearer token is 401 and the engine is
 * never touched.
 */
export async function handleMcpHttp(
  ctx: McpContext,
  req: McpHttpRequest,
): Promise<McpHttpResponse> {
  if (req.method !== "POST")
    return { status: 405, headers: { allow: "POST" }, body: "method not allowed" };
  if (bearerOf(req.headers) === undefined || !tokensEqual(bearerOf(req.headers)!, ctx.token)) {
    return {
      status: 401,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "missing or invalid fleet token" }),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.bodyText) as unknown;
  } catch {
    return jsonResponse(400, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "invalid JSON" },
    });
  }
  const body = asRecordLoose(parsed);
  if (body === undefined)
    return jsonResponse(400, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "invalid JSON-RPC envelope" },
    });
  const id = (body["id"] ?? null) as unknown;
  const method = body["method"];
  if (body["jsonrpc"] !== "2.0" || typeof method !== "string")
    return jsonResponse(400, {
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "invalid JSON-RPC envelope" },
    });
  if (method === "initialize") {
    return jsonResponse(200, {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fleet", version: "stage-1d" },
      },
    });
  }
  if (method === "notifications/initialized") {
    return { status: 202, headers: { "content-type": "application/json" }, body: "{}" };
  }
  if (method === "tools/list") {
    return jsonResponse(200, { jsonrpc: "2.0", id, result: { tools: TOOL_DEFS } });
  }
  if (method === "tools/call") {
    let params: Record<string, unknown>;
    try {
      params = asRecord(body["params"], "params");
    } catch (err) {
      return jsonResponse(200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: (err as Error).message },
      });
    }
    const toolName = params["name"];
    if (typeof toolName !== "string")
      return jsonResponse(200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "tool name is required" },
      });
    if (!toolNames().includes(toolName))
      return jsonResponse(200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `unknown tool ${JSON.stringify(toolName)}` },
      });
    let toolArgs: Record<string, unknown>;
    try {
      toolArgs =
        params["arguments"] === undefined ? {} : asRecord(params["arguments"], "arguments");
    } catch (err) {
      return jsonResponse(200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: (err as Error).message },
      });
    }
    try {
      const result = await callTool(ctx, toolName, toolArgs);
      return jsonResponse(200, { jsonrpc: "2.0", id, result });
    } catch (err) {
      if (
        err instanceof EngineError ||
        err instanceof PlanError ||
        err instanceof McpError ||
        err instanceof DagError
      )
        return jsonResponse(200, { jsonrpc: "2.0", id, result: errorResult(err.message) });
      throw err;
    }
  }
  return jsonResponse(200, {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `unknown method ${JSON.stringify(method)}` },
  });
}

function asRecordLoose(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
