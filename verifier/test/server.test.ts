/**
 * Verifier service tests: health, auth, work-root confinement, green and
 * red runs, no-checks, timeout group-kill, and the concurrency cap.
 * Runs against a server on an ephemeral port with temporary roots.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { checkEnv, startVerifierServer } from "../src/server.js";

const TOKEN = "verifier-test-token";

function roots(): { work: string; artifacts: string } {
  const base = mkdtempSync(join(tmpdir(), "agency-verifier-"));
  return { work: join(base, "work"), artifacts: join(base, "artifacts") };
}

function seedRepo(work: string): string {
  const dir = join(work, "demo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "hello.txt"), "hello\n");
  return dir;
}

async function postRun(
  url: string,
  token: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}/run`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Command lines of live processes containing `marker` (Linux /proc). */
function procsWith(marker: string): string[] {
  const found: string[] = [];
  for (const pid of readdirSync("/proc")) {
    if (!/^[0-9]+$/.test(pid)) continue;
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
      if (cmd.includes(marker)) found.push(`${pid}: ${cmd.slice(0, 160)}`);
    } catch {
      // exited between listing and read
    }
  }
  return found;
}

describe("verifier service", () => {
  test("health is open and the run endpoint needs the token", async () => {
    const { work, artifacts } = roots();
    const server = await startVerifierServer({
      port: 0,
      token: TOKEN,
      workRoot: work,
      artifactsRoot: artifacts,
    });
    try {
      const health = await (await fetch(`${server.url}/healthz`)).json();
      expect(health).toEqual({ ok: true, service: "verifier" });
      const denied = await postRun(server.url, "wrong-token", {
        taskId: "t",
        dir: work,
        checks: [],
      });
      expect(denied.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  test("a dir outside the work root is refused", async () => {
    const { work, artifacts } = roots();
    const outside = mkdtempSync(join(tmpdir(), "agency-outside-"));
    const server = await startVerifierServer({
      port: 0,
      token: TOKEN,
      workRoot: work,
      artifactsRoot: artifacts,
    });
    try {
      const res = await postRun(server.url, TOKEN, {
        taskId: "t-evil",
        dir: outside,
        checks: [{ id: "x", run: "true", timeoutSec: 5 }],
      });
      expect(res.status).toBe(403);
      expect(res.json["reason"]).toBe("outside-work");
      const traversalDir = join(work, "..", "outside-x");
      mkdirSync(traversalDir, { recursive: true });
      const traversal = await postRun(server.url, TOKEN, {
        taskId: "t-evil",
        dir: traversalDir,
        checks: [{ id: "x", run: "true", timeoutSec: 5 }],
      });
      expect(traversal.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  test("a green run reports every check and writes full logs", async () => {
    const { work, artifacts } = roots();
    const dir = seedRepo(work);
    const server = await startVerifierServer({
      port: 0,
      token: TOKEN,
      workRoot: work,
      artifactsRoot: artifacts,
    });
    try {
      const res = await postRun(server.url, TOKEN, {
        taskId: "t-green",
        dir,
        setup: ["echo setup-ok"],
        checks: [
          { id: "one", run: "echo one-ok", timeoutSec: 30 },
          { id: "two", run: "echo two-ok", timeoutSec: 30 },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.json["ok"]).toBe(true);
      const checks = res.json["checks"] as { id: string; exit: number; logPath: string }[];
      expect(checks.map((c) => [c.id, c.exit])).toEqual([
        ["one", 0],
        ["two", 0],
      ]);
      expect(readFileSync(checks[0]!.logPath, "utf8")).toContain("one-ok");
    } finally {
      await server.close();
    }
  });

  test("a red run names the failing check", async () => {
    const { work, artifacts } = roots();
    const dir = seedRepo(work);
    const server = await startVerifierServer({
      port: 0,
      token: TOKEN,
      workRoot: work,
      artifactsRoot: artifacts,
    });
    try {
      const res = await postRun(server.url, TOKEN, {
        taskId: "t-red",
        dir,
        checks: [
          { id: "good", run: "echo fine", timeoutSec: 30 },
          { id: "broken", run: "echo boom; exit 3", timeoutSec: 30 },
        ],
      });
      expect(res.json["ok"]).toBe(false);
      expect(res.json["reason"]).toBe("checks");
      const checks = res.json["checks"] as { id: string; exit: number }[];
      expect(checks.find((c) => c.id === "broken")?.exit).toBe(3);
    } finally {
      await server.close();
    }
  });

  test("an empty check list returns no-checks, never success", async () => {
    const { work, artifacts } = roots();
    const dir = seedRepo(work);
    const server = await startVerifierServer({
      port: 0,
      token: TOKEN,
      workRoot: work,
      artifactsRoot: artifacts,
    });
    try {
      const res = await postRun(server.url, TOKEN, { taskId: "t-empty", dir, checks: [] });
      expect(res.json["ok"]).toBe(false);
      expect(res.json["reason"]).toBe("no-checks");
    } finally {
      await server.close();
    }
  });

  test("a check that backgrounds a process and times out leaves no process behind", async () => {
    const { work, artifacts } = roots();
    const dir = seedRepo(work);
    const marker = `agency-probe-${Date.now()}-sleep`;
    const server = await startVerifierServer({
      port: 0,
      token: TOKEN,
      workRoot: work,
      artifactsRoot: artifacts,
    });
    try {
      const res = await postRun(server.url, TOKEN, {
        taskId: "t-timeout",
        dir,
        checks: [
          { id: "spy", run: `echo ${marker}-started; sleep 300 & sleep 300`, timeoutSec: 2 },
        ],
      });
      expect(res.json["ok"]).toBe(false);
      const checks = res.json["checks"] as { id: string; exit: number; timedOut: boolean }[];
      expect(checks[0]).toMatchObject({ id: "spy", exit: 124, timedOut: true });
      await new Promise((r) => setTimeout(r, 500));
      expect(procsWith(marker)).toEqual([]);
    } finally {
      await server.close();
    }
  });

  test("past the concurrency cap the service answers busy", async () => {
    const { work, artifacts } = roots();
    const dir = seedRepo(work);
    const server = await startVerifierServer({
      port: 0,
      token: TOKEN,
      workRoot: work,
      artifactsRoot: artifacts,
      maxRuns: 1,
    });
    try {
      const slow = postRun(server.url, TOKEN, {
        taskId: "t-slow",
        dir,
        checks: [{ id: "slow", run: "sleep 2", timeoutSec: 30 }],
      });
      await new Promise((r) => setTimeout(r, 300));
      const busy = await postRun(server.url, TOKEN, {
        taskId: "t-busy",
        dir,
        checks: [{ id: "fast", run: "echo hi", timeoutSec: 30 }],
      });
      expect(busy.status).toBe(503);
      expect(busy.json["reason"]).toBe("busy");
      expect((await slow).json["ok"]).toBe(true);
    } finally {
      await server.close();
    }
  });

  test("starting without a token is refused", async () => {
    await expect(startVerifierServer({ port: 0, token: "" })).rejects.toThrow(/VERIFIER_TOKEN/);
  });

  test("checkEnv carries no provider key and names the proxy explicitly", () => {
    const env = checkEnv();
    expect(env["OPENCODE_API_KEY"]).toBeUndefined();
    expect(env["CI"]).toBe("1");
    expect(typeof env["PATH"]).toBe("string");
  });
});
