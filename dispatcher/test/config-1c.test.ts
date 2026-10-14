/**
 * Stage 1c config tests: fleet/registry loading and expert connections.
 * Credential assertions set process.env directly (this file is test
 * support, not Dispatcher source).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  expertConnection,
  fleetModel,
  loadFleet,
  loadRegistry,
  verifierConnection,
} from "../src/config.js";

function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const had = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (had === undefined) delete process.env[name];
    else process.env[name] = had;
  }
}

describe("stage-1c config", () => {
  test("loadFleet reads the real fleet.yaml", async () => {
    const fleet = await loadFleet(join(import.meta.dir, "..", "..", "fleet.yaml"));
    expect(fleet.version).toBe(1);
    expect(fleet.experts["scout"]?.enabled).toBe(true);
    await expect(loadFleet(join(tmpdir(), "agency-no-such-fleet.yaml"))).rejects.toThrow(
      /cannot read fleet config/,
    );
  });

  test("loadRegistry reads the example registry and refuses a missing one", async () => {
    const registry = await loadRegistry(
      join(import.meta.dir, "..", "..", "registry.example", "demo"),
    );
    expect(registry.repo.id).toBe("demo");
    expect(registry.repo.planApprovalAbove).toBe(3);
    expect(registry.checks.checks.length).toBeGreaterThan(0);
    await expect(loadRegistry(join(tmpdir(), "agency-no-such-registry"))).rejects.toThrow(
      /cannot read repo.yaml/,
    );
  });

  test("loadRegistry refuses an invalid ownership map", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agency-bad-registry-"));
    const good = await loadRegistry(join(import.meta.dir, "..", "..", "registry.example", "demo"));
    await Bun.write(
      join(dir, "repo.yaml"),
      "id: demo\ndefaultBranch: main\nplanApprovalAbove: 3\n",
    );
    await Bun.write(
      join(dir, "ownership.yaml"),
      `version: 1\nexperts: ${JSON.stringify({ docs: { writes: good.ownership.experts["docs"]!.writes } })}\nshared: []\nprotected: []\n`,
    );
    await Bun.write(
      join(dir, "checks.yaml"),
      'version: 1\nsetup: []\nchecks: [{ id: test, run: "bun test", timeoutSec: 60 }]\n',
    );
    // Unknown top-level key is rejected (strict schemas).
    await Bun.write(
      join(dir, "repo.yaml"),
      "id: demo\ndefaultBranch: main\nplanApprovalAbove: 3\nextra: 1\n",
    );
    await expect(loadRegistry(dir)).rejects.toThrow(/invalid repo.yaml/);
  });

  test("expertConnection needs the expert and its password", async () => {
    const fleet = await loadFleet(join(import.meta.dir, "..", "..", "fleet.yaml"));
    withEnv("PW_SCOUT", undefined, () => {
      expect(() => expertConnection(fleet, "scout")).toThrow(/PW_SCOUT/);
    });
    withEnv("PW_SCOUT", "", () => {
      expect(() => expertConnection(fleet, "scout")).toThrow(/PW_SCOUT/);
    });
    withEnv("PW_SCOUT", "s3cret", () => {
      expect(expertConnection(fleet, "scout")).toEqual({
        name: "scout",
        baseUrl: "http://scout:4096",
        password: "s3cret",
      });
      expect(expertConnection(fleet, "scout", "http://127.0.0.1:9").baseUrl).toBe(
        "http://127.0.0.1:9",
      );
    });
    expect(() => expertConnection(fleet, "no-such-expert")).toThrow(/unknown expert/);
  });

  test("fleetModel and verifierConnection refuse empty credentials", () => {
    withEnv("AGENCY_MODEL", undefined, () => {
      expect(() => fleetModel()).toThrow(/AGENCY_MODEL/);
    });
    withEnv("VERIFIER_TOKEN", "", () => {
      expect(() => verifierConnection()).toThrow(/VERIFIER_TOKEN/);
    });
    withEnv("VERIFIER_TOKEN", "tok", () => {
      expect(verifierConnection()).toEqual({ baseUrl: "http://verifier:8080", token: "tok" });
    });
  });
});
