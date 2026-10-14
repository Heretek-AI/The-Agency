/**
 * Verifier HTTP service (Stage 1c, Step 5). A non-LLM service: it runs a
 * repository's declared checks via `run-checks.ts` and reports the
 * results. No provider key here, ever.
 *
 * - `GET /healthz`, open.
 * - `POST /run`, bearer `VERIFIER_TOKEN`: `{ taskId, dir, setup?, checks }`.
 *   `dir` is resolved and refused unless under the work root (`/work`).
 *   Runs with an explicit environment (PATH, HOME, LANG, `CI=1`, proxy
 *   variables) and returns each check's exit code, duration, and log
 *   path. Full logs go to `<artifactsRoot>/<taskId>/verify/`.
 * - An empty check list returns the `no-checks` failure, never success.
 * - Each run is its own process group, killed whole on timeout
 *   (`execCmd` confirms the group gone). Concurrent runs are capped;
 *   past the cap the service answers 503.
 * - Refuses to start without `VERIFIER_TOKEN`.
 */
import { realpath } from "node:fs/promises";
import path from "node:path";
import { optionalEnv, requiredEnv } from "../../dispatcher/src/config.js";
import { NoChecksError, runChecks, type CheckDef } from "./run-checks.js";

export interface VerifierServerOptions {
  port: number;
  hostname?: string;
  token: string;
  /** Directory `dir` must resolve under. Defaults to `/work`. */
  workRoot?: string;
  /** Full logs go under `<artifactsRoot>/<taskId>/verify/`. Defaults to `/artifacts`. */
  artifactsRoot?: string;
  /** Cap on concurrent runs. Defaults to 4. */
  maxRuns?: number;
}

export interface VerifierServer {
  url: string;
  close: () => Promise<void>;
}

interface RunBody {
  taskId?: unknown;
  dir?: unknown;
  setup?: unknown;
  checks?: unknown;
}

function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function parseChecks(value: unknown): CheckDef[] | null {
  if (!Array.isArray(value)) return null;
  const out: CheckDef[] = [];
  for (const item of value) {
    const c = item as { id?: unknown; run?: unknown; timeoutSec?: unknown };
    if (typeof c.id !== "string" || typeof c.run !== "string") return null;
    const timeoutSec =
      typeof c.timeoutSec === "number" && Number.isFinite(c.timeoutSec) && c.timeoutSec > 0
        ? Math.floor(c.timeoutSec)
        : 300;
    out.push({ id: c.id, run: c.run, timeoutSec });
  }
  return out;
}

/** Explicit environment for checks: never the server's own. */
export function checkEnv(): Record<string, string | undefined> {
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/home/agent",
    LANG: "C.UTF-8",
    CI: "1",
    HTTP_PROXY: optionalEnv("HTTP_PROXY", ""),
    HTTPS_PROXY: optionalEnv("HTTPS_PROXY", ""),
    http_proxy: optionalEnv("http_proxy", ""),
    https_proxy: optionalEnv("https_proxy", ""),
    NO_PROXY: optionalEnv("NO_PROXY", "localhost,127.0.0.1,egress,dispatcher,verifier"),
    no_proxy: optionalEnv("no_proxy", "localhost,127.0.0.1,egress,dispatcher,verifier"),
  };
}

function bearerOk(req: Request, token: string): boolean {
  const header = req.headers.get("authorization");
  return header === `Bearer ${token}`;
}

export async function startVerifierServer(options: VerifierServerOptions): Promise<VerifierServer> {
  if (options.token === "") throw new Error("refusing to start: VERIFIER_TOKEN is empty or unset");
  const workRoot = path.resolve(options.workRoot ?? "/work");
  const artifactsRoot = options.artifactsRoot ?? "/artifacts";
  const maxRuns = options.maxRuns ?? 4;
  let running = 0;

  const server = Bun.serve({
    port: options.port,
    hostname: options.hostname ?? "0.0.0.0",
    idleTimeout: 60,
    fetch: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/healthz") {
        return Response.json({ ok: true, service: "verifier" });
      }
      if (req.method === "POST" && url.pathname === "/run") {
        if (!bearerOk(req, options.token))
          return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
        if (running >= maxRuns)
          return Response.json({ ok: false, reason: "busy" }, { status: 503 });
        let body: RunBody;
        try {
          body = (await req.json()) as RunBody;
        } catch {
          return Response.json({ ok: false, reason: "bad-body" }, { status: 400 });
        }
        if (!isSlug(body.taskId))
          return Response.json({ ok: false, reason: "bad-taskId" }, { status: 400 });
        if (typeof body.dir !== "string" || body.dir === "")
          return Response.json({ ok: false, reason: "bad-dir" }, { status: 400 });
        let resolved: string;
        try {
          resolved = await realpath(body.dir);
        } catch {
          return Response.json({ ok: false, reason: "bad-dir" }, { status: 400 });
        }
        const rel = path.relative(workRoot, resolved);
        if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel))
          return Response.json({ ok: false, reason: "outside-work" }, { status: 403 });
        const setup = Array.isArray(body.setup)
          ? body.setup.filter((s): s is string => typeof s === "string")
          : [];
        const checks = parseChecks(body.checks);
        if (checks === null)
          return Response.json({ ok: false, reason: "bad-checks" }, { status: 400 });
        running += 1;
        try {
          const result = await runChecks({
            dir: resolved,
            setup,
            checks,
            artifactsDir: path.join(artifactsRoot, body.taskId),
            env: checkEnv(),
          });
          return Response.json({
            ok: result.ok,
            reason: result.reason,
            setup: result.setup,
            checks: result.checks,
          });
        } catch (err) {
          if (err instanceof NoChecksError)
            return Response.json({ ok: false, reason: "no-checks", checks: [] });
          throw err;
        } finally {
          running -= 1;
        }
      }
      return Response.json({ ok: false, reason: "not-found" }, { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    close: async () => {
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  const token = requiredEnv("VERIFIER_TOKEN");
  const port = Number(optionalEnv("VERIFIER_PORT", "8080"));
  if (!Number.isInteger(port) || port <= 0)
    throw new Error(`refusing to start: VERIFIER_PORT is not a port`);
  const server = await startVerifierServer({
    port,
    token,
    workRoot: optionalEnv("VERIFIER_WORK_ROOT", "/work") || "/work",
    artifactsRoot: optionalEnv("VERIFIER_ARTIFACTS_ROOT", "/artifacts") || "/artifacts",
    maxRuns: Number(optionalEnv("VERIFIER_MAX_RUNS", "4")) || 4,
  });
  console.log(`verifier: listening on ${server.url}`);
}
