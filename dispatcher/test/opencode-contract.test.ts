/**
 * New Stage 1c client operations against the fake server: prompt delivery,
 * permission list/reply, environment, SSE reconnect, and contract failure.
 */
import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "../src/opencode.js";
import type { FakeOpenCode } from "./support/fake-opencode.js";
import { startFakeOpenCode } from "./support/fake-opencode.js";
import type { StreamEvent } from "../src/opencode.js";
import { makeTmpGitRepo } from "./support/git.js";

const PASSWORD = "stage1c-fake-pw";

describe("opencode client stage-1c operations", () => {
  test("prompt sends text with optional delivery", async () => {
    const fake: FakeOpenCode = await startFakeOpenCode({
      password: PASSWORD,
      script: { rules: [{ steps: [{ kind: "message", role: "assistant", content: "ok" }] }] },
    });
    try {
      const c = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
      const repo = makeTmpGitRepo();
      const created = await c.createSession({ location: { directory: repo } });
      await c.prompt(created.id, "hello");
      await c.prompt(created.id, "steer me", "steer");
      await c.waitIdle(created.id, 10_000);
      const prompts = fake.requests.filter((r) => r.path.endsWith("/prompt"));
      expect(prompts.length).toBe(2);
      expect(prompts[0]!.body).toEqual({ text: "hello" });
      expect(prompts[1]!.body).toEqual({ text: "steer me", delivery: "steer" });
    } finally {
      await fake.close();
    }
  });

  test("pendingPermissions lists and replyPermission resolves a request", async () => {
    const fake: FakeOpenCode = await startFakeOpenCode({
      password: PASSWORD,
      script: { rules: [{ steps: [{ kind: "permission", tool: "shell", detail: "run tests" }] }] },
    });
    try {
      const c = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
      const created = await c.createSession({ location: { directory: makeTmpGitRepo() } });
      await c.prompt(created.id, "go");
      let pending = [] as Awaited<ReturnType<typeof c.pendingPermissions>>;
      for (let i = 0; i < 100 && pending.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 50));
        pending = await c.pendingPermissions(created.id);
      }
      expect(pending.length).toBe(1);
      expect(pending[0]!.requestID.length).toBeGreaterThan(0);
      await c.replyPermission(created.id, pending[0]!.requestID, "reject", "headless fleet");
      await c.waitIdle(created.id, 10_000);
      expect(await c.pendingPermissions(created.id)).toEqual([]);
      const replied = fake.requests.find((r) => r.path.endsWith("/reply"));
      expect(replied?.body).toEqual({ decision: "reject", message: "headless fleet" });
    } finally {
      await fake.close();
    }
  });

  test("setEnvironment sends { variables }", async () => {
    const fake: FakeOpenCode = await startFakeOpenCode({ password: PASSWORD });
    try {
      const c = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
      const created = await c.createSession({ location: { directory: makeTmpGitRepo() } });
      await c.setEnvironment(created.id, { FLEET_TASK: "t-1" });
      const recorded = fake.requests.find((r) => r.path.endsWith("/environment"));
      expect(recorded?.method).toBe("PUT");
      expect(recorded?.body).toEqual({ variables: { FLEET_TASK: "t-1" } });
    } finally {
      await fake.close();
    }
  });

  test("SSE subscription reconnects after the fake drops it and keeps the resume point", async () => {
    const fake: FakeOpenCode = await startFakeOpenCode({ password: PASSWORD, sseDropAfter: 2 });
    const c = new OpenCodeClient({ baseUrl: fake.url, password: PASSWORD });
    const seen: StreamEvent[] = [];
    const sub = c.subscribeEvents({
      reconnectMs: 50,
      onEvent: (e) => {
        seen.push(e);
      },
    });
    try {
      const repo = makeTmpGitRepo();
      const first = await c.createSession({ location: { directory: repo } });
      // The first prompt's broadcasts trip the drop: the original stream
      // dies here, so nothing below can arrive without a reconnect.
      await c.prompt(first.id, "ping");
      await c.waitIdle(first.id, 10_000);
      // Wait for the reconnect (a second GET /api/event) before producing
      // more events; otherwise they would fire inside the reconnect gap.
      // The fake keeps no replay buffer, like the real server.
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (fake.requests.filter((r) => r.method === "GET" && r.path === "/api/event").length >= 2)
          break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(
        fake.requests.filter((r) => r.method === "GET" && r.path === "/api/event").length,
      ).toBeGreaterThanOrEqual(2);
      const second = await c.createSession({ location: { directory: repo } });
      await c.prompt(second.id, "ping again");
      await c.waitIdle(second.id, 10_000);
      const doneDeadline = Date.now() + 10_000;
      while (Date.now() < doneDeadline) {
        if (
          seen.filter((e) => JSON.stringify(e.data).includes("session.done")).length >= 1 &&
          sub.lastEventId() !== null
        )
          break;
        await new Promise((r) => setTimeout(r, 50));
      }
      // The post-drop session.done is observable only via the reconnected
      // stream, and the resume point advanced past the drop.
      expect(
        seen.some(
          (e) =>
            JSON.stringify(e.data).includes("session.done") &&
            JSON.stringify(e.data).includes(second.id),
        ),
      ).toBe(true);
      expect(sub.lastEventId()).not.toBeNull();
      const resumed = fake.requests.filter(
        (r) => r.method === "GET" && r.path === "/api/event" && r.headers["last-event-id"],
      );
      expect(resumed.length).toBeGreaterThan(0);
    } finally {
      sub.close();
      await fake.close();
    }
  });
});
