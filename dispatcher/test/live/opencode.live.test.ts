/**
 * Live OpenCode integration: real HTTP against a real `opencode serve`.
 * Run only by scripts/accept/0/09-opencode-live.sh. If no `opencode` binary
 * is on PATH the suite reports a skip (early return) instead of failing;
 * every skip path is logged, never silent.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { OpenCodeClient } from "../../src/opencode.js";

const PORT = Number(process.env["OPENCODE_TEST_PORT"] ?? 4199);
const PASSWORD = "test-password-123";
const BIN = process.env["OPENCODE_BIN"] ?? "opencode";

const adapter = new OpenCodeClient({
  baseUrl: `http://127.0.0.1:${PORT}`,
  password: PASSWORD,
});

let serverProc: ChildProcess | null = null;
let skipReason: string | null = null;
let workdir = "";

function skipOrLive(): boolean {
  if (skipReason !== null) {
    console.warn(`[opencode-live] SKIP: ${skipReason}`);
    return true;
  }
  return false;
}

async function pollInfo(timeoutMs: number): Promise<{ version?: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const h = await adapter.info();
      if (h.ok) return h;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `live server on :${PORT} never became ready: ${(lastErr as Error)?.message ?? lastErr}`,
  );
}

beforeAll(async () => {
  workdir = mkdtempSync(join(tmpdir(), "agency-opencode-live-"));
  try {
    serverProc = spawn(BIN, ["serve", "--port", String(PORT), "--hostname", "127.0.0.1"], {
      cwd: workdir,
      env: { ...process.env, OPENCODE_PASSWORD: PASSWORD },
      stdio: "ignore",
    });
  } catch (err) {
    skipReason = `could not spawn "${BIN}": ${(err as Error).message}. Install OpenCode v2 or set OPENCODE_BIN.`;
    return;
  }
  await new Promise<void>((resolve) => {
    if (serverProc === null) return resolve();
    serverProc.once("error", (err: Error) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        skipReason = `binary "${BIN}" not found on PATH. Install OpenCode v2 (opencode.ai) or set OPENCODE_BIN to skip gracefully.`;
      } else {
        skipReason = `server process error: ${err.message}`;
      }
      resolve();
    });
    serverProc.once("spawn", () => resolve());
  });
  if (skipReason !== null || serverProc === null) return;
  const exited = await new Promise<number | null>((resolve) => {
    if (serverProc === null) return resolve(null);
    let done = false;
    serverProc.once("exit", (code) => {
      if (!done) {
        done = true;
        resolve(code);
      }
    });
    setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, 500);
  });
  if (exited !== null) {
    skipReason = null;
    throw new Error(`"${BIN} serve" exited immediately with code ${exited}`);
  }
  await pollInfo(30_000);
}, 45_000);

afterAll(async () => {
  if (serverProc !== null) {
    const proc = serverProc;
    serverProc = null;
    proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      let done = false;
      proc.once("exit", () => {
        if (!done) {
          done = true;
          resolve();
        }
      });
      setTimeout(() => {
        if (!done) {
          done = true;
          try {
            proc.kill("SIGKILL");
          } catch {
            // already gone
          }
          resolve();
        }
      }, 3000);
    });
  }
});

test("live host /api/info reports ok with a v2 version", async () => {
  if (skipOrLive()) return;
  const h = await adapter.info();
  expect(h.ok).toBe(true);
  expect(typeof h.version).toBe("string");
  expect(h.version as string).toMatch(/^2\./);
}, 30_000);

test("live host session lifecycle: create, prompt, wait, diff, messages, delete", async () => {
  if (skipOrLive()) return;
  const created = await adapter.createSession({ location: { directory: workdir } });
  expect(created.id.length).toBeGreaterThan(0);
  const sessionId = created.id;

  // Prompt admission is async: the endpoint returns the admitted user inbox
  // item, NOT the assistant answer.
  const marker = `opencode-live-probe-${Date.now()}`;
  const admitted = await adapter.prompt(
    sessionId,
    `Reply with exactly: live-test-ok. Do not use any tools. (${marker})`,
  );
  expect(admitted.inboxId.length).toBeGreaterThan(0);

  // Race-free idle barrier: resolves 204 once the agent loop drains.
  await adapter.wait(sessionId, 90_000);

  // Diff shape is host-defined; assert the envelope contract only.
  const diffs = await adapter.diff(sessionId);
  expect(Array.isArray(diffs)).toBe(true);

  // The admitted user message must be retrievable verbatim.
  const messages = await adapter.listMessages(sessionId);
  expect(messages.length).toBeGreaterThan(0);
  const seen = messages.some((m) => JSON.stringify(m).includes(marker));
  expect(seen).toBe(true);

  await adapter.deleteSession(sessionId);
}, 120_000);
