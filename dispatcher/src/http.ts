import path from "node:path";
import {
  clearedSessionCookieHeader,
  roleAtLeast,
  sessionCookieHeader,
  sessionTokenFrom,
  type Account,
  type Role,
  type Session,
  type SessionStore,
} from "./auth.js";
import { correlatedSession, ensureDirectorSession } from "./director.js";
import { Engine, type RepoRegistry } from "./engine.js";
import type { FleetConfig } from "./fleet-schema.js";
import { MissionStatuses, TaskStatuses, type Mission, type Task } from "./model.js";
import { McpError, filterDiff, handleMcpHttp, parsePlanTasks } from "./mcp.js";
import { OpenCodeClient } from "./opencode.js";
import { PlanError } from "./plan.js";
import { messageText } from "./runner.js";

/**
 * Authenticated REST and SSE control plane (Stage 1d, Step 2). Every
 * route except `GET /healthz` and `POST /api/auth/login` requires a
 * session (cookie or Bearer). Roles: viewer reads; approver also
 * approves, rejects, cancels, edits waiting plans, and decides; admin
 * also runs GC.
 */

export interface HttpHealthChecks {
  storeOpen(): void;
  verifyAudit(): Promise<{ ok: boolean; reason?: string }>;
  assertContracts(): Promise<void>;
}

export interface HttpDeps {
  engine: Engine;
  fleet: FleetConfig;
  clients: Map<string, OpenCodeClient>;
  registries: Map<string, RepoRegistry>;
  defaultRepo: string;
  accounts: Map<string, Account>;
  sessions: SessionStore;
  mcpToken: string;
  artifactsRoot: string;
  workspaceRoot: string;
  health: HttpHealthChecks;
  directorLocation: (mission: Mission) => string;
  /** Stage 1d wake-up: called with the task id after a successful decide. */
  notify?: (taskId: string) => void;
  /** Stage 1e: directory holding the built web UI (`dispatcher/dist/web`). */
  webRoot?: string;
}

const REST_DIFF_DEFAULT_BYTES = 65536;
const REST_DIFF_MAX_BYTES = 1048576;
const CHAT_MESSAGE_MAX = 20000;

function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

function engineStatus(err: unknown): number {
  const message = (err as Error).message;
  if (/^unknown (mission|task|repository|expert)/.test(message)) return 404;
  if (
    /is not (planning|waiting|running)|already started|frozen|nothing to|never ran|needs notes/.test(
      message,
    )
  )
    return 409;
  return 400;
}

function findTask(deps: HttpDeps, taskId: string): Task | undefined {
  for (const id of deps.engine.listMissionIds()) {
    const found = deps.engine.getMission(id).tasks.find((t) => t.id === taskId);
    if (found !== undefined) return found;
  }
  return undefined;
}

function taskSummary(t: Task): Record<string, unknown> {
  return {
    id: t.id,
    missionId: t.missionId,
    repo: t.repo,
    title: t.title,
    kind: t.kind,
    role: t.role,
    expert: t.expert ?? null,
    deps: t.deps,
    trigger: t.trigger,
    status: t.status,
    attempts: t.attempts,
    reason: t.reason ?? null,
    branch: t.branch ?? null,
    worktree: t.worktree ?? null,
    headSha: t.headSha ?? null,
    landedSha: t.landedSha ?? null,
    result: t.result ?? null,
  };
}

function missionSummary(deps: HttpDeps, mission: Mission): Record<string, unknown> {
  const tasks = deps.engine.getMission(mission.id).tasks;
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
  return {
    id: mission.id,
    repo: mission.repo,
    objective: mission.objective,
    status: mission.status,
    source: mission.source,
    integrationBranch: mission.integrationBranch,
    directorSessionId: mission.directorSessionId ?? null,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    taskCounts: counts,
  };
}

function sseResponse(
  signal: AbortSignal,
  pump: (send: (data: string, event?: string) => void) => Promise<void>,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (data: string, event?: string): void => {
        try {
          controller.enqueue(
            enc.encode(
              `${event !== undefined ? `event: ${event}\n` : ""}${data
                .split("\n")
                .map((l) => `data: ${l}`)
                .join("\n")}\n\n`,
            ),
          );
        } catch {
          // The client went away; the pump observes the abort signal.
        }
      };
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          // The client went away; cleared below.
        }
      }, 15000);
      signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
      try {
        await pump(send);
      } catch {
        // Pump failures end the stream; the last event already explains them.
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      // Client disconnect; the abort listener above closes the stream.
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function probeHealth(client: OpenCodeClient): Promise<string> {
  try {
    await Promise.race([
      client.info(),
      sleep(5000).then(() => {
        throw new Error("health probe timed out");
      }),
    ]);
    return "healthy";
  } catch (err) {
    return `unreachable: ${(err as Error).message}`;
  }
}

export function createHandler(deps: HttpDeps): (req: Request) => Promise<Response> {
  const { engine } = deps;

  async function authenticated(req: Request, minimum: Role): Promise<Session | Response> {
    const token = sessionTokenFrom(req.headers);
    const session = token === undefined ? undefined : deps.sessions.lookup(token);
    if (session === undefined)
      return json(401, { error: "unauthenticated: log in at POST /api/auth/login" });
    if (!roleAtLeast(session.role, minimum))
      return json(403, { error: `role ${session.role} cannot perform this action` });
    return session;
  }

  async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
    try {
      return { ok: true, body: (await req.json()) as unknown };
    } catch {
      return { ok: false };
    }
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    if (pathname === "/mcp") {
      const out = await handleMcpHttp(
        {
          token: deps.mcpToken,
          engine,
          fleet: deps.fleet,
          clients: deps.clients,
          registries: deps.registries,
          defaultRepo: deps.defaultRepo,
          notify: deps.notify,
        },
        { method, headers: req.headers, bodyText: await req.text() },
      );
      return new Response(out.body, { status: out.status, headers: out.headers });
    }

    if (method === "GET" && pathname === "/healthz") {
      try {
        deps.health.storeOpen();
      } catch {
        return json(503, { ok: false, reason: "store is not open" });
      }
      const audit = await deps.health.verifyAudit().catch((err: Error) => ({
        ok: false as const,
        reason: err.message,
      }));
      if (!audit.ok) return json(503, { ok: false, reason: audit.reason ?? "audit log failed" });
      try {
        await deps.health.assertContracts();
      } catch (err) {
        return json(503, { ok: false, reason: (err as Error).message });
      }
      return json(200, { ok: true });
    }

    if (method === "POST" && pathname === "/api/auth/login") {
      const parsed = await readJson(req);
      if (!parsed.ok) return json(400, { error: "request body must be JSON" });
      const body = (parsed.body ?? {}) as Record<string, unknown>;
      const username = typeof body["username"] === "string" ? body["username"] : "";
      const password = typeof body["password"] === "string" ? body["password"] : "";
      const account = deps.accounts.get(username);
      let verified = false;
      if (account !== undefined) {
        try {
          verified = await Bun.password.verify(password, account.passwordHash);
        } catch {
          verified = false;
        }
      }
      if (account === undefined || !verified)
        return json(401, { error: "invalid username or password" });
      const session = deps.sessions.issue(account);
      return json(
        200,
        { username: session.username, role: session.role, token: session.token },
        { "set-cookie": sessionCookieHeader(session.token) },
      );
    }

    const gate = (minimum: Role): Promise<Session | Response> => authenticated(req, minimum);

    if (method === "POST" && pathname === "/api/auth/logout") {
      const auth = await gate("viewer");
      if (auth instanceof Response) return auth;
      const token = sessionTokenFrom(req.headers);
      if (token !== undefined) deps.sessions.revoke(token);
      return json(200, { ok: true }, { "set-cookie": clearedSessionCookieHeader() });
    }

    if (method === "GET" && pathname === "/api/auth/me") {
      const auth = await gate("viewer");
      if (auth instanceof Response) return auth;
      return json(200, { username: auth.username, role: auth.role });
    }

    if (method === "GET" && pathname === "/api/fleet") {
      const auth = await gate("viewer");
      if (auth instanceof Response) return auth;
      const entries = await Promise.all(
        Object.entries(deps.fleet.experts)
          .filter(([, e]) => e.enabled)
          .map(async ([name, expert]) => {
            const client = deps.clients.get(name);
            let load = 0;
            for (const id of engine.listMissionIds()) {
              for (const t of engine.getMission(id).tasks) {
                if (t.expert === name && t.status === TaskStatuses.running) load += 1;
              }
            }
            return {
              name,
              description: expert.description,
              handles: expert.handles,
              delegates: expert.delegates,
              access: expert.access,
              health: client === undefined ? "no client" : await probeHealth(client),
              load,
            };
          }),
      );
      return json(200, { experts: entries });
    }

    if (pathname === "/api/missions" && (method === "GET" || method === "POST")) {
      if (method === "GET") {
        const auth = await gate("viewer");
        if (auth instanceof Response) return auth;
        return json(200, {
          missions: engine
            .listMissionIds()
            .map((id) => missionSummary(deps, engine.getMission(id).mission)),
        });
      }
      const auth = await gate("approver");
      if (auth instanceof Response) return auth;
      const parsed = await readJson(req);
      if (!parsed.ok) return json(400, { error: "request body must be JSON" });
      const body = (parsed.body ?? {}) as Record<string, unknown>;
      const objective = typeof body["objective"] === "string" ? body["objective"].trim() : "";
      if (objective === "") return json(400, { error: "objective is required" });
      const repo =
        typeof body["repo"] === "string" && body["repo"].trim() !== ""
          ? body["repo"].trim()
          : deps.defaultRepo;
      try {
        const mission = await engine.createMission({
          repo,
          source: "api",
          playbook: "director",
          objective,
        });
        return json(201, { id: mission.id, status: mission.status });
      } catch (err) {
        return json(engineStatus(err), { error: (err as Error).message });
      }
    }

    const missionMatch = /^\/api\/missions\/([^/]+)(\/.*)?$/.exec(pathname);
    if (missionMatch?.[1] !== undefined) {
      const missionId = decodeURIComponent(missionMatch[1]);
      const rest = missionMatch[2] ?? "";

      if (rest === "" && method === "GET") {
        const auth = await gate("viewer");
        if (auth instanceof Response) return auth;
        try {
          const view = engine.getMission(missionId);
          return json(200, {
            mission: missionSummary(deps, view.mission),
            plan: view.mission.plan,
            tasks: view.tasks.map(taskSummary),
            decisions: engine.listDecisions(missionId),
          });
        } catch (err) {
          return json(engineStatus(err), { error: (err as Error).message });
        }
      }

      if (rest === "/events" && method === "GET") {
        const auth = await gate("viewer");
        if (auth instanceof Response) return auth;
        try {
          engine.getMission(missionId);
        } catch (err) {
          return json(engineStatus(err), { error: (err as Error).message });
        }
        const signal = req.signal;
        return sseResponse(signal, async (send) => {
          let last = "";
          for (;;) {
            if (signal.aborted) return;
            const view = engine.getMission(missionId);
            const frame = JSON.stringify({
              mission: view.mission.status,
              tasks: view.tasks.map((t) => ({
                id: t.id,
                status: t.status,
                reason: t.reason ?? null,
              })),
              decisions: engine.listDecisions(missionId).length,
            });
            if (frame !== last) {
              send(frame, "mission");
              last = frame;
            }
            await sleep(500);
          }
        });
      }

      if ((rest === "/approve" || rest === "/reject" || rest === "/cancel") && method === "POST") {
        const auth = await gate("approver");
        if (auth instanceof Response) return auth;
        try {
          if (rest === "/approve") await engine.approve(missionId);
          else if (rest === "/cancel") await engine.cancel(missionId);
          else {
            const parsed = await readJson(req);
            const reason =
              parsed.ok && typeof (parsed.body as Record<string, unknown>)["reason"] === "string"
                ? ((parsed.body as Record<string, unknown>)["reason"] as string)
                : "";
            await engine.reject(missionId, reason);
          }
          return json(200, { id: missionId, status: engine.getMission(missionId).mission.status });
        } catch (err) {
          return json(engineStatus(err), { error: (err as Error).message });
        }
      }

      if (rest === "/plan" && method === "PUT") {
        const auth = await gate("approver");
        if (auth instanceof Response) return auth;
        const parsed = await readJson(req);
        if (!parsed.ok) return json(400, { error: "request body must be JSON" });
        const tasksRaw = (parsed.body as Record<string, unknown>)["tasks"];
        try {
          const tasks = parsePlanTasks(tasksRaw);
          const expanded = await engine.updatePlan(missionId, tasks);
          return json(200, {
            id: missionId,
            status: engine.getMission(missionId).mission.status,
            tasks: expanded.map((t) => t.id),
          });
        } catch (err) {
          if (err instanceof PlanError || err instanceof McpError)
            return json(400, { error: (err as Error).message });
          return json(engineStatus(err), { error: (err as Error).message });
        }
      }

      if (rest === "/chat" && (method === "POST" || method === "GET")) {
        const auth = await gate("viewer");
        if (auth instanceof Response) return auth;
        let mission: Mission;
        try {
          mission = engine.getMission(missionId).mission;
        } catch (err) {
          return json(engineStatus(err), { error: (err as Error).message });
        }
        const director = deps.clients.get("director");
        if (director === undefined) return json(503, { error: "no director client" });
        if (method === "POST") {
          const parsed = await readJson(req);
          if (!parsed.ok) return json(400, { error: "request body must be JSON" });
          const message =
            typeof (parsed.body as Record<string, unknown>)["message"] === "string"
              ? ((parsed.body as Record<string, unknown>)["message"] as string)
              : "";
          if (message.trim() === "") return json(400, { error: "message is required" });
          if (message.length > CHAT_MESSAGE_MAX)
            return json(400, { error: `message exceeds ${CHAT_MESSAGE_MAX} characters` });
          try {
            const sessionId = await ensureDirectorSession(
              engine,
              { director },
              missionId,
              deps.directorLocation(mission),
            );
            await director.prompt(sessionId, message);
            return json(200, { ok: true, sessionId });
          } catch (err) {
            return json(502, { error: `director unreachable: ${(err as Error).message}` });
          }
        }
        const sessionId = correlatedSession(engine, missionId);
        if (sessionId === undefined) return json(200, { sessionId: null, messages: [] });
        try {
          const messages = await director.messages(sessionId);
          const formatted = messages.slice(-500).map((m, i) => ({
            id: typeof m["id"] === "string" ? m["id"] : `message-${i}`,
            role: typeof m["role"] === "string" ? m["role"] : "unknown",
            text: messageText(m as { content?: unknown; parts?: unknown; text?: unknown }),
          }));
          return json(200, { sessionId, messages: formatted });
        } catch (err) {
          return json(502, { error: `director unreachable: ${(err as Error).message}` });
        }
      }

      if (rest === "/chat/events" && method === "GET") {
        const auth = await gate("viewer");
        if (auth instanceof Response) return auth;
        try {
          engine.getMission(missionId);
        } catch (err) {
          return json(engineStatus(err), { error: (err as Error).message });
        }
        const sessionId = correlatedSession(engine, missionId);
        if (sessionId === undefined)
          return json(404, { error: "mission has no director session yet" });
        const director = deps.clients.get("director");
        if (director === undefined) return json(503, { error: "no director client" });
        const signal = req.signal;
        return sseResponse(signal, async (send) => {
          let seen = -1;
          for (;;) {
            if (signal.aborted) return;
            let messages: { id?: unknown; role?: unknown }[];
            try {
              messages = await director.messages(sessionId);
            } catch (err) {
              send(JSON.stringify({ error: (err as Error).message }), "error");
              return;
            }
            if (seen === -1) {
              send(JSON.stringify({ count: messages.length }), "sync");
              const tail = messages.slice(-5);
              for (const m of tail) {
                send(
                  JSON.stringify({
                    id: typeof m["id"] === "string" ? m["id"] : null,
                    role: typeof m["role"] === "string" ? m["role"] : "unknown",
                    text: messageText(m as { content?: unknown; parts?: unknown; text?: unknown }),
                  }),
                  "message",
                );
              }
              seen = messages.length;
            } else if (messages.length > seen) {
              for (const m of messages.slice(seen)) {
                send(
                  JSON.stringify({
                    id: typeof m["id"] === "string" ? m["id"] : null,
                    role: typeof m["role"] === "string" ? m["role"] : "unknown",
                    text: messageText(m as { content?: unknown; parts?: unknown; text?: unknown }),
                  }),
                  "message",
                );
              }
              seen = messages.length;
            }
            await sleep(1000);
          }
        });
      }
    }

    const taskMatch = /^\/api\/tasks\/([^/]+)(\/.*)?$/.exec(pathname);
    if (taskMatch?.[1] !== undefined) {
      const taskId = decodeURIComponent(taskMatch[1]);
      const rest = taskMatch[2] ?? "";

      if (rest === "" && method === "GET") {
        const auth = await gate("viewer");
        if (auth instanceof Response) return auth;
        const task = findTask(deps, taskId);
        if (task === undefined) return json(404, { error: `unknown task ${taskId}` });
        return json(200, { task: taskSummary(task) });
      }

      if (rest === "/diff" && method === "GET") {
        const auth = await gate("viewer");
        if (auth instanceof Response) return auth;
        if (findTask(deps, taskId) === undefined)
          return json(404, { error: `unknown task ${taskId}` });
        const file = url.searchParams.get("file") ?? undefined;
        const maxBytes = parseBoundedInt(
          url.searchParams.get("maxBytes"),
          REST_DIFF_DEFAULT_BYTES,
          REST_DIFF_MAX_BYTES,
        );
        if (maxBytes === undefined)
          return json(400, { error: "maxBytes must be a positive integer" });
        try {
          let diff = await engine.taskDiff(taskId);
          if (file !== undefined) {
            const scoped = filterDiff(diff, file);
            if (scoped === undefined)
              return json(404, { error: `no diff for file ${JSON.stringify(file)}` });
            diff = scoped;
          }
          const encoded = new TextEncoder().encode(diff);
          const truncated = encoded.length > maxBytes;
          const body = truncated ? new TextDecoder().decode(encoded.slice(0, maxBytes)) : diff;
          return json(200, { taskId, file: file ?? null, diff: body, truncated });
        } catch (err) {
          return json(engineStatus(err), { error: (err as Error).message });
        }
      }

      if (rest === "/decide" && method === "POST") {
        const auth = await gate("approver");
        if (auth instanceof Response) return auth;
        const parsed = await readJson(req);
        if (!parsed.ok) return json(400, { error: "request body must be JSON" });
        const body = (parsed.body ?? {}) as Record<string, unknown>;
        const decision = body["decision"];
        if (decision !== "accept" && decision !== "rework" && decision !== "abandon")
          return json(400, { error: 'decision must be "accept", "rework", or "abandon"' });
        const notes = typeof body["notes"] === "string" ? body["notes"] : undefined;
        try {
          await engine.decide(taskId, decision, notes);
          try {
            deps.notify?.(taskId);
          } catch {
            // Wake-up failures never fail the decision itself.
          }
          return json(200, { taskId, decision });
        } catch (err) {
          return json(engineStatus(err), { error: (err as Error).message });
        }
      }

      if ((rest === "/artifacts" || rest.startsWith("/artifacts/")) && method === "GET") {
        const auth = await gate("viewer");
        if (auth instanceof Response) return auth;
        const task = findTask(deps, taskId);
        if (task === undefined) return json(404, { error: `unknown task ${taskId}` });
        if (/%2e/i.test(pathname)) return json(403, { error: "path traversal refused" });
        const rel = rest === "/artifacts" ? "" : rest.slice("/artifacts/".length);
        if (rel === "") return json(404, { error: "artifact path is required" });
        const decoded = rel.split("/").map((s) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return null;
          }
        });
        if (
          decoded.some(
            (s) => s === null || s === "" || s === "." || s === ".." || path.isAbsolute(s!),
          )
        )
          return json(403, { error: "path traversal refused" });
        const base = path.resolve(deps.artifactsRoot, taskId);
        const target = path.resolve(base, ...(decoded as string[]));
        if (target !== base && !target.startsWith(base + path.sep))
          return json(403, { error: "path traversal refused" });
        const file = Bun.file(target);
        if (!(await file.exists())) return json(404, { error: "artifact not found" });
        return new Response(file, {
          headers: { "content-type": file.type || "application/octet-stream" },
        });
      }
    }

    if (method === "POST" && pathname === "/api/gc") {
      const auth = await gate("admin");
      if (auth instanceof Response) return auth;
      const out = await engine.gc();
      return json(200, out);
    }

    if (method === "GET" && pathname === "/api/usage") {
      const auth = await gate("viewer");
      if (auth instanceof Response) return auth;
      let runningMissions = 0;
      let waitingHuman = 0;
      for (const id of engine.listMissionIds()) {
        const status = engine.getMission(id).mission.status;
        if (status === MissionStatuses.running || status === MissionStatuses.planning)
          runningMissions += 1;
        if (status === MissionStatuses.waitingHuman || status === MissionStatuses.halted)
          waitingHuman += 1;
      }
      return json(200, {
        runningMissions,
        waitingHuman,
        maxConcurrent: deps.fleet.defaults.maxConcurrent,
        note: "mission headroom against the fleet concurrency cap; the Go dollar ledger lands in stage 3b",
      });
    }

    if (
      (method === "GET" || method === "HEAD") &&
      !pathname.startsWith("/api/") &&
      pathname !== "/mcp" &&
      pathname !== "/healthz"
    ) {
      return serveWeb(deps.webRoot ?? defaultWebRoot(), pathname, method);
    }

    return json(404, { error: "not found" });
  };
}

const WEB_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function defaultWebRoot(): string {
  return new URL("../dist/web", import.meta.url).pathname;
}

/**
 * Serve the built web UI (Stage 1e). Extensionless SPA routes fall back
 * to `index.html`; anything else missing is a JSON 404. Path traversal
 * is refused. When no build is present, behave as before (JSON 404) so
 * API-only deployments and existing tests are unaffected.
 */
async function serveWeb(webRoot: string, pathname: string, method: string): Promise<Response> {
  if (/%2e/i.test(pathname)) return json(403, { error: "path traversal refused" });
  const decoded = pathname.split("/").map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  });
  if (decoded.some((s) => s === null || s === "." || s === "..")) {
    return json(403, { error: "path traversal refused" });
  }
  const base = path.resolve(webRoot);
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(base, rel);
  if (target !== base && !target.startsWith(base + path.sep)) {
    return json(403, { error: "path traversal refused" });
  }
  const file = Bun.file(target);
  if (await file.exists()) {
    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "content-type": contentTypeFor(target) },
      });
    }
    return new Response(file, {
      headers: { "content-type": contentTypeFor(target) },
    });
  }
  if (path.extname(target) !== "") return json(404, { error: "not found" });
  const index = Bun.file(path.join(base, "index.html"));
  if (!(await index.exists())) return json(404, { error: "not found" });
  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response(index, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function contentTypeFor(target: string): string {
  return WEB_CONTENT_TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream";
}

function parseBoundedInt(raw: string | null, fallback: number, max: number): number | undefined {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return undefined;
  return Math.min(value, max);
}

/** Serve the control plane on a port. Port 0 picks an ephemeral port for tests. */
export async function serveHttp(
  deps: HttpDeps & { port: number; hostname?: string },
): Promise<{ url: string; close: () => Promise<void> }> {
  const handler = createHandler(deps);
  const server = Bun.serve({
    port: deps.port,
    hostname: deps.hostname ?? "127.0.0.1",
    fetch: (req) => handler(req),
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    close: async () => {
      server.stop(true);
    },
  };
}
