import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Account } from "../../src/auth.js";
import { SessionStore } from "../../src/auth.js";
import { loadFleet, loadRegistry } from "../../src/config.js";
import { Engine, type EngineDeps, type RepoRegistry } from "../../src/engine.js";
import { serveHttp } from "../../src/http.js";
import { OpenCodeClient } from "../../src/opencode.js";
import { Store } from "../../src/store.js";
import { startFakeOpenCode, type FakeOpenCode, type FakeScript } from "./fake-opencode.js";
import { localVerifier } from "./local-verifier.fake.js";

/**
 * Shared harness for Stage 1d service tests: a temporary git
 * repository, an open store, an engine backed by scripted fake OpenCode
 * servers and the local check runner, argon2 accounts, and an HTTP
 * control plane on an ephemeral port.
 */

export const HARNESS_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
export const HARNESS_PASSWORD = "service-harness-pw";

export function resultBlock(summary: string): string {
  return [
    "## RESULT",
    "```json",
    JSON.stringify({
      status: "done",
      summary,
      changes: [],
      verification: [],
      assumptions: [],
      risks: [],
      handoffs: [],
      artifacts: [],
      question: null,
    }),
    "```",
  ].join("\n");
}

export const DONE_SCRIPT: FakeScript = {
  rules: [],
  defaultSteps: [{ kind: "message", role: "assistant", content: resultBlock("finished") }],
};

export interface ServiceHarness {
  engine: Engine;
  deps: EngineDeps;
  store: Store;
  accounts: Map<string, Account>;
  sessions: SessionStore;
  clients: Map<string, OpenCodeClient>;
  fakes: FakeOpenCode[];
  workspaceRoot: string;
  artifactsRoot: string;
  repoDir: string;
  baseDir: string;
  http: { url: string; close: () => Promise<void> } | undefined;
  close: () => Promise<void>;
}

function sh(dir: string, args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "ignore" });
}

export async function makeServiceHarness(): Promise<ServiceHarness> {
  const baseDir = mkdtempSync(path.join(tmpdir(), "agency-service-"));
  const workspaceRoot = path.join(baseDir, "workspace");
  const artifactsRoot = path.join(baseDir, "artifacts");
  const repoDir = path.join(workspaceRoot, "demo", "repo");
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(artifactsRoot, { recursive: true });
  sh(repoDir, ["init", "-q", "-b", "main"]);
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "seed"],
    {
      cwd: repoDir,
      stdio: "ignore",
    },
  );

  const store = await Store.open({
    dbPath: path.join(baseDir, "state", "dispatcher.db"),
    auditDir: path.join(baseDir, "state", "audit"),
  });
  const fleet = await loadFleet(path.join(HARNESS_ROOT, "fleet.yaml"));
  const reg = await loadRegistry(path.join(HARNESS_ROOT, "registry.example", "demo"));
  const registry: RepoRegistry = {
    repo: reg.repo,
    ownership: reg.ownership,
    checks: { version: 1, setup: [], checks: [{ id: "ok", run: "exit 0", timeoutSec: 30 }] },
  };
  const deps: EngineDeps = {
    store,
    fleet,
    registries: new Map([["demo", registry]]),
    workspaceRoot,
    artifactsRoot,
    clients: new Map(),
    verifier: localVerifier({ artifactsDir: artifactsRoot }),
    taskTimeoutSec: 60,
    triageProbeMs: 500,
  };
  const engine = new Engine(deps);

  const accounts = new Map<string, Account>();
  for (const [username, role] of [
    ["admin", "admin"],
    ["approver", "approver"],
    ["viewer", "viewer"],
  ] as const) {
    const passwordHash = await Bun.password.hash(`pw-${username}`, { algorithm: "argon2id" });
    accounts.set(username, { username, role, passwordHash });
  }

  const harness: ServiceHarness = {
    engine,
    deps,
    store,
    accounts,
    sessions: new SessionStore(),
    clients: deps.clients,
    fakes: [],
    workspaceRoot,
    artifactsRoot,
    repoDir,
    baseDir,
    http: undefined,
    close: async () => {
      if (harness.http !== undefined) await harness.http.close();
      for (const f of harness.fakes) await f.close();
      await store.close();
    },
  };
  return harness;
}

export async function attachFake(
  h: ServiceHarness,
  expert: string,
  script: FakeScript = DONE_SCRIPT,
): Promise<FakeOpenCode> {
  const fake = await startFakeOpenCode({ password: HARNESS_PASSWORD, script });
  h.fakes.push(fake);
  h.clients.set(expert, new OpenCodeClient({ baseUrl: fake.url, password: HARNESS_PASSWORD }));
  return fake;
}

export async function startTestHttp(
  h: ServiceHarness,
  overrides?: Partial<Parameters<typeof serveHttp>[0]>,
): Promise<string> {
  const service = await serveHttp({
    engine: h.engine,
    fleet: h.deps.fleet,
    clients: h.clients,
    registries: h.deps.registries,
    defaultRepo: "demo",
    accounts: h.accounts,
    sessions: h.sessions,
    mcpToken: "test-fleet-mcp-token",
    artifactsRoot: h.artifactsRoot,
    workspaceRoot: h.workspaceRoot,
    health: {
      storeOpen: () => {
        h.engine.listMissionIds();
      },
      verifyAudit: () => h.store.verifyAudit(),
      assertContracts: async () => {},
    },
    directorLocation: () => h.repoDir,
    port: 0,
    ...overrides,
  });
  h.http = service;
  return service.url;
}

export async function loginToken(
  baseUrl: string,
  username: string,
): Promise<{ token: string; cookie: string | null }> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: `pw-${username}` }),
  });
  if (!res.ok) throw new Error(`login as ${username} failed with ${res.status}`);
  const body = (await res.json()) as { token: string };
  return { token: body.token, cookie: res.headers.get("set-cookie") };
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
