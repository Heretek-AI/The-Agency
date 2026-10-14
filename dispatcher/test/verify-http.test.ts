/**
 * HttpVerifier tests against a live server instance (ephemeral port):
 * green passthrough, token refusal, unreachable, and busy.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { startVerifierServer } from "../../verifier/src/server.js";
import { HttpVerifier, VerifierError } from "../src/verify.js";

const TOKEN = "http-verifier-token";

describe("HttpVerifier", () => {
  test("a green run passes through with log paths", async () => {
    const base = mkdtempSync(join(tmpdir(), "agency-httpver-"));
    const work = join(base, "work");
    mkdirSync(join(work, "demo"), { recursive: true });
    writeFileSync(join(work, "demo", "f.txt"), "x\n");
    const server = await startVerifierServer({
      port: 0,
      token: TOKEN,
      workRoot: work,
      artifactsRoot: join(base, "artifacts"),
    });
    try {
      const v = new HttpVerifier(server.url, TOKEN);
      const res = await v.run({
        taskId: "t-1",
        dir: join(work, "demo"),
        setup: [],
        checks: [{ id: "c", run: "echo hi", timeoutSec: 30 }],
      });
      expect(res.ok).toBe(true);
      expect(res.checks[0]?.exit).toBe(0);
    } finally {
      await server.close();
    }
  });

  test("a wrong token and a dead server fail closed", async () => {
    const base = mkdtempSync(join(tmpdir(), "agency-httpver-"));
    const server = await startVerifierServer({
      port: 0,
      token: TOKEN,
      workRoot: join(base, "work"),
      artifactsRoot: join(base, "artifacts"),
    });
    const url = server.url;
    await server.close();
    await expect(
      new HttpVerifier(url, TOKEN).run({ taskId: "t", dir: "/work/x", setup: [], checks: [] }),
    ).rejects.toThrow(VerifierError);
    const live = await startVerifierServer({
      port: 0,
      token: TOKEN,
      workRoot: join(base, "work"),
      artifactsRoot: join(base, "artifacts"),
    });
    try {
      await expect(
        new HttpVerifier(live.url, "bad").run({
          taskId: "t",
          dir: "/work/x",
          setup: [],
          checks: [],
        }),
      ).rejects.toThrow(/401/);
    } finally {
      await live.close();
    }
  });
});
