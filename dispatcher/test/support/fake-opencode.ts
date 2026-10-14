/**
 * Scripted fake OpenCode v2 server. Every later Dispatcher test depends on
 * it, so it behaves like the real thing where it matters:
 *
 * - Basic auth (user `opencode`); without it, 401. JSON wrapped in `{data}`.
 * - Sessions follow a script: rules with a prompt matcher and steps. Step
 *   types: `write` a file, `commit`, `message`, `permission` (raise a request
 *   and wait for the reply), `error`, `delay`, `hang`.
 * - `write` and `commit` really happen in the session's `location.directory`,
 *   so worktree, diff, policy, and landing code run against real git state.
 * - `wait` blocks until the session's script has finished. `diff` returns the
 *   real git diff. Events stream on `GET /api/event` as SSE.
 * - Every request is recorded for assertions.
 * - Startup self-check compares the route table with the real
 *   `openapi.json` from `review/opencode`: every served method+path must
 *   exist in the spec. (`GET /openapi.json` serves the spec file itself and
 *   is the one exempt route; see build-notes "Proposed corrections".)
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { checkOperationsAgainstSpec, type OpenCodeOperation } from "../../src/opencode.js";

export type FakeStep =
  | { kind: "write"; path: string; content: string }
  | { kind: "commit"; message: string }
  | { kind: "message"; role: string; content: string }
  | { kind: "permission"; tool: string; detail?: string }
  | { kind: "error"; message: string; status?: number }
  | { kind: "delay"; ms: number }
  | { kind: "hang" };

export interface FakeRule {
  /** Substring matched against the prompt text. Absent: matches everything. */
  matchPrompt?: string;
  steps: FakeStep[];
}

export interface FakeScript {
  rules: FakeRule[];
  defaultSteps?: FakeStep[];
}

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

interface TranscriptMessage {
  id: string;
  role: string;
  content: string;
  at: string;
}

interface PendingPermission {
  requestID: string;
  tool: string;
  detail: string;
  status: "pending" | "decided";
  decision?: string;
  decidedNote?: string;
}

interface Session {
  id: string;
  title: string;
  agent: string;
  directory: string;
  permissions: unknown;
  metadata: unknown;
  transcript: TranscriptMessage[];
  pending: PendingPermission[];
  env: Record<string, string>;
  busy: boolean;
  done: boolean;
  error?: { message: string; status: number };
  waiters: number;
}

export interface FakeRoute {
  method: string;
  /** `:param` segments match one path segment. */
  pattern: string;
  /** True only for GET /openapi.json, which serves the spec, not an operation. */
  exemptFromSpec?: boolean;
}

export const FAKE_ROUTES: FakeRoute[] = [
  { method: "GET", pattern: "/api/info" },
  { method: "GET", pattern: "/openapi.json", exemptFromSpec: true },
  { method: "POST", pattern: "/api/session" },
  { method: "GET", pattern: "/api/session/:sessionID" },
  { method: "DELETE", pattern: "/api/session/:sessionID" },
  { method: "POST", pattern: "/api/session/:sessionID/prompt" },
  { method: "POST", pattern: "/api/experimental/session/:sessionID/wait" },
  { method: "POST", pattern: "/api/session/:sessionID/interrupt" },
  { method: "GET", pattern: "/api/session/:sessionID/message" },
  { method: "GET", pattern: "/api/session/:sessionID/diff" },
  { method: "GET", pattern: "/api/session/:sessionID/permission" },
  { method: "POST", pattern: "/api/session/:sessionID/permission/:requestID/reply" },
  { method: "PUT", pattern: "/api/session/:sessionID/environment" },
  { method: "GET", pattern: "/api/event" },
];

interface OpenApiSpec {
  paths: Record<string, Record<string, unknown>>;
}

/** Paths the upstream review clone may live at, first hit wins. */
export function specCandidates(): string[] {
  const here = import.meta.dir;
  const root = path.resolve(here, "..", "..", "..");
  const over = process.env["OPENCODE_SPEC_PATH"];
  const list = [
    path.join(root, "review", "opencode", "packages", "protocol", "openapi.json"),
    // Inside a git worktree, the reference clones live beside the main checkout.
    path.join(root, "..", "..", "review", "opencode", "packages", "protocol", "openapi.json"),
  ];
  return over ? [over, ...list] : list;
}

export async function loadOpenApiSpec(): Promise<{ spec: OpenApiSpec; path: string }> {
  const tried: string[] = [];
  for (const candidate of specCandidates()) {
    tried.push(candidate);
    try {
      const text = await readFile(candidate, "utf8");
      return { spec: JSON.parse(text) as OpenApiSpec, path: candidate };
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`fake-opencode: openapi.json not found; tried ${tried.join(", ")}`);
}

function patternMatches(pattern: string, pathname: string): Record<string, string> | null {
  const p = pattern.split("/");
  const u = pathname.split("/");
  if (p.length !== u.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(":")) params[p[i]!.slice(1)] = decodeURIComponent(u[i]!);
    else if (p[i] !== u[i]) return null;
  }
  return params;
}

/**
 * Every served route must exist in the spec: same segment shape
 * (spec `{param}` segments match any single segment) with the same method.
 * Returns the missing routes, empty when the routes match the spec.
 * Delegates to the client's table so the two cannot drift apart.
 */
export function checkRoutesAgainstOpenApi(routes: FakeRoute[], spec: OpenApiSpec): string[] {
  const ops: OpenCodeOperation[] = routes
    .filter((r) => !r.exemptFromSpec)
    .map((r) => ({
      method: r.method,
      path: r.pattern.replace(/:([^/]+)/g, "{$1}"),
    }));
  return checkOperationsAgainstSpec(ops, spec);
}

/** The fake's own route table against the spec. */
export function checkFakeRoutesAgainstOpenApi(spec: OpenApiSpec): string[] {
  return checkRoutesAgainstOpenApi(FAKE_ROUTES, spec);
}

export interface FakeOptions {
  password?: string;
  script?: FakeScript;
  /**
   * Drop every SSE stream after this many broadcasts (Stage 1c: proves the
   * client's subscription reconnects). Once only; later streams stay open.
   */
  sseDropAfter?: number;
}

export interface FakeOpenCode {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function gitDiff(
  directory: string,
): Promise<
  { file: string; patch: string; additions: number; deletions: number; status: string }[]
> {
  const run = (args: string[]): Promise<string> =>
    new Promise((resolve, reject) => {
      const proc = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" });
      void (async () => {
        const out = await new Response(proc.stdout).text();
        const err = await new Response(proc.stderr).text();
        const code = await proc.exited;
        if (code !== 0)
          reject(new Error(err.trim().slice(0, 300) || `git ${args.join(" ")} failed`));
        else resolve(out);
      })();
    });
  const porcelain = await run(["status", "--porcelain", "-z"]);
  const statusByFile = new Map<string, string>();
  for (const entry of porcelain.split("\0")) {
    if (!entry) continue;
    const code = entry.slice(0, 2);
    const file = entry.slice(3).trim();
    statusByFile.set(
      file,
      code.includes("?") ? "untracked" : code.includes("A") ? "added" : "modified",
    );
  }
  let numstat = "";
  try {
    numstat = await run(["diff", "HEAD", "--numstat", "-z"]);
  } catch {
    return [...statusByFile].map(([file, status]) => ({
      file,
      patch: "",
      additions: 0,
      deletions: 0,
      status,
    }));
  }
  const counts = new Map<string, { additions: number; deletions: number }>();
  const parts = numstat.split("\0").filter((p) => p.length > 0);
  for (let i = 0; i + 2 < parts.length + 1; i += 3) {
    const add = parts[i];
    const del = parts[i + 1];
    const file = parts[i + 2];
    if (add === undefined || del === undefined || file === undefined) break;
    counts.set(file, { additions: Number(add) || 0, deletions: Number(del) || 0 });
  }
  const out: {
    file: string;
    patch: string;
    additions: number;
    deletions: number;
    status: string;
  }[] = [];
  for (const [file, status] of statusByFile) {
    let patch = "";
    try {
      patch = await run(["diff", "HEAD", "--", file]);
    } catch {
      patch = "";
    }
    const c = counts.get(file) ?? { additions: 0, deletions: 0 };
    out.push({ file, patch, additions: c.additions, deletions: c.deletions, status });
  }
  return out;
}

export async function startFakeOpenCode(options: FakeOptions = {}): Promise<FakeOpenCode> {
  const password = options.password ?? "test-password";
  const script: FakeScript = options.script ?? { rules: [] };
  const { spec } = await loadOpenApiSpec();
  const missing = checkFakeRoutesAgainstOpenApi(spec);
  if (missing.length > 0)
    throw new Error(`fake-opencode serves routes missing from openapi.json: ${missing.join(", ")}`);
  let specText = "{}";
  try {
    specText = JSON.stringify(spec);
  } catch {
    specText = "{}";
  }

  const requests: RecordedRequest[] = [];
  const sessions = new Map<string, Session>();
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  let seq = 0;
  let inboxSeq = 0;
  let reqSeq = 0;

  const expectedAuth = `Basic ${btoa(`opencode:${password}`)}`;
  const dropAfter = options.sseDropAfter;
  let broadcasts = 0;
  let dropped = false;

  function dropStreams(): void {
    dropped = true;
    for (const controller of streams) {
      streams.delete(controller);
      try {
        controller.close();
      } catch {
        // already gone
      }
    }
  }

  function broadcast(event: unknown): void {
    broadcasts += 1;
    if (dropAfter !== undefined && !dropped && broadcasts >= dropAfter) dropStreams();
    const line = encoder.encode(`id: evt-${broadcasts}\ndata: ${JSON.stringify(event)}\n\n`);
    for (const controller of streams) {
      try {
        controller.enqueue(line);
      } catch {
        // closed stream; removed on cancel
      }
    }
  }

  async function gitCommit(directory: string, message: string): Promise<void> {
    const proc = Bun.spawn(
      ["git", "-c", "user.email=fake@agency", "-c", "user.name=fake", "add", "-A"],
      {
        cwd: directory,
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    const addErr = await new Response(proc.stderr).text();
    if ((await proc.exited) !== 0) throw new Error(`fake git add failed: ${addErr.slice(0, 200)}`);
    const commit = Bun.spawn(
      ["git", "-c", "user.email=fake@agency", "-c", "user.name=fake", "commit", "-m", message],
      { cwd: directory, stdout: "ignore", stderr: "pipe" },
    );
    const commitErr = await new Response(commit.stderr).text();
    if ((await commit.exited) !== 0)
      throw new Error(`fake git commit failed: ${commitErr.slice(0, 200)}`);
  }

  async function runSteps(session: Session, steps: FakeStep[]): Promise<void> {
    session.busy = true;
    try {
      for (const step of steps) {
        if (step.kind === "write") {
          // Relative paths land in the session directory (the worktree).
          // Absolute paths simulate the expert writing to /artifacts/<taskId>/.
          const target = step.path.startsWith("/")
            ? step.path
            : path.join(session.directory, step.path);
          await mkdir(path.dirname(target), { recursive: true });
          await Bun.write(target, step.content);
          broadcast({ type: "step.write", sessionID: session.id, path: step.path });
        } else if (step.kind === "commit") {
          await gitCommit(session.directory, step.message);
          broadcast({ type: "step.commit", sessionID: session.id, message: step.message });
        } else if (step.kind === "message") {
          session.transcript.push({
            id: `msg-${session.transcript.length + 1}`,
            role: step.role,
            content: step.content,
            at: new Date().toISOString(),
          });
          broadcast({ type: "step.message", sessionID: session.id });
        } else if (step.kind === "permission") {
          reqSeq += 1;
          const pending: PendingPermission = {
            requestID: `req-${reqSeq}`,
            tool: step.tool,
            detail: step.detail ?? "",
            status: "pending",
          };
          session.pending.push(pending);
          broadcast({
            type: "permission.requested",
            sessionID: session.id,
            requestID: pending.requestID,
          });
          const deadline = Date.now() + 60_000;
          while (pending.status === "pending" && Date.now() < deadline) await sleep(25);
          if (pending.status === "pending") {
            session.error = {
              message: `permission ${pending.requestID} never replied`,
              status: 500,
            };
            return;
          }
          broadcast({
            type: "permission.replied",
            sessionID: session.id,
            requestID: pending.requestID,
          });
        } else if (step.kind === "error") {
          session.error = { message: step.message, status: step.status ?? 500 };
          return;
        } else if (step.kind === "delay") {
          await sleep(step.ms);
        } else if (step.kind === "hang") {
          await new Promise<void>(() => {});
        }
      }
    } catch (err) {
      session.error = { message: (err as Error).message, status: 500 };
      return;
    } finally {
      session.busy = false;
      session.done = true;
      broadcast({ type: "session.done", sessionID: session.id });
    }
  }

  const server = Bun.serve({
    port: 0,
    // Test sessions may hold `wait` open for tens of seconds; the default
    // 10s idle timeout would kill them and long-lived SSE streams.
    idleTimeout: 60,
    fetch: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const method = req.method.toUpperCase();
      let body: unknown;
      try {
        body = method === "GET" || method === "DELETE" ? undefined : await req.json();
      } catch {
        body = undefined;
      }
      requests.push({ method, path: url.pathname, body, headers: {} });
      for (const [key, value] of req.headers.entries()) {
        const last = requests[requests.length - 1]!;
        last.headers[key.toLowerCase()] = value;
      }
      if (req.headers.get("authorization") !== expectedAuth) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const data = (payload: unknown, status = 200): Response =>
        Response.json({ data: payload }, { status });
      for (const route of FAKE_ROUTES) {
        const params = patternMatches(route.pattern, url.pathname);
        if (params === null || route.method !== method) continue;
        const sessionID = params["sessionID"];
        switch (`${method} ${route.pattern}`) {
          case "GET /api/info":
            // Unwrapped, like the real server: { version, ... } directly.
            return new Response(JSON.stringify({ version: "2.0.26", fake: true }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          case "GET /openapi.json":
            return new Response(specText, {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          case "POST /api/session": {
            const b = (body ?? {}) as {
              title?: string;
              agent?: string;
              location?: { directory?: string };
              permissions?: unknown;
              metadata?: unknown;
            };
            if (!b.location?.directory)
              return Response.json({ error: "location.directory is required" }, { status: 400 });
            seq += 1;
            const session: Session = {
              id: `ses-${seq}`,
              title: b.title ?? "",
              agent: b.agent ?? "",
              directory: b.location.directory,
              permissions: b.permissions,
              metadata: b.metadata,
              transcript: [],
              pending: [],
              env: {},
              busy: false,
              done: true,
              waiters: 0,
            };
            sessions.set(session.id, session);
            broadcast({ type: "session.created", sessionID: session.id });
            return data({ id: session.id, title: session.title, agent: session.agent });
          }
          case "GET /api/session/:sessionID": {
            const s = sessionID !== undefined ? sessions.get(sessionID) : undefined;
            if (!s) return Response.json({ error: "no such session" }, { status: 404 });
            return data({ id: s.id, title: s.title, agent: s.agent });
          }
          case "DELETE /api/session/:sessionID": {
            if (sessionID === undefined || !sessions.has(sessionID)) {
              return Response.json({ error: "no such session" }, { status: 404 });
            }
            sessions.delete(sessionID);
            return new Response(null, { status: 204 });
          }
          case "POST /api/session/:sessionID/prompt": {
            const s = sessionID !== undefined ? sessions.get(sessionID) : undefined;
            if (!s) return Response.json({ error: "no such session" }, { status: 404 });
            const text = ((body ?? {}) as { text?: string }).text ?? "";
            inboxSeq += 1;
            const inboxId = `inbox-${inboxSeq}`;
            s.transcript.push({
              id: inboxId,
              role: "user",
              content: text,
              at: new Date().toISOString(),
            });
            const rule = script.rules.find(
              (r) => r.matchPrompt === undefined || text.includes(r.matchPrompt),
            );
            const steps = rule?.steps ?? script.defaultSteps ?? [];
            // A new prompt starts new work: clear any terminal error and
            // mark the session busy before the steps run.
            s.error = undefined;
            s.done = false;
            broadcast({ type: "prompt.received", sessionID: s.id });
            void runSteps(s, steps);
            return data({ id: inboxId, sessionID: s.id });
          }
          case "POST /api/experimental/session/:sessionID/wait": {
            const s = sessionID !== undefined ? sessions.get(sessionID) : undefined;
            if (!s) return Response.json({ error: "no such session" }, { status: 404 });
            while (!s.done) {
              if (req.signal.aborted) return new Response(null, { status: 204 });
              await sleep(25);
            }
            if (s.error)
              return Response.json({ error: s.error.message }, { status: s.error.status });
            return new Response(null, { status: 204 });
          }
          case "POST /api/session/:sessionID/interrupt": {
            const s = sessionID !== undefined ? sessions.get(sessionID) : undefined;
            if (!s) return Response.json({ error: "no such session" }, { status: 404 });
            s.done = true;
            s.transcript.push({
              id: `msg-${s.transcript.length + 1}`,
              role: "system",
              content: "interrupted",
              at: new Date().toISOString(),
            });
            return data(true);
          }
          case "GET /api/session/:sessionID/message": {
            const s = sessionID !== undefined ? sessions.get(sessionID) : undefined;
            if (!s) return Response.json({ error: "no such session" }, { status: 404 });
            return data(s.transcript);
          }
          case "GET /api/session/:sessionID/diff": {
            const s = sessionID !== undefined ? sessions.get(sessionID) : undefined;
            if (!s) return Response.json({ error: "no such session" }, { status: 404 });
            try {
              return data(await gitDiff(s.directory));
            } catch (err) {
              return Response.json({ error: (err as Error).message }, { status: 500 });
            }
          }
          case "GET /api/session/:sessionID/permission": {
            const s = sessionID !== undefined ? sessions.get(sessionID) : undefined;
            if (!s) return Response.json({ error: "no such session" }, { status: 404 });
            // Like the real server, decided requests disappear from the list.
            return data(s.pending.filter((p) => p.status === "pending"));
          }
          case "POST /api/session/:sessionID/permission/:requestID/reply": {
            const s = sessionID !== undefined ? sessions.get(sessionID) : undefined;
            const found = s?.pending.find((p) => p.requestID === params["requestID"]);
            if (!s || !found) return Response.json({ error: "no such request" }, { status: 404 });
            const b = (body ?? {}) as { decision?: string; message?: string };
            found.status = "decided";
            found.decision = b.decision ?? "reject";
            found.decidedNote = b.message ?? "";
            // The real server answers 204 here.
            return new Response(null, { status: 204 });
          }
          case "PUT /api/session/:sessionID/environment": {
            const s = sessionID !== undefined ? sessions.get(sessionID) : undefined;
            if (!s) return Response.json({ error: "no such session" }, { status: 404 });
            // Real shape is `{ variables }` (a bare object 400s); the real
            // server answers 204.
            const vars = ((body ?? {}) as { variables?: Record<string, string> }).variables;
            if (vars === undefined || typeof vars !== "object" || vars === null)
              return Response.json({ error: "body.variables is required" }, { status: 400 });
            s.env = vars;
            return new Response(null, { status: 204 });
          }
          case "GET /api/event": {
            let controller: ReadableStreamDefaultController<Uint8Array>;
            const stream = new ReadableStream<Uint8Array>({
              start(c) {
                controller = c;
                streams.add(c);
                // Bun withholds the response headers until the first chunk,
                // so greet every subscriber: without this the client fetch
                // never resolves.
                try {
                  c.enqueue(encoder.encode(": fake-opencode connected\n\n"));
                } catch {
                  // subscriber already gone
                }
              },
              cancel() {
                streams.delete(controller);
              },
            });
            return new Response(stream, {
              status: 200,
              headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
            });
          }
          default:
            break;
        }
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    close: async (): Promise<void> => {
      server.stop(true);
    },
  };
}
