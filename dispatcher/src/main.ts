import { readdir, stat } from "node:fs/promises";
import { loadAllowlist, SessionStore } from "./auth.js";
import {
  dispatcherCredentials,
  dispatcherPaths,
  dispatcherPort,
  loadFleet,
  loadRegistry,
  verifierConnection,
} from "./config.js";
import { directorWakeHook } from "./director.js";
import { Engine, type RepoRegistry } from "./engine.js";
import { serveHttp } from "./http.js";
import { OpenCodeClient } from "./opencode.js";
import { Store } from "./store.js";
import { HttpVerifier } from "./verify.js";

/**
 * Dispatcher service entrypoint (Stage 1d, Step 2): load config, open
 * the store and audit log, assert expert contracts, run recovery, start
 * the engine loop, and serve REST, SSE, and MCP on one port (8080 by
 * default). Any missing credential refuses startup naming the variable.
 */

export interface BootOptions {
  port?: number;
  hostname?: string;
  pollMs?: number;
  /** Test hook: reach experts at these base URLs instead of the fleet network. */
  expertBaseUrls?: Map<string, string>;
}

export interface BootedService {
  url: string;
  engine: Engine;
  close: () => Promise<void>;
}

export async function boot(options: BootOptions = {}): Promise<BootedService> {
  const fleetPath = new URL("../../fleet.yaml", import.meta.url).pathname;
  const fleet = await loadFleet(fleetPath);
  const creds = dispatcherCredentials(fleet);
  const paths = dispatcherPaths();
  const accounts = await loadAllowlist(paths.allowlistPath);

  const registries = new Map<string, RepoRegistry>();
  let entries: string[];
  try {
    entries = await readdir(paths.registryDir);
  } catch {
    throw new Error(`refusing to start: cannot read registry at ${paths.registryDir}`);
  }
  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) continue;
    // The registry directory also holds the allowlist file; only
    // subdirectories are repositories.
    const entryStat = await stat(`${paths.registryDir}/${entry}`).catch(() => undefined);
    if (entryStat === undefined || !entryStat.isDirectory()) continue;
    registries.set(entry, await loadRegistry(`${paths.registryDir}/${entry}`));
  }
  if (registries.size === 0)
    throw new Error(`refusing to start: no repositories registered in ${paths.registryDir}`);
  const defaultRepo = [...registries.keys()].sort()[0]!;

  const store = await Store.open({
    dbPath: `${paths.stateDir}/dispatcher.db`,
    auditDir: `${paths.stateDir}/audit`,
  });
  try {
    const audit = await store.verifyAudit();
    if (!audit.ok)
      throw new Error(`refusing to start: audit log failed: ${audit.reason ?? "unknown"}`);
  } catch (err) {
    await store.close();
    throw err;
  }

  const clients = new Map<string, OpenCodeClient>();
  for (const [name, password] of creds.expertPasswords) {
    const override = options.expertBaseUrls?.get(name);
    clients.set(name, new OpenCodeClient({ baseUrl: override ?? `http://${name}:4096`, password }));
  }
  const verifierConn = verifierConnection();
  const verifier = new HttpVerifier(verifierConn.baseUrl, verifierConn.token);

  const director = clients.get("director");
  const engine = new Engine({
    store,
    fleet,
    registries,
    workspaceRoot: paths.workspaceRoot,
    artifactsRoot: paths.artifactsRoot,
    clients,
    verifier,
  });
  if (director !== undefined) engine.setWakeHook(directorWakeHook(engine, { director }));

  try {
    await engine.assertContracts();
    await engine.startup();
  } catch (err) {
    await store.close();
    throw err;
  }

  const sessions = new SessionStore();
  const wakeClient = clients.get("director");
  const service = await serveHttp({
    engine,
    fleet,
    clients,
    registries,
    defaultRepo,
    accounts,
    sessions,
    mcpToken: creds.fleetMcpToken,
    artifactsRoot: paths.artifactsRoot,
    workspaceRoot: paths.workspaceRoot,
    health: {
      storeOpen: () => {
        engine.listMissionIds();
      },
      verifyAudit: () => store.verifyAudit(),
      assertContracts: () => engine.assertContracts(),
    },
    directorLocation: (mission) => `${paths.workspaceRoot}/${mission.repo}/repo`,
    notify:
      wakeClient !== undefined ? directorWakeHook(engine, { director: wakeClient }) : undefined,
    port: options.port ?? dispatcherPort(),
    hostname: options.hostname ?? "127.0.0.1",
  });

  const pollMs = options.pollMs ?? 5000;
  let stopped = false;
  let ticking = false;
  const timer = setInterval(() => {
    if (stopped || ticking) return;
    ticking = true;
    engine
      .tick()
      .catch(() => {})
      .finally(() => {
        ticking = false;
      });
  }, pollMs);

  return {
    url: service.url,
    engine,
    close: async () => {
      stopped = true;
      clearInterval(timer);
      await service.close();
      await store.close();
    },
  };
}

async function main(): Promise<void> {
  let service: BootedService | undefined;
  const shutdown = (): void => {
    if (service !== undefined) {
      service.close().catch(() => {});
      service = undefined;
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  try {
    service = await boot();
  } catch (err) {
    console.error(`dispatcher: ${(err as Error).message}`);
    process.exit(1);
  }
  console.error(`dispatcher: listening on ${service.url}`);
}

if (import.meta.main) await main();
