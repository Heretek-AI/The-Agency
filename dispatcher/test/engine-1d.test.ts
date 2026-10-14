import { describe, expect, test } from "bun:test";
import type { DirectorTask } from "../src/plan.js";
import { attachFake, makeServiceHarness } from "./support/service-harness.js";

const scoutTask = (id: string): DirectorTask => ({
  id,
  title: `recon ${id}`,
  role: "recon",
  expert: "scout",
  deps: [],
  trigger: "all_success",
  input: { objective: "look around", acceptance: ["report"], paths: [] },
  policy: { strategy: "fail" },
});

describe("engine Stage 1d extensions", () => {
  test("listMissionIds reports missions in store order", async () => {
    const h = await makeServiceHarness();
    try {
      expect(h.engine.listMissionIds()).toEqual([]);
      await h.engine.createMission({
        id: "m-one",
        repo: "demo",
        source: "api",
        playbook: "director",
        objective: "one",
      });
      await h.engine.createMission({
        id: "m-two",
        repo: "demo",
        source: "api",
        playbook: "director",
        objective: "two",
      });
      expect(h.engine.listMissionIds()).toEqual(["m-one", "m-two"]);
    } finally {
      await h.close();
    }
  });

  test("updatePlan replaces a waiting plan and starts a small one", async () => {
    const h = await makeServiceHarness();
    try {
      await attachFake(h, "scout");
      const m = await h.engine.createMission({
        id: "m-replan",
        repo: "demo",
        source: "api",
        playbook: "director",
        objective: "replan me",
      });
      await h.engine.submitPlan(
        m.id,
        ["a", "b", "c", "d"].map((k) => scoutTask(k)),
      );
      expect(h.engine.getMission(m.id).mission.status).toBe("waiting-human");
      const replaced = await h.engine.updatePlan(m.id, [scoutTask("only")]);
      expect(replaced.map((t) => t.id)).toEqual(["only"]);
      const view = h.engine.getMission(m.id);
      expect(view.mission.status).toBe("running");
      expect(view.tasks.map((t) => t.id)).toEqual(["only"]);
      await h.engine.tick();
      expect(h.engine.getMission(m.id).tasks[0]?.status).toBe("done");
    } finally {
      await h.close();
    }
  });

  test("updatePlan refuses running missions, started tasks, and bad experts", async () => {
    const h = await makeServiceHarness();
    try {
      await attachFake(h, "scout");
      const m = await h.engine.createMission({
        id: "m-frozen",
        repo: "demo",
        source: "api",
        playbook: "director",
        objective: "frozen",
      });
      await h.engine.submitPlan(m.id, [scoutTask("t1")]);
      await expect(h.engine.updatePlan(m.id, [scoutTask("t2")])).rejects.toThrow("not waiting");
      const w = await h.engine.createMission({
        id: "m-bad",
        repo: "demo",
        source: "api",
        playbook: "director",
        objective: "bad",
      });
      await h.engine.submitPlan(
        w.id,
        ["a", "b", "c", "d"].map((k) => scoutTask(k)),
      );
      await expect(
        h.engine.updatePlan(w.id, [{ ...scoutTask("x"), expert: "ghost" }]),
      ).rejects.toThrow("unknown expert");
      await expect(h.engine.updatePlan("m-ghost", [scoutTask("x")])).rejects.toThrow(
        "unknown mission",
      );
    } finally {
      await h.close();
    }
  });

  test("setDirectorSession persists and recordReport lands in the log", async () => {
    const h = await makeServiceHarness();
    try {
      const m = await h.engine.createMission({
        id: "m-session",
        repo: "demo",
        source: "api",
        playbook: "director",
        objective: "session",
      });
      await h.engine.setDirectorSession(m.id, "sess-1");
      expect(h.engine.getMission(m.id).mission.directorSessionId).toBe("sess-1");
      await expect(h.engine.setDirectorSession(m.id, "  ")).rejects.toThrow("empty");
      await h.engine.recordReport(m.id, "all done here");
      expect(JSON.stringify(h.engine.listDecisions(m.id))).toContain("all done here");
      await expect(h.engine.recordReport(m.id, " ")).rejects.toThrow("empty");
    } finally {
      await h.close();
    }
  });

  test("stored results keep the report text and permission rejections", async () => {
    const h = await makeServiceHarness();
    try {
      await attachFake(h, "scout");
      const m = await h.engine.createMission({
        id: "m-raw",
        repo: "demo",
        source: "api",
        playbook: "director",
        objective: "raw",
      });
      await h.engine.submitPlan(m.id, [scoutTask("t1")]);
      await h.engine.tick();
      const task = h.engine.getMission(m.id).tasks[0]!;
      const result = task.result as Record<string, unknown>;
      expect(typeof result["raw"]).toBe("string");
      expect(result["raw"] as string).toContain("finished");
      expect(Array.isArray(result["permissionRejections"])).toBe(true);
    } finally {
      await h.close();
    }
  });
});
