import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { baseEnv } from "../../dispatcher/src/config.js";
import { NoChecksError, runChecks } from "../src/run-checks.js";

function dirs(): { dir: string; artifacts: string } {
  return {
    dir: mkdtempSync(path.join(tmpdir(), "agency-verify-")),
    artifacts: mkdtempSync(path.join(tmpdir(), "agency-art-")),
  };
}

describe("run-checks", () => {
  test("defect: empty check list is an error", async () => {
    const { dir, artifacts } = dirs();
    await expect(
      runChecks({ dir, setup: [], checks: [], artifactsDir: artifacts, env: baseEnv() }),
    ).rejects.toBeInstanceOf(NoChecksError);
    await expect(
      runChecks({
        dir,
        setup: [],
        checks: undefined as unknown as [],
        artifactsDir: artifacts,
        env: baseEnv(),
      }),
    ).rejects.toBeInstanceOf(NoChecksError);
  });

  test("all green reports every check with logs", async () => {
    const { dir, artifacts } = dirs();
    const result = await runChecks({
      dir,
      setup: ["echo ready"],
      checks: [
        { id: "a", run: "echo output-a", timeoutSec: 30 },
        { id: "b", run: "echo output-b", timeoutSec: 30 },
      ],
      artifactsDir: artifacts,
      env: baseEnv(),
    });
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.id)).toEqual(["a", "b"]);
    for (const c of result.checks) {
      expect(c.exit).toBe(0);
      expect(c.timedOut).toBe(false);
      expect(c.logPath.startsWith(artifacts)).toBe(true);
      expect(c.outputHash.startsWith("sha256:")).toBe(true);
    }
    expect(readFileSync(path.join(artifacts, "verify", "a.log"), "utf8")).toContain("output-a");
  });

  test("one red among three still reports all three", async () => {
    const { dir, artifacts } = dirs();
    const result = await runChecks({
      dir,
      setup: [],
      checks: [
        { id: "a", run: "exit 0", timeoutSec: 30 },
        { id: "b", run: "exit 1", timeoutSec: 30 },
        { id: "c", run: "exit 0", timeoutSec: 30 },
      ],
      artifactsDir: artifacts,
      env: baseEnv(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("checks");
    expect(result.checks.map((c) => `${c.id}=${c.exit}`)).toEqual(["a=0", "b=1", "c=0"]);
  });

  test("a timeout reports 124 and timedOut", async () => {
    const { dir, artifacts } = dirs();
    const result = await runChecks({
      dir,
      setup: [],
      checks: [{ id: "slow", run: "sleep 30", timeoutSec: 1 }],
      artifactsDir: artifacts,
      env: baseEnv(),
    });
    expect(result.ok).toBe(false);
    expect(result.checks[0]!.exit).toBe(124);
    expect(result.checks[0]!.timedOut).toBe(true);
  });

  test("a setup failure ends the run with reason setup", async () => {
    const { dir, artifacts } = dirs();
    const result = await runChecks({
      dir,
      setup: ["exit 3"],
      checks: [{ id: "a", run: "echo never", timeoutSec: 30 }],
      artifactsDir: artifacts,
      env: baseEnv(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("setup");
    expect(result.setup!.exit).toBe(3);
    expect(result.checks).toEqual([]);
  });

  test("the environment is exactly the explicit one", async () => {
    const { dir, artifacts } = dirs();
    process.env["AGENCY_STAGE0_CANARY"] = "must-not-leak";
    try {
      const result = await runChecks({
        dir,
        setup: [],
        checks: [{ id: "env", run: "env | sort", timeoutSec: 30 }],
        artifactsDir: artifacts,
        env: { ...baseEnv(), AGENCY_STAGE0_MARKER: "present" },
      });
      const log = readFileSync(result.checks[0]!.logPath, "utf8");
      expect(log).toContain("AGENCY_STAGE0_MARKER=present");
      expect(log).not.toContain("AGENCY_STAGE0_CANARY");
    } finally {
      delete process.env["AGENCY_STAGE0_CANARY"];
    }
  });

  test("secrets are redacted in logs and excerpts", async () => {
    const { dir, artifacts } = dirs();
    const result = await runChecks({
      dir,
      setup: [],
      checks: [{ id: "leak", run: "echo token= hunter2-secret", timeoutSec: 30 }],
      artifactsDir: artifacts,
      env: baseEnv(),
    });
    const log = readFileSync(result.checks[0]!.logPath, "utf8");
    expect(log).not.toContain("hunter2-secret");
    expect(log).toContain("[redacted]");
  });
});
