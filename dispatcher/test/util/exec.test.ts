import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { baseEnv } from "../../src/config.js";
import { execCmd } from "../../src/util/exec.js";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function goneSoon(pid: number, tries = 50): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !alive(pid);
}

describe("exec", () => {
  test("defect: child sees only the explicit environment", async () => {
    process.env["AGENCY_STAGE0_CANARY"] = "canary-value-visible-if-inherited";
    try {
      const res = await execCmd(["sh", "-c", "env"], {
        cwd: tmpdir(),
        env: { ...baseEnv(), AGENCY_STAGE0_MARKER: "present" },
        timeoutMs: 10_000,
      });
      expect(res.exit).toBe(0);
      expect(res.stdout).toContain("AGENCY_STAGE0_MARKER=present");
      expect(res.stdout).not.toContain("AGENCY_STAGE0_CANARY");
      expect(res.stdout).not.toContain("canary-value-visible-if-inherited");
    } finally {
      delete process.env["AGENCY_STAGE0_CANARY"];
    }
  });

  test("defect: timeout kills the whole process group", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agency-exec-"));
    const pidFile = path.join(dir, "sleeper.pid");
    const res = await execCmd(["sh", "-c", `sleep 30 & echo $! > ${pidFile}; wait`], {
      cwd: dir,
      env: baseEnv(),
      timeoutMs: 1_000,
    });
    expect(res.timedOut).toBe(true);
    expect(res.exit).toBe(124);
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(Number.isInteger(pid) && pid > 0).toBe(true);
    try {
      expect(await goneSoon(pid)).toBe(true);
    } finally {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });

  test("exit code passthrough", async () => {
    const res = await execCmd(["sh", "-c", "exit 3"], { cwd: tmpdir(), env: baseEnv() });
    expect(res.exit).toBe(3);
    expect(res.timedOut).toBe(false);
  });

  test("missing binary gives 127", async () => {
    const res = await execCmd(["agency-no-such-binary-xyz"], { cwd: tmpdir(), env: baseEnv() });
    expect(res.exit).toBe(127);
  });

  test("output cap holds", async () => {
    const res = await execCmd(["sh", "-c", "yes x | head -c 100000"], {
      cwd: tmpdir(),
      env: baseEnv(),
      maxOutputBytes: 1000,
    });
    expect(res.exit).toBe(0);
    expect(res.stdout.length).toBeLessThanOrEqual(1000);
  });
});
