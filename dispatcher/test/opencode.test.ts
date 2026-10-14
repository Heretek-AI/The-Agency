import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { OpenCodeClient, OpenCodeError } from "../src/opencode.js";
import type { FakeOpenCode } from "./support/fake-opencode.js";
import {
  FAKE_ROUTES,
  checkRoutesAgainstOpenApi,
  loadOpenApiSpec,
  startFakeOpenCode,
} from "./support/fake-opencode.js";
import { gitHead, makeTmpGitRepo } from "./support/git.js";

const PASSWORD = "stage0-fake-pw";
let fake: FakeOpenCode | null = null;

afterEach(async () => {
  if (fake) {
    await fake.close();
    fake = null;
  }
});

function client(): OpenCodeClient {
  return new OpenCodeClient({ baseUrl: fake!.url, password: PASSWORD });
}

describe("opencode client against the fake", () => {
  test("info reports ok with a version", async () => {
    fake = await startFakeOpenCode({ password: PASSWORD });
    const info = await client().info();
    expect(info.ok).toBe(true);
    expect(info.version).toBe("2.0.26");
  });

  test("session lifecycle: create, get, prompt, wait, messages, diff, interrupt, delete", async () => {
    fake = await startFakeOpenCode({
      password: PASSWORD,
      script: { rules: [{ steps: [{ kind: "message", role: "assistant", content: "hello" }] }] },
    });
    const c = client();
    const repo = makeTmpGitRepo();
    const created = await c.createSession({ title: "t", location: { directory: repo } });
    expect(created.id.startsWith("ses-")).toBe(true);
    const got = (await c.sessionInfo(created.id)) as { id: string };
    expect(got.id).toBe(created.id);
    const marker = `probe-${Date.now()}`;
    const admitted = await c.prompt(created.id, marker);
    expect(admitted.inboxId.length).toBeGreaterThan(0);
    await c.waitIdle(created.id, 10_000);
    const messages = await c.messages(created.id);
    expect(messages.some((m) => JSON.stringify(m).includes(marker))).toBe(true);
    expect(messages.some((m) => m["content"] === "hello")).toBe(true);
    expect(await c.diff(created.id)).toEqual([]);
    await c.interrupt(created.id);
    await c.deleteSession(created.id);
    await expect(c.sessionInfo(created.id)).rejects.toBeInstanceOf(OpenCodeError);
  });

  test("requests without a password get 401", async () => {
    fake = await startFakeOpenCode({ password: PASSWORD });
    const anon = new OpenCodeClient({ baseUrl: fake.url });
    const err = await anon.info().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenCodeError);
    expect((err as OpenCodeError).status).toBe(401);
  });

  test("a 500 from the fake surfaces as a thrown error", async () => {
    fake = await startFakeOpenCode({
      password: PASSWORD,
      script: { rules: [{ steps: [{ kind: "error", message: "rate_limit", status: 500 }] }] },
    });
    const c = client();
    const repo = makeTmpGitRepo();
    const created = await c.createSession({ location: { directory: repo } });
    await c.prompt(created.id, "go");
    const err = await c.waitIdle(created.id, 10_000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenCodeError);
    expect((err as OpenCodeError).status).toBe(500);
    expect((err as OpenCodeError).message).toContain("POST /api/experimental/session/");
  });

  test("createSession sends agent, location, permissions, metadata", async () => {
    fake = await startFakeOpenCode({ password: PASSWORD });
    const repo = makeTmpGitRepo();
    const permissions = [{ action: "read", resource: "*", effect: "allow" }];
    const metadata = { mission: "m-1" };
    await client().createSession({
      title: "t",
      agent: "backend",
      location: { directory: repo },
      permissions,
      metadata,
    });
    const recorded = fake.requests.find((r) => r.method === "POST" && r.path === "/api/session");
    expect(recorded?.body).toEqual({
      title: "t",
      agent: "backend",
      location: { directory: repo },
      permissions,
      metadata,
    });
  });

  test("every operation the client uses exists in openapi.json", async () => {
    const { spec } = await loadOpenApiSpec();
    expect(checkRoutesAgainstOpenApi(FAKE_ROUTES, spec)).toEqual([]);
    const { OPENCODE_OPERATIONS } = await import("../src/opencode.js");
    const missing = checkRoutesAgainstOpenApi(
      OPENCODE_OPERATIONS.map((op) => ({
        method: op.method,
        pattern: op.path.replace(/\{([^/]+)\}/g, ":$1"),
      })),
      spec,
    );
    expect(missing).toEqual([]);
  });

  test("assertContract passes against the fake and names a removed operation", async () => {
    fake = await startFakeOpenCode({ password: PASSWORD });
    await expect(client().assertContract()).resolves.toBeUndefined();
    const { spec } = await loadOpenApiSpec();
    const reduced = {
      paths: Object.fromEntries(
        Object.entries(spec.paths).filter(
          ([p, ops]) => !(p === "/api/session/{sessionID}/diff" && ops["get"] !== undefined),
        ),
      ),
    };
    const missing = checkRoutesAgainstOpenApi(
      [{ method: "GET", pattern: "/api/session/:sessionID/diff" }],
      reduced,
    );
    expect(missing).toEqual(["GET /api/session/{sessionID}/diff"]);
    const failing = new OpenCodeClient({
      baseUrl: fake.url,
      password: PASSWORD,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        const res = await fetch(url, init);
        if (new URL(res.url).pathname === "/openapi.json") {
          return new Response(JSON.stringify(reduced), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return res;
      }) as typeof fetch,
    });
    await expect(failing.assertContract()).rejects.toThrow("GET /api/session/{sessionID}/diff");
  });

  test("every route the fake serves exists in openapi.json", async () => {
    const { spec } = await loadOpenApiSpec();
    const { checkFakeRoutesAgainstOpenApi } = await import("./support/fake-opencode.js");
    expect(checkFakeRoutesAgainstOpenApi(spec)).toEqual([]);
  });

  test("a scripted session that writes and commits leaves that commit in the directory", async () => {
    const repo = makeTmpGitRepo();
    const before = gitHead(repo);
    fake = await startFakeOpenCode({
      password: PASSWORD,
      script: {
        rules: [
          {
            matchPrompt: "build it",
            steps: [
              { kind: "write", path: "feature.txt", content: "feature\n" },
              { kind: "commit", message: "fake: add feature" },
              { kind: "message", role: "assistant", content: "done" },
            ],
          },
        ],
      },
    });
    const c = client();
    const created = await c.createSession({ location: { directory: repo } });
    await c.prompt(created.id, "please build it");
    await c.waitIdle(created.id, 15_000);
    expect(gitHead(repo)).not.toBe(before);
    const log = execFileSync("git", ["log", "--oneline", "-1"], { cwd: repo }).toString();
    expect(log).toContain("fake: add feature");
    expect(existsSync(`${repo}/feature.txt`)).toBe(true);
    expect(readFileSync(`${repo}/feature.txt`, "utf8")).toBe("feature\n");
  });

  test("a permission step waits for the reply", async () => {
    fake = await startFakeOpenCode({
      password: PASSWORD,
      script: { rules: [{ steps: [{ kind: "permission", tool: "shell", detail: "run tests" }] }] },
    });
    const c = client();
    const repo = makeTmpGitRepo();
    const created = await c.createSession({ location: { directory: repo } });
    await c.prompt(created.id, "go");
    const auth = { authorization: `Basic ${btoa(`opencode:${PASSWORD}`)}` };
    const listed = (await (
      await fetch(`${fake.url}/api/session/${created.id}/permission`, { headers: auth })
    ).json()) as {
      data: { requestID: string }[];
    };
    expect(listed.data.length).toBe(1);
    const reply = await fetch(
      `${fake.url}/api/session/${created.id}/permission/${listed.data[0]!.requestID}/reply`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ decision: "once" }),
      },
    );
    expect(reply.status).toBe(204);
    await c.waitIdle(created.id, 15_000);
  });

  test("events stream on /api/event as SSE", async () => {
    fake = await startFakeOpenCode({ password: PASSWORD });
    const auth = { authorization: `Basic ${btoa(`opencode:${PASSWORD}`)}` };
    const controller = new AbortController();
    const res = await fetch(`${fake.url}/api/event`, { headers: auth, signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await client().createSession({ location: { directory: makeTmpGitRepo() } });
    let seen = "";
    for (let i = 0; i < 5 && !seen.includes("session.created"); i++) {
      const { value } = await reader.read();
      seen += Buffer.from(value!).toString();
    }
    controller.abort();
    expect(seen).toContain("session.created");
  });
});
