import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { MissionStatuses } from "../src/model.js";
import {
  bearer,
  loginToken,
  makeServiceHarness,
  startTestHttp,
} from "./support/service-harness.js";

/**
 * Stage 1e backend seams for the web UI: the usage headroom endpoint
 * and static file serving for the built bundle.
 */

function webRootWithBuild(): string {
  const dir = `${process.env["TMPDIR"] ?? tmpdir()}/agency-web-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  writeFileSync(
    path.join(dir, "index.html"),
    "<!doctype html><html><head><title>The Agency</title></head><body>ui</body></html>",
  );
  writeFileSync(path.join(dir, "assets", "app.js"), "console.log(1);");
  return dir;
}

describe("web serving and usage", () => {
  test("GET / serves the built bundle and SPA routes fall back to index.html", async () => {
    const h = await makeServiceHarness();
    try {
      const url = await startTestHttp(h, { webRoot: webRootWithBuild() });
      const index = await fetch(`${url}/`);
      expect(index.status).toBe(200);
      expect(index.headers.get("content-type")).toContain("text/html");
      expect(await index.text()).toContain("The Agency");
      const asset = await fetch(`${url}/assets/app.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toContain("javascript");
      const spa = await fetch(`${url}/missions/m-1`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain("The Agency");
      const missing = await fetch(`${url}/assets/nope.js`);
      expect(missing.status).toBe(404);
      const traversal = await fetch(`${url}/..%2f..%2fetc%2fpasswd`);
      expect([400, 403, 404]).toContain(traversal.status);
    } finally {
      await h.close();
    }
  });

  test("GET / without a build keeps the JSON 404 and API routes are untouched", async () => {
    const h = await makeServiceHarness();
    try {
      const url = await startTestHttp(h, { webRoot: `${tmpdir()}/agency-web-missing` });
      const index = await fetch(`${url}/`);
      expect(index.status).toBe(404);
      expect(((await index.json()) as { error: string }).error).toBe("not found");
      const ghost = await fetch(`${url}/api/missions/m-nope`);
      expect(ghost.status).toBe(401);
    } finally {
      await h.close();
    }
  });

  test("GET /api/usage reports computed mission headroom and requires login", async () => {
    const h = await makeServiceHarness();
    try {
      const url = await startTestHttp(h);
      const anonymous = await fetch(`${url}/api/usage`);
      expect(anonymous.status).toBe(401);
      const approver = await loginToken(url, "approver");
      const before = (await (
        await fetch(`${url}/api/usage`, { headers: bearer(approver.token) })
      ).json()) as {
        runningMissions: number;
        waitingHuman: number;
        maxConcurrent: number;
      };
      expect(before.runningMissions).toBe(0);
      expect(before.waitingHuman).toBe(0);
      expect(before.maxConcurrent).toBeGreaterThan(0);
      const created = await h.engine.createMission({
        repo: "demo",
        source: "api",
        playbook: "director",
        objective: "usage probe",
      });
      await h.engine.submitPlan(created.id, [
        {
          id: "usage-t1",
          title: "probe",
          role: "recon",
          expert: "scout",
          deps: [],
          trigger: "all_success",
          input: { objective: "probe", acceptance: ["done"], paths: [] },
          policy: { strategy: "fail" },
        },
      ]);
      expect(h.engine.getMission(created.id).mission.status).toBe(MissionStatuses.running);
      const after = (await (
        await fetch(`${url}/api/usage`, { headers: bearer(approver.token) })
      ).json()) as { runningMissions: number };
      expect(after.runningMissions).toBe(1);
    } finally {
      await h.close();
    }
  });
});
