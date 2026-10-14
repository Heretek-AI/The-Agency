import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { boot } from "../src/main.js";
import { enabledExperts, FleetSchema } from "../src/fleet-schema.js";
import { parse as parseYaml } from "yaml";
import { startFakeOpenCode, type FakeOpenCode } from "./support/fake-opencode.js";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const FAKE_PASSWORD = "main-boot-pw";

async function seedEnv(): Promise<{ dir: string; restore: () => void; experts: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "agency-boot-"));
  const stateDir = join(dir, "state");
  const registryDir = join(dir, "registry");
  const workspace = join(dir, "workspace");
  const artifacts = join(dir, "artifacts");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(join(workspace, "demo", "repo"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: join(workspace, "demo", "repo") });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "seed"],
    {
      cwd: join(workspace, "demo", "repo"),
      stdio: "ignore",
    },
  );
  cpSync(join(REPO_ROOT, "registry.example", "demo"), join(registryDir, "demo"), {
    recursive: true,
  });
  // A stray file in the registry root (like the production allowlist) is
  // skipped, not loaded as a repository.
  writeFileSync(join(registryDir, "allowlist.yaml"), "version: 1\nusers: []\n");
  const hash = await Bun.password.hash("admin-pw", { algorithm: "argon2id" });
  const allowlist = join(dir, "allowlist.yaml");
  writeFileSync(
    allowlist,
    `version: 1\nusers:\n  - username: admin\n    role: admin\n    passwordHash: '${hash}'\n`,
  );

  const fleetText = await Bun.file(join(REPO_ROOT, "fleet.yaml")).text();
  const fleet = FleetSchema.parse(parseYaml(fleetText));
  const experts = enabledExperts(fleet);

  const saved = new Map<string, string | undefined>();
  const set = (key: string, value: string): void => {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    process.env[key] = value;
  };
  set("DISPATCHER_STATE_DIR", stateDir);
  set("DISPATCHER_REGISTRY_DIR", registryDir);
  set("DISPATCHER_WORKSPACE", workspace);
  set("DISPATCHER_ARTIFACTS", artifacts);
  set("DISPATCHER_ALLOWLIST", allowlist);
  set("FLEET_MCP_TOKEN", "boot-fleet-token");
  set("VERIFIER_TOKEN", "boot-verifier-token");
  set("AGENCY_MODEL", "test-model");
  for (const name of experts) set(`PW_${name.toUpperCase().replace(/-/g, "_")}`, FAKE_PASSWORD);
  return {
    dir,
    experts,
    restore: () => {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

describe("dispatcher startup", () => {
  test("Dispatcher refuses to start without each credential", async () => {
    const seed = await seedEnv();
    try {
      const names = [
        "FLEET_MCP_TOKEN",
        "VERIFIER_TOKEN",
        "AGENCY_MODEL",
        ...seed.experts.map((n) => `PW_${n.toUpperCase().replace(/-/g, "_")}`),
      ];
      expect(names.length).toBeGreaterThan(10);
      for (const name of names) {
        const saved = process.env[name];
        delete process.env[name];
        try {
          await expect(boot({ port: 0 })).rejects.toThrow(name);
        } finally {
          if (saved !== undefined) process.env[name] = saved;
        }
      }
    } finally {
      seed.restore();
    }
  }, 60_000);

  test("refuses to start when expert contracts fail", async () => {
    const seed = await seedEnv();
    try {
      const dead = new Map(seed.experts.map((n) => [n, "http://127.0.0.1:9"]));
      await expect(boot({ port: 0, expertBaseUrls: dead })).rejects.toThrow("contract");
    } finally {
      seed.restore();
    }
  }, 60_000);

  test("boots against fake experts and answers healthy", async () => {
    const seed = await seedEnv();
    const fakes: FakeOpenCode[] = [];
    try {
      const urls = new Map<string, string>();
      for (const name of seed.experts) {
        const fake = await startFakeOpenCode({ password: FAKE_PASSWORD, script: { rules: [] } });
        fakes.push(fake);
        urls.set(name, fake.url);
      }
      const service = await boot({ port: 0, expertBaseUrls: urls });
      try {
        const res = await fetch(`${service.url}/healthz`);
        expect(res.status).toBe(200);
        expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
        expect(service.engine.listMissionIds()).toEqual([]);
      } finally {
        await service.close();
      }
    } finally {
      for (const f of fakes) await f.close();
      seed.restore();
    }
  }, 120_000);
});
