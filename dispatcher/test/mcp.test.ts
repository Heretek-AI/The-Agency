import { describe, expect, test } from "bun:test";
import { handleMcpHttp, toolNames, type McpContext } from "../src/mcp.js";
import {
  attachFake,
  loginToken,
  makeServiceHarness,
  resultBlock,
  startTestHttp,
  type ServiceHarness,
} from "./support/service-harness.js";

const MCP_TOKEN = "test-fleet-mcp-token";

function ctxFor(h: ServiceHarness): McpContext {
  return {
    token: MCP_TOKEN,
    engine: h.engine,
    fleet: h.deps.fleet,
    clients: h.clients,
    registries: h.deps.registries,
    defaultRepo: "demo",
  };
}

async function rpc(
  h: ServiceHarness,
  method: string,
  params: unknown,
  token: string | null = MCP_TOKEN,
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  const res = await handleMcpHttp(ctxFor(h), {
    method: "POST",
    headers,
    bodyText: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
  });
  return { status: res.status, body: JSON.parse(res.body) as unknown };
}

async function tool(
  h: ServiceHarness,
  name: string,
  args: Record<string, unknown>,
  token: string | null = MCP_TOKEN,
): Promise<{ ok: boolean; text: string }> {
  const { status, body } = await rpc(h, "tools/call", { name, arguments: args }, token);
  expect(status).toBe(200);
  const envelope = body as { result?: { content?: { text?: string }[]; isError?: boolean } };
  const result = envelope.result!;
  const text = result.content!.map((c) => c.text ?? "").join("\n");
  return { ok: result.isError !== true, text };
}

const scoutPlan = (key = "recon") => ({
  key,
  expert: "scout",
  title: "recon",
  objective: "map the repository",
  acceptance: ["report written"],
  paths: [],
  deps: [],
});

describe("fleet MCP transport", () => {
  test("initialize and tools/list expose nine tools", async () => {
    const h = await makeServiceHarness();
    try {
      const init = await rpc(h, "initialize", {});
      expect(init.status).toBe(200);
      expect((init.body as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
        "2025-06-18",
      );
      const list = await rpc(h, "tools/list", {});
      const tools = (list.body as { result: { tools: { name: string }[] } }).result.tools;
      expect(tools.map((t) => t.name).sort()).toEqual(toolNames().sort());
      expect(toolNames()).toHaveLength(9);
    } finally {
      await h.close();
    }
  });

  test("a missing or wrong token is refused before the engine runs", async () => {
    const h = await makeServiceHarness();
    try {
      const missing = await rpc(h, "tools/list", {}, null);
      expect(missing.status).toBe(401);
      const wrong = await rpc(h, "tools/list", {}, "wrong-token");
      expect(wrong.status).toBe(401);
      expect(h.engine.listMissionIds()).toEqual([]);
      const get = await handleMcpHttp(ctxFor(h), {
        method: "GET",
        headers: new Headers(),
        bodyText: "",
      });
      expect(get.status).toBe(405);
    } finally {
      await h.close();
    }
  });

  test("malformed envelopes fail as JSON-RPC errors", async () => {
    const h = await makeServiceHarness();
    try {
      const bad = await handleMcpHttp(ctxFor(h), {
        method: "POST",
        headers: new Headers({ authorization: `Bearer ${MCP_TOKEN}` }),
        bodyText: "{not json",
      });
      expect(bad.status).toBe(400);
      expect(JSON.parse(bad.body).error.code).toBe(-32700);
      const unknown = await rpc(h, "no/such/method", {});
      expect((unknown.body as { error: { code: number } }).error.code).toBe(-32601);
      const toolUnknown = await rpc(h, "tools/call", { name: "fleet_nope", arguments: {} });
      expect((toolUnknown.body as { error: { code: number } }).error.code).toBe(-32602);
    } finally {
      await h.close();
    }
  });
});

describe("fleet MCP tools", () => {
  test("fleet_roster reports experts with health and load", async () => {
    const h = await makeServiceHarness();
    try {
      await attachFake(h, "scout");
      const { ok, text } = await tool(h, "fleet_roster", {});
      expect(ok).toBe(true);
      expect(text).toContain("scout");
      expect(text).toContain("health=healthy");
      expect(text).toContain("Full data:");
    } finally {
      await h.close();
    }
  });

  test("fleet_mission_create returns an id with the ownership summary", async () => {
    const h = await makeServiceHarness();
    try {
      const { ok, text } = await tool(h, "fleet_mission_create", { objective: "explore" });
      expect(ok).toBe(true);
      expect(text).toMatch(/missionId: m-/);
      expect(text).toContain("write grants");
      const empty = await tool(h, "fleet_mission_create", { objective: "  " });
      expect(empty.ok).toBe(false);
      const repo = await tool(h, "fleet_mission_create", {
        objective: "x",
        repo: "no-such-repo",
      });
      expect(repo.ok).toBe(false);
      expect(repo.text).toContain("unknown repository");
    } finally {
      await h.close();
    }
  });

  test("fleet_plan_submit validates experts, grants, and the graph", async () => {
    const h = await makeServiceHarness();
    try {
      await attachFake(h, "scout");
      const created = await tool(h, "fleet_mission_create", { objective: "explore" });
      const missionId = /missionId: (\S+)/.exec(created.text)![1]!;
      const submitted = await tool(h, "fleet_plan_submit", {
        missionId,
        tasks: [scoutPlan()],
      });
      expect(submitted.ok).toBe(true);
      expect(submitted.text).toContain("status: running");

      const unknownExpert = await tool(h, "fleet_plan_submit", {
        missionId,
        tasks: [{ ...scoutPlan("other"), expert: "no-such-expert" }],
      });
      expect(unknownExpert.ok).toBe(false);

      const fresh = await tool(h, "fleet_mission_create", { objective: "second" });
      const secondId = /missionId: (\S+)/.exec(fresh.text)![1]!;
      const outside = await tool(h, "fleet_plan_submit", {
        missionId: secondId,
        tasks: [
          {
            key: "doc",
            expert: "docs",
            title: "doc",
            objective: "write",
            acceptance: ["written"],
            paths: ["src/secret.ts"],
            deps: [],
          },
        ],
      });
      expect(outside.ok).toBe(false);
      expect(outside.text).toContain("outside");

      const cyclic = await tool(h, "fleet_plan_submit", {
        missionId: secondId,
        tasks: [
          { ...scoutPlan("a"), deps: ["b"] },
          { ...scoutPlan("b"), deps: ["a"] },
        ],
      });
      expect(cyclic.ok).toBe(false);

      const empty = await tool(h, "fleet_plan_submit", { missionId: secondId, tasks: [] });
      expect(empty.ok).toBe(false);
    } finally {
      await h.close();
    }
  });

  test("fleet_task_result carries the report, files, and artifact paths", async () => {
    const h = await makeServiceHarness();
    try {
      await attachFake(h, "scout");
      const created = await tool(h, "fleet_mission_create", { objective: "explore" });
      const missionId = /missionId: (\S+)/.exec(created.text)![1]!;
      await tool(h, "fleet_plan_submit", { missionId, tasks: [scoutPlan()] });
      await h.engine.tick();
      const view = h.engine.getMission(missionId);
      expect(view.tasks[0]?.status).toBe("done");
      const { ok, text } = await tool(h, "fleet_task_result", { taskId: "recon" });
      expect(ok).toBe(true);
      expect(text).toContain("finished");
      expect(text).toContain("policy");
      expect(text).toContain("Full data:");
      const unknown = await tool(h, "fleet_task_result", { taskId: "nope" });
      expect(unknown.ok).toBe(false);
      const tiny = await tool(h, "fleet_task_result", { taskId: "recon", maxBytes: 20 });
      expect(tiny.ok).toBe(true);
      expect(tiny.text).toContain("truncated");
    } finally {
      await h.close();
    }
  });

  test("fleet_task_diff bounds output and scopes to one file", async () => {
    const h = await makeServiceHarness();
    try {
      await attachFake(h, "docs", {
        rules: [],
        defaultSteps: [
          { kind: "write", path: "README.md", content: "hello docs\n" },
          { kind: "commit", message: "docs: readme" },
          { kind: "message", role: "assistant", content: resultBlock("readme updated") },
        ],
      });
      const created = await tool(h, "fleet_mission_create", { objective: "document" });
      const missionId = /missionId: (\S+)/.exec(created.text)![1]!;
      await tool(h, "fleet_plan_submit", {
        missionId,
        tasks: [
          {
            key: "doc",
            expert: "docs",
            title: "doc",
            objective: "update the readme",
            acceptance: ["readme updated"],
            paths: ["README.md"],
            deps: [],
          },
        ],
      });
      await h.engine.tick();
      const full = await tool(h, "fleet_task_diff", { taskId: "doc" });
      expect(full.ok).toBe(true);
      expect(full.text).toContain("README.md");
      const scoped = await tool(h, "fleet_task_diff", { taskId: "doc", file: "README.md" });
      expect(scoped.ok).toBe(true);
      const absent = await tool(h, "fleet_task_diff", { taskId: "doc", file: "nope.ts" });
      expect(absent.ok).toBe(false);
      const tiny = await tool(h, "fleet_task_diff", { taskId: "doc", maxBytes: 10 });
      expect(tiny.text).toContain("truncated");
    } finally {
      await h.close();
    }
  });

  test("fleet_decide abandons and records validation failures", async () => {
    const h = await makeServiceHarness();
    try {
      await attachFake(h, "scout");
      const created = await tool(h, "fleet_mission_create", { objective: "explore" });
      const missionId = /missionId: (\S+)/.exec(created.text)![1]!;
      await tool(h, "fleet_plan_submit", { missionId, tasks: [scoutPlan()] });
      const abandoned = await tool(h, "fleet_decide", {
        taskId: "recon",
        decision: "abandon",
        notes: "not needed",
      });
      expect(abandoned.ok).toBe(true);
      const view = h.engine.getMission(missionId);
      expect(view.tasks[0]?.status).toBe("cancelled");
      expect(h.engine.listDecisions(missionId)).toHaveLength(1);
      const bad = await tool(h, "fleet_decide", { taskId: "recon", decision: "merge" });
      expect(bad.ok).toBe(false);
      const rework = await tool(h, "fleet_decide", { taskId: "recon", decision: "rework" });
      expect(rework.ok).toBe(false);
    } finally {
      await h.close();
    }
  });

  test("fleet_wait returns on change and at the timeout", async () => {
    const h = await makeServiceHarness();
    try {
      const created = await tool(h, "fleet_mission_create", { objective: "explore" });
      const missionId = /missionId: (\S+)/.exec(created.text)![1]!;
      const idle = await tool(h, "fleet_wait", { missionId, timeoutSec: 1 });
      expect(idle.ok).toBe(true);
      expect(idle.text).toContain("no change");
      const waiting = tool(h, "fleet_wait", { missionId, timeoutSec: 10 });
      await new Promise((r) => setTimeout(r, 300));
      await tool(h, "fleet_mission_create", { objective: "another" });
      const changed = await waiting;
      expect(changed.ok).toBe(true);
      expect(changed.text).toContain("changed after");
      const tooLong = await tool(h, "fleet_wait", { missionId, timeoutSec: 601 });
      expect(tooLong.ok).toBe(false);
    } finally {
      await h.close();
    }
  });

  test("fleet_mission_close refuses an unfinished mission and closes a done one", async () => {
    const h = await makeServiceHarness();
    try {
      await attachFake(h, "docs", {
        rules: [],
        defaultSteps: [
          { kind: "write", path: "README.md", content: "hello\n" },
          { kind: "commit", message: "docs" },
          { kind: "message", role: "assistant", content: resultBlock("done") },
        ],
      });
      const created = await tool(h, "fleet_mission_create", { objective: "document" });
      const missionId = /missionId: (\S+)/.exec(created.text)![1]!;
      await tool(h, "fleet_plan_submit", {
        missionId,
        tasks: [
          {
            key: "doc",
            expert: "docs",
            title: "doc",
            objective: "update the readme",
            acceptance: ["readme updated"],
            paths: ["README.md"],
            deps: [],
          },
        ],
      });
      const early = await tool(h, "fleet_mission_close", { missionId, summary: "too soon" });
      expect(early.ok).toBe(false);
      expect(early.text).toContain(missionId);

      const scouted = await tool(h, "fleet_mission_create", { objective: "explore" });
      const scoutId = /missionId: (\S+)/.exec(scouted.text)![1]!;
      await attachFake(h, "scout");
      await tool(h, "fleet_plan_submit", { missionId: scoutId, tasks: [scoutPlan()] });
      await h.engine.tick();
      const closed = await tool(h, "fleet_mission_close", {
        missionId: scoutId,
        summary: "mapped the repo",
      });
      expect(closed.ok).toBe(true);
      const view = h.engine.getMission(scoutId);
      expect(view.mission.status).toBe("done");
      expect(JSON.stringify(h.engine.listDecisions(scoutId))).toContain("mapped the repo");
    } finally {
      await h.close();
    }
  });

  test("oversized output truncates and names the full location", async () => {
    const h = await makeServiceHarness();
    try {
      const big = await tool(h, "fleet_mission_create", { objective: `x${"y".repeat(20000)}` });
      expect(big.ok).toBe(true);
      const missionId = /missionId: (\S+)/.exec(big.text)![1]!;
      const gotten = await tool(h, "fleet_mission_get", { missionId });
      expect(gotten.ok).toBe(true);
      expect(gotten.text.length).toBeLessThan(20000);
      expect(gotten.text).toContain("truncated");
      expect(gotten.text).toContain("Full data:");
    } finally {
      await h.close();
    }
  });

  test("the MCP tools reach the engine through the HTTP server too", async () => {
    const h = await makeServiceHarness();
    try {
      await attachFake(h, "scout");
      const url = await startTestHttp(h);
      const { token } = await loginToken(url, "viewer");
      void token;
      const res = await fetch(`${url}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${MCP_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "fleet_roster", arguments: {} },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: { content: { text: string }[] } };
      expect(body.result.content[0]?.text).toContain("scout");
    } finally {
      await h.close();
    }
  });
});
