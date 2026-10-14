import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { DirectorTask } from "../src/plan.js";
import {
  attachFake,
  bearer,
  loginToken,
  makeServiceHarness,
  startTestHttp,
  type ServiceHarness,
} from "./support/service-harness.js";

async function readFrames(res: Response, count: number, timeoutMs = 8000): Promise<string[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const frames: string[] = [];
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (frames.length < count && Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const p of parts) {
        const trimmed = p.trim();
        if (trimmed !== "" && !trimmed.startsWith(":")) frames.push(p);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return frames;
}

const scoutTask = (id: string, deps: string[] = []): DirectorTask => ({
  id,
  title: `recon ${id}`,
  role: "recon",
  expert: "scout",
  deps,
  trigger: "all_success",
  input: { objective: "look around", acceptance: ["report"], paths: [] },
  policy: { strategy: "fail" },
});

async function harnessWithHttp(
  notify?: (taskId: string) => void,
): Promise<{ h: ServiceHarness; url: string }> {
  const h = await makeServiceHarness();
  await attachFake(h, "scout");
  await attachFake(h, "docs");
  await attachFake(h, "director", {
    rules: [],
    defaultSteps: [{ kind: "message", role: "assistant", content: "director ready" }],
  });
  const url = await startTestHttp(h, notify !== undefined ? { notify } : undefined);
  return { h, url };
}

describe("control plane auth", () => {
  test("every protected route refuses anonymous requests with 401", async () => {
    const { h, url } = await harnessWithHttp();
    try {
      const paths: [string, string][] = [
        ["GET", "/api/auth/me"],
        ["POST", "/api/auth/logout"],
        ["GET", "/api/fleet"],
        ["GET", "/api/missions"],
        ["POST", "/api/missions"],
        ["GET", "/api/missions/m-nope"],
        ["GET", "/api/missions/m-nope/events"],
        ["POST", "/api/missions/m-nope/approve"],
        ["POST", "/api/missions/m-nope/reject"],
        ["POST", "/api/missions/m-nope/cancel"],
        ["PUT", "/api/missions/m-nope/plan"],
        ["GET", "/api/tasks/t-nope"],
        ["GET", "/api/tasks/t-nope/diff"],
        ["GET", "/api/tasks/t-nope/artifacts/report.md"],
        ["POST", "/api/tasks/t-nope/decide"],
        ["POST", "/api/gc"],
        ["POST", "/api/missions/m-nope/chat"],
        ["GET", "/api/missions/m-nope/chat"],
        ["GET", "/api/missions/m-nope/chat/events"],
      ];
      for (const [method, path] of paths) {
        const res = await fetch(`${url}${path}`, { method });
        expect(`${method} ${path}`).toBe(`${method} ${path}`);
        expect(res.status).toBe(401);
        await res.text().catch(() => {});
      }
      const bad = await fetch(`${url}/api/fleet`, { headers: bearer("bad-token") });
      expect(bad.status).toBe(401);
    } finally {
      await h.close();
    }
  });

  test("login returns the profile, a cookie, and a bearer token", async () => {
    const { h, url } = await harnessWithHttp();
    try {
      const { token, cookie } = await loginToken(url, "approver");
      expect(token.length).toBeGreaterThan(10);
      expect(cookie).toContain("agency_session=");
      const me = await fetch(`${url}/api/auth/me`, { headers: bearer(token) });
      expect(me.status).toBe(200);
      expect(((await me.json()) as { role: string }).role).toBe("approver");
      const byCookie = await fetch(`${url}/api/auth/me`, { headers: { cookie: cookie! } });
      expect(byCookie.status).toBe(200);
      const wrong = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "approver", password: "wrong" }),
      });
      expect(wrong.status).toBe(401);
      const unknown = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "ghost", password: "x" }),
      });
      expect(unknown.status).toBe(401);
      const logout = await fetch(`${url}/api/auth/logout`, {
        method: "POST",
        headers: bearer(token),
      });
      expect(logout.status).toBe(200);
      const reused = await fetch(`${url}/api/auth/me`, { headers: bearer(token) });
      expect(reused.status).toBe(401);
    } finally {
      await h.close();
    }
  });

  test("viewer approval is forbidden and approver approval succeeds", async () => {
    const { h, url } = await harnessWithHttp();
    try {
      const viewer = await loginToken(url, "viewer");
      const approver = await loginToken(url, "approver");
      const created = await fetch(`${url}/api/missions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(approver.token) },
        body: JSON.stringify({ objective: "needs a plan" }),
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      await h.engine.submitPlan(
        id,
        ["a", "b", "c", "d"].map((k) => scoutTask(k)),
      );
      const denied = await fetch(`${url}/api/missions/${id}/approve`, {
        method: "POST",
        headers: bearer(viewer.token),
      });
      expect(denied.status).toBe(403);
      const allowed = await fetch(`${url}/api/missions/${id}/approve`, {
        method: "POST",
        headers: bearer(approver.token),
      });
      expect(allowed.status).toBe(200);
      expect(((await allowed.json()) as { status: string }).status).toBe("running");
    } finally {
      await h.close();
    }
  });
});

describe("missions, plans, and tasks", () => {
  test("mission listing, creation, fetch, reject, and cancel", async () => {
    const { h, url } = await harnessWithHttp();
    try {
      const approver = await loginToken(url, "approver");
      const auth = bearer(approver.token);
      const empty = await fetch(`${url}/api/missions`, { headers: auth });
      expect(((await empty.json()) as { missions: unknown[] }).missions).toEqual([]);
      const noObjective = await fetch(`${url}/api/missions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({}),
      });
      expect(noObjective.status).toBe(400);
      const viewer = await loginToken(url, "viewer");
      const viewerCreate = await fetch(`${url}/api/missions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(viewer.token) },
        body: JSON.stringify({ objective: "x" }),
      });
      expect(viewerCreate.status).toBe(403);
      const created = await fetch(`${url}/api/missions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ objective: "first mission" }),
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      const gotten = await fetch(`${url}/api/missions/${id}`, { headers: auth });
      expect(gotten.status).toBe(200);
      expect(((await gotten.json()) as { mission: { objective: string } }).mission.objective).toBe(
        "first mission",
      );
      const missing = await fetch(`${url}/api/missions/m-ghost`, { headers: auth });
      expect(missing.status).toBe(404);
      const rejected = await fetch(`${url}/api/missions/${id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ reason: "no longer needed" }),
      });
      expect(rejected.status).toBe(200);
      expect(((await rejected.json()) as { status: string }).status).toBe("cancelled");
      const second = await fetch(`${url}/api/missions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ objective: "second mission" }),
      });
      const { id: secondId } = (await second.json()) as { id: string };
      const cancelled = await fetch(`${url}/api/missions/${secondId}/cancel`, {
        method: "POST",
        headers: auth,
      });
      expect(cancelled.status).toBe(200);
    } finally {
      await h.close();
    }
  });

  test("a waiting plan can be edited before approval", async () => {
    const { h, url } = await harnessWithHttp();
    try {
      const approver = await loginToken(url, "approver");
      const auth = bearer(approver.token);
      const created = await fetch(`${url}/api/missions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ objective: "big plan" }),
      });
      const { id } = (await created.json()) as { id: string };
      await h.engine.submitPlan(
        id,
        ["a", "b", "c", "d"].map((k) => scoutTask(k)),
      );
      const edited = await fetch(`${url}/api/missions/${id}/plan`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({
          tasks: [
            { key: "only", expert: "scout", objective: "just this", acceptance: ["ok"], paths: [] },
          ],
        }),
      });
      expect(edited.status).toBe(200);
      const editedBody = (await edited.json()) as { status: string; tasks: string[] };
      expect(editedBody.status).toBe("running");
      expect(editedBody.tasks).toEqual(["only"]);
      const frozen = await fetch(`${url}/api/missions/${id}/plan`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ tasks: [] }),
      });
      expect(frozen.status).toBe(400);
    } finally {
      await h.close();
    }
  });

  test("decide accepts through REST and wakes the Director hook", async () => {
    const woken: string[] = [];
    const { h, url } = await harnessWithHttp((taskId) => {
      woken.push(taskId);
    });
    try {
      const approver = await loginToken(url, "approver");
      const viewer = await loginToken(url, "viewer");
      const auth = bearer(approver.token);
      const created = await fetch(`${url}/api/missions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ objective: "decide me" }),
      });
      const { id } = (await created.json()) as { id: string };
      await h.engine.submitPlan(id, [scoutTask("t1")]);
      const denied = await fetch(`${url}/api/tasks/t1/decide`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(viewer.token) },
        body: JSON.stringify({ decision: "abandon" }),
      });
      expect(denied.status).toBe(403);
      const bad = await fetch(`${url}/api/tasks/t1/decide`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ decision: "merge" }),
      });
      expect(bad.status).toBe(400);
      const decided = await fetch(`${url}/api/tasks/t1/decide`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ decision: "abandon", notes: "drop it" }),
      });
      expect(decided.status).toBe(200);
      expect(h.engine.getMission(id).tasks[0]?.status).toBe("cancelled");
      expect(woken).toEqual(["t1"]);
    } finally {
      await h.close();
    }
  });

  test("task fetch and diff follow the engine state", async () => {
    const { h, url } = await harnessWithHttp();
    try {
      const approver = await loginToken(url, "approver");
      const auth = bearer(approver.token);
      const created = await fetch(`${url}/api/missions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ objective: "diff me" }),
      });
      const { id } = (await created.json()) as { id: string };
      await h.engine.submitPlan(id, [scoutTask("t1")]);
      const gotten = await fetch(`${url}/api/tasks/t1`, { headers: auth });
      expect(gotten.status).toBe(200);
      const missing = await fetch(`${url}/api/tasks/t-ghost`, { headers: auth });
      expect(missing.status).toBe(404);
      const early = await fetch(`${url}/api/tasks/t1/diff`, { headers: auth });
      expect(early.status).toBe(400);
      await h.engine.tick();
      const diffed = await fetch(`${url}/api/tasks/t1/diff`, { headers: auth });
      expect(diffed.status).toBe(200);
      expect(((await diffed.json()) as { taskId: string }).taskId).toBe("t1");
    } finally {
      await h.close();
    }
  });

  test("artifact paths outside the task directory are refused", async () => {
    const { h, url } = await harnessWithHttp();
    try {
      const approver = await loginToken(url, "approver");
      const auth = bearer(approver.token);
      const created = await fetch(`${url}/api/missions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ objective: "artifacts" }),
      });
      const { id } = (await created.json()) as { id: string };
      await h.engine.submitPlan(id, [scoutTask("t1")]);
      const traversal = await fetch(`${url}/api/tasks/t1/artifacts//etc/passwd`, {
        headers: auth,
      });
      expect(traversal.status).toBe(403);
      await traversal.text().catch(() => {});
      const encodedDots = await fetch(`${url}/api/tasks/t1/artifacts/%2e%2e/%2e%2e/state`, {
        headers: auth,
      });
      expect(encodedDots.status).not.toBe(200);
      await encodedDots.text().catch(() => {});
      const missing = await fetch(`${url}/api/tasks/t1/artifacts/report.md`, { headers: auth });
      expect(missing.status).toBe(404);
      mkdirSync(join(h.artifactsRoot, "t1"), { recursive: true });
      writeFileSync(join(h.artifactsRoot, "t1", "report.md"), "# report\n");
      const served = await fetch(`${url}/api/tasks/t1/artifacts/report.md`, { headers: auth });
      expect(served.status).toBe(200);
      expect(await served.text()).toBe("# report\n");
      const ghost = await fetch(`${url}/api/tasks/t-ghost/artifacts/report.md`, { headers: auth });
      expect(ghost.status).toBe(404);
    } finally {
      await h.close();
    }
  });

  test("gc is admin-only and mission events stream over SSE", async () => {
    const { h, url } = await harnessWithHttp();
    try {
      const admin = await loginToken(url, "admin");
      const approver = await loginToken(url, "approver");
      const denied = await fetch(`${url}/api/gc`, {
        method: "POST",
        headers: bearer(approver.token),
      });
      expect(denied.status).toBe(403);
      const collected = await fetch(`${url}/api/gc`, {
        method: "POST",
        headers: bearer(admin.token),
      });
      expect(collected.status).toBe(200);
      expect(((await collected.json()) as { missions: number }).missions).toBe(0);
      const created = await fetch(`${url}/api/missions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(approver.token) },
        body: JSON.stringify({ objective: "stream me" }),
      });
      const { id } = (await created.json()) as { id: string };
      const stream = await fetch(`${url}/api/missions/${id}/events`, {
        headers: bearer(approver.token),
      });
      expect(stream.status).toBe(200);
      expect(stream.headers.get("content-type")).toBe("text/event-stream");
      const frames = await readFrames(stream, 1);
      expect(frames.length).toBe(1);
      expect(frames[0]).toContain("mission");
      const ghost = await fetch(`${url}/api/missions/m-ghost/events`, {
        headers: bearer(approver.token),
      });
      expect(ghost.status).toBe(404);
    } finally {
      await h.close();
    }
  });
});

describe("director chat proxy", () => {
  test("prompts relay to the Director session and transcripts stream back", async () => {
    const { h, url } = await harnessWithHttp();
    try {
      const viewer = await loginToken(url, "viewer");
      const auth = bearer(viewer.token);
      const created = await fetch(`${url}/api/missions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...bearer((await loginToken(url, "approver")).token),
        },
        body: JSON.stringify({ objective: "chat mission" }),
      });
      const { id } = (await created.json()) as { id: string };
      const empty = await fetch(`${url}/api/missions/${id}/chat`, { headers: auth });
      expect(empty.status).toBe(200);
      expect(((await empty.json()) as { sessionId: null }).sessionId).toBeNull();
      const sent = await fetch(`${url}/api/missions/${id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ message: "hello director" }),
      });
      expect(sent.status).toBe(200);
      const { sessionId } = (await sent.json()) as { sessionId: string };
      expect(sessionId.length).toBeGreaterThan(0);
      const directorFake = h.fakes[h.fakes.length - 1]!;
      const prompts = directorFake.requests.filter((r) => r.path.endsWith("/prompt"));
      expect(prompts.length).toBeGreaterThan(0);
      expect(JSON.stringify(prompts[prompts.length - 1]?.body)).toContain("hello director");
      let messages: { text: string }[] = [];
      for (let i = 0; i < 50 && messages.length === 0; i++) {
        const transcript = await fetch(`${url}/api/missions/${id}/chat`, { headers: auth });
        expect(transcript.status).toBe(200);
        messages = ((await transcript.json()) as { messages: { text: string }[] }).messages.filter(
          (m) => m.text.trim() !== "",
        );
        if (messages.length === 0) await new Promise((r) => setTimeout(r, 100));
      }
      expect(messages.length).toBeGreaterThan(0);
      const events = await fetch(`${url}/api/missions/${id}/chat/events`, { headers: auth });
      expect(events.status).toBe(200);
      expect(events.headers.get("content-type")).toBe("text/event-stream");
      const frames = await readFrames(events, 3);
      expect(frames.length).toBeGreaterThan(0);
      expect(frames[0]).toContain("sync");
      const blank = await fetch(`${url}/api/missions/${id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ message: "   " }),
      });
      expect(blank.status).toBe(400);
      const ghost = await fetch(`${url}/api/missions/m-ghost/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ message: "hi" }),
      });
      expect(ghost.status).toBe(404);
    } finally {
      await h.close();
    }
  });
});

describe("health", () => {
  test("healthy when the store, audit, and contracts hold", async () => {
    const { h, url } = await harnessWithHttp();
    try {
      const res = await fetch(`${url}/healthz`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    } finally {
      await h.close();
    }
  });

  test("unhealthy when expert contracts fail", async () => {
    const h = await makeServiceHarness();
    try {
      const url = await startTestHttp(h, {
        health: {
          storeOpen: () => {
            h.engine.listMissionIds();
          },
          verifyAudit: () => h.store.verifyAudit(),
          assertContracts: async () => {
            throw new Error("contract failed for scout");
          },
        },
      });
      const res = await fetch(`${url}/healthz`);
      expect(res.status).toBe(503);
      expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
    } finally {
      await h.close();
    }
  });

  test("unhealthy when the audit log fails", async () => {
    const h = await makeServiceHarness();
    try {
      const url = await startTestHttp(h, {
        health: {
          storeOpen: () => {
            h.engine.listMissionIds();
          },
          verifyAudit: async () => ({ ok: false, reason: "tampered" }),
          assertContracts: async () => {},
        },
      });
      const res = await fetch(`${url}/healthz`);
      expect(res.status).toBe(503);
    } finally {
      await h.close();
    }
  });

  test("fleet roster answers over REST", async () => {
    const { h, url } = await harnessWithHttp();
    try {
      const viewer = await loginToken(url, "viewer");
      const res = await fetch(`${url}/api/fleet`, { headers: bearer(viewer.token) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { experts: { name: string; health: string }[] };
      expect(body.experts.some((e) => e.name === "scout" && e.health === "healthy")).toBe(true);
    } finally {
      await h.close();
    }
  });
});
