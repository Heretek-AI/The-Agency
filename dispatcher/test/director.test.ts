import { describe, expect, test } from "bun:test";
import {
  correlatedSession,
  directorWakeHook,
  ensureDirectorSession,
  missionNeedsDirector,
  wakeDirector,
  DIRECTOR_WAKE_PREFIX,
} from "../src/director.js";
import { attachFake, makeServiceHarness, type ServiceHarness } from "./support/service-harness.js";
import { OpenCodeClient } from "../src/opencode.js";

async function harnessWithDirector(): Promise<ServiceHarness> {
  const h = await makeServiceHarness();
  await attachFake(h, "scout");
  await attachFake(h, "director", {
    rules: [],
    defaultSteps: [{ kind: "message", role: "assistant", content: "director ready" }],
  });
  return h;
}

function directorClientOf(h: ServiceHarness): OpenCodeClient {
  const client = h.clients.get("director");
  if (client === undefined) throw new Error("no director client in harness");
  return client;
}

const scoutPlan = [
  {
    id: "recon",
    title: "recon",
    role: "recon",
    expert: "scout",
    deps: [],
    trigger: "all_success" as const,
    input: { objective: "look around", acceptance: ["report"], paths: [] },
    policy: { strategy: "fail" as const },
  },
];

describe("director sessions", () => {
  test("the first call creates a session and later calls reuse it", async () => {
    const h = await harnessWithDirector();
    try {
      const m = await h.engine.createMission({
        id: "m-director",
        repo: "demo",
        source: "chat",
        playbook: "director",
        objective: "lead me",
      });
      expect(correlatedSession(h.engine, m.id)).toBeUndefined();
      const first = await ensureDirectorSession(
        h.engine,
        { director: directorClientOf(h) },
        m.id,
        h.repoDir,
      );
      expect(first.length).toBeGreaterThan(0);
      expect(correlatedSession(h.engine, m.id)).toBe(first);
      const second = await ensureDirectorSession(
        h.engine,
        { director: directorClientOf(h) },
        m.id,
        h.repoDir,
      );
      expect(second).toBe(first);
      const directorFake = h.fakes[h.fakes.length - 1]!;
      const creations = directorFake.requests.filter(
        (r) => r.method === "POST" && r.path === "/api/session",
      );
      expect(creations).toHaveLength(1);
    } finally {
      await h.close();
    }
  });

  test("a gone session is replaced and recorrelated", async () => {
    const h = await harnessWithDirector();
    try {
      const m = await h.engine.createMission({
        id: "m-replace",
        repo: "demo",
        source: "chat",
        playbook: "director",
        objective: "lead me",
      });
      const first = await ensureDirectorSession(
        h.engine,
        { director: directorClientOf(h) },
        m.id,
        h.repoDir,
      );
      await directorClientOf(h).deleteSession(first);
      const second = await ensureDirectorSession(
        h.engine,
        { director: directorClientOf(h) },
        m.id,
        h.repoDir,
      );
      expect(second).not.toBe(first);
      expect(correlatedSession(h.engine, m.id)).toBe(second);
    } finally {
      await h.close();
    }
  });

  test("wake-ups queue a fleet prompt; missions without sessions fall back", async () => {
    const h = await harnessWithDirector();
    try {
      const m = await h.engine.createMission({
        id: "m-wake",
        repo: "demo",
        source: "chat",
        playbook: "director",
        objective: "lead me",
      });
      await h.engine.submitPlan(m.id, scoutPlan);
      const fallback = await wakeDirector(h.engine, { director: directorClientOf(h) }, "recon");
      expect(fallback.woken).toBe(false);
      expect(fallback.fallback).toContain("fleet_wait");
      const sessionId = await ensureDirectorSession(
        h.engine,
        { director: directorClientOf(h) },
        m.id,
        h.repoDir,
      );
      const woken = await wakeDirector(h.engine, { director: directorClientOf(h) }, "recon");
      expect(woken).toEqual({ woken: true, sessionId });
      const directorFake = h.fakes[h.fakes.length - 1]!;
      const prompts = directorFake.requests.filter((r) => r.path.endsWith("/prompt"));
      const last = prompts[prompts.length - 1]!;
      const body = last.body as { text: string; delivery?: string };
      expect(body.text.startsWith(DIRECTOR_WAKE_PREFIX)).toBe(true);
      expect(body.text).toContain("recon");
      expect(body.text).toContain("fleet_mission_get");
      expect(body.delivery).toBe("queue");
    } finally {
      await h.close();
    }
  });

  test("the engine wake hook fires when a task finishes", async () => {
    const h = await harnessWithDirector();
    try {
      const promptsBefore = h.fakes[h.fakes.length - 1]!.requests.filter((r) =>
        r.path.endsWith("/prompt"),
      ).length;
      h.engine.setWakeHook(directorWakeHook(h.engine, { director: directorClientOf(h) }));
      const m = await h.engine.createMission({
        id: "m-hooked",
        repo: "demo",
        source: "chat",
        playbook: "director",
        objective: "lead me",
      });
      await h.engine.submitPlan(m.id, scoutPlan);
      await ensureDirectorSession(h.engine, { director: directorClientOf(h) }, m.id, h.repoDir);
      await h.engine.tick();
      expect(h.engine.getMission(m.id).tasks[0]?.status).toBe("done");
      const prompts = h.fakes[h.fakes.length - 1]!.requests.filter((r) =>
        r.path.endsWith("/prompt"),
      );
      expect(prompts.length).toBeGreaterThan(promptsBefore);
      const bodies = prompts.map((p) => JSON.stringify(p.body));
      expect(bodies.some((b) => b.includes(DIRECTOR_WAKE_PREFIX))).toBe(true);
    } finally {
      await h.close();
    }
  });

  test("missions waiting for a human need the Director; running ones do not", async () => {
    const h = await harnessWithDirector();
    try {
      const m = await h.engine.createMission({
        id: "m-need",
        repo: "demo",
        source: "chat",
        playbook: "director",
        objective: "lead me",
      });
      await h.engine.submitPlan(m.id, [
        {
          ...scoutPlan[0]!,
          id: "r1",
        },
        {
          ...scoutPlan[0]!,
          id: "r2",
        },
        {
          ...scoutPlan[0]!,
          id: "r3",
        },
        {
          ...scoutPlan[0]!,
          id: "r4",
        },
      ]);
      expect(missionNeedsDirector(h.engine, m.id)).toBe(true);
      await h.engine.approve(m.id);
      expect(missionNeedsDirector(h.engine, m.id)).toBe(false);
    } finally {
      await h.close();
    }
  });
});
