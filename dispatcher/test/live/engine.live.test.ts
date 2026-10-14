/**
 * Live engine proof (Stage 1c, Step 9). Runs INSIDE the dispatcher image
 * on the `fleet` network (see `make engine-live`), against the Stage 1b
 * fleet, the real verifier, and the demo repository.
 *
 * - scope=scout: a `scout` task completes with a parsed RESULT and a
 *   report under `/artifacts/<taskId>/` that the scout's session wrote.
 * - scope=docs: a `docs` task is accepted, verified by the verifier, and
 *   landed: the commit is on the integration branch, the README there
 *   contains new text the test did not write, verify results are recorded
 *   green, and the trailers are present.
 *
 * The test writes nothing into the workspace itself: every file under
 * /work comes from an expert session or the engine's git transaction.
 * Timeouts are generous; the harness raises ACCEPT_TIMEOUT accordingly.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "bun:test";
import { loadFleet, loadRegistry } from "../../src/config.js";
import { enabledExperts } from "../../src/fleet-schema.js";
import { Engine } from "../../src/engine.js";
import { MissionStatuses, TaskStatuses } from "../../src/model.js";
import { OpenCodeClient } from "../../src/opencode.js";
import type { DirectorTask } from "../../src/plan.js";
import { Store } from "../../src/store.js";
import { HttpVerifier } from "../../src/verify.js";

function sh(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir }).toString().trim();
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`live engine: ${name} is empty or unset`);
  return value;
}

const SCOPE = process.env["ENGINE_LIVE_SCOPE"] ?? "both";
const WORK_ROOT = process.env["ENGINE_LIVE_WORK"] ?? "/work";
const ARTIFACTS_ROOT = process.env["ENGINE_LIVE_ARTIFACTS"] ?? "/artifacts";
const REGISTRY_ROOT = process.env["ENGINE_LIVE_REGISTRY"] ?? "/registry";
const STATE_ROOT = process.env["ENGINE_LIVE_STATE"] ?? "/data";

const stamp = Date.now().toString(36);

async function liveEngine(): Promise<Engine> {
  const fleet = await loadFleet("/app/fleet.yaml");
  const reg = await loadRegistry(`${REGISTRY_ROOT}/demo`);
  const store = await Store.open({
    dbPath: `${STATE_ROOT}/dispatcher.db`,
    auditDir: `${STATE_ROOT}/audit`,
  });
  // One client per enabled expert: startup asserts the OpenCode contract
  // for every enabled expert, so a partial map refuses to start.
  const clients = new Map<string, OpenCodeClient>();
  for (const name of enabledExperts(fleet)) {
    clients.set(
      name,
      new OpenCodeClient({
        baseUrl: `http://${name}:4096`,
        password: required(`PW_${name.toUpperCase()}`),
      }),
    );
  }
  return new Engine({
    store,
    fleet,
    registries: new Map([
      ["demo", { repo: reg.repo, ownership: reg.ownership, checks: reg.checks }],
    ]),
    workspaceRoot: WORK_ROOT,
    artifactsRoot: ARTIFACTS_ROOT,
    clients,
    verifier: new HttpVerifier("http://verifier:8080", required("VERIFIER_TOKEN")),
    taskTimeoutSec: fleet.defaults.taskTimeoutSec,
    probeIntervalMs: 60_000,
  });
}

async function tickUntil(
  engine: Engine,
  missionId: string,
  done: (status: string) => boolean,
  deadlineMs: number,
): Promise<string> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    await engine.tick();
    const status = engine.getMission(missionId).mission.status;
    if (done(status)) return status;
    if (Date.now() >= deadline) return status;
    await new Promise((r) => setTimeout(r, 5000));
  }
}

function reportFiles(artifactsRoot: string, taskId: string): string[] {
  const dir = path.join(artifactsRoot, taskId);
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

test(
  "live scout run produces a parsed RESULT and a session-written report",
  async () => {
    if (SCOPE !== "scout" && SCOPE !== "both") return;
    const engine = await liveEngine();
    try {
      await engine.assertContracts();
      const missionId = `m-live-scout-${stamp}`;
      await engine.createMission({
        id: missionId,
        repo: "demo",
        source: "api",
        playbook: "direct",
        objective: "live scout proof",
      });
      const scout: DirectorTask = {
        id: `scout-live-${stamp}`,
        title: "inventory the demo repository",
        role: "recon",
        expert: "scout",
        input: {
          objective: "List the languages and the test command this repository uses.",
          acceptance: ["report names the languages and the test command"],
          paths: [],
        },
      };
      await engine.submitPlan(missionId, [scout]);
      const status = await tickUntil(
        engine,
        missionId,
        (s) => s === MissionStatuses.done || s === MissionStatuses.failed,
        12 * 60 * 1000,
      );
      expect(status).toBe(MissionStatuses.done);
      const task = engine.getMission(missionId).tasks[0]!;
      const block = (task.result as { block?: { status?: string; summary?: string } }).block;
      expect(block?.status).toBe("done");
      expect((block?.summary ?? "").length).toBeGreaterThan(0);
      const reports = reportFiles(ARTIFACTS_ROOT, scout.id);
      expect(reports.length).toBeGreaterThan(0);
      expect(statSync(reports[0]!).size).toBeGreaterThan(0);
      console.log(`live scout: report at ${reports[0]}`);
    } finally {
      const store = (engine as unknown as { deps: { store: Store } }).deps.store;
      await store.close();
    }
  },
  13 * 60 * 1000,
);

test(
  "live docs run is accepted, verified, and landed",
  async () => {
    if (SCOPE !== "docs" && SCOPE !== "both") return;
    const engine = await liveEngine();
    try {
      const missionId = `m-live-docs-${stamp}`;
      await engine.createMission({
        id: missionId,
        repo: "demo",
        source: "api",
        playbook: "direct",
        objective: "live docs proof",
      });
      const docs: DirectorTask = {
        id: `docs-live-${stamp}`,
        title: "document the test command",
        role: "docs",
        expert: "docs",
        input: {
          objective: "Add a 'Running the tests' section to the README.",
          constraints:
            "Match the existing Markdown style. Run the repository checks yourself before finishing.",
          acceptance: ["README contains a 'Running the tests' section", "repository checks pass"],
          paths: ["README.md"],
        },
      };
      await engine.submitPlan(missionId, [docs]);
      let status = await tickUntil(
        engine,
        missionId,
        (s) => s === MissionStatuses.waitingHuman || s === MissionStatuses.failed,
        15 * 60 * 1000,
      );
      expect(status).toBe(MissionStatuses.waitingHuman);
      expect(engine.getMission(missionId).tasks[0]?.status).toBe(TaskStatuses.done);
      await engine.decide(docs.id, "accept", "live proof accept");
      status = await tickUntil(
        engine,
        missionId,
        (s) => s === MissionStatuses.done || s === MissionStatuses.failed,
        15 * 60 * 1000,
      );
      expect(status).toBe(MissionStatuses.done);
      const view = engine.getMission(missionId);
      const landTask = view.tasks.find((t) => t.kind === "land")!;
      expect(landTask.status).toBe(TaskStatuses.done);
      const landedSha = landTask.landedSha ?? "";
      expect(landedSha.length).toBeGreaterThan(0);
      // The commit is on the integration branch ...
      const repoDir = `${WORK_ROOT}/demo/repo`;
      expect(sh(repoDir, ["rev-parse", `fleet/integration/${missionId}`])).toBe(landedSha);
      // ... the README there contains new text the test did not write ...
      expect(sh(repoDir, ["show", `${landedSha}:README.md`])).toContain("Running the tests");
      // ... verify results are recorded and green ...
      const verifyTask = view.tasks.find((t) => t.kind === "verify")!;
      const recorded = verifyTask.result as { checks?: { id: string; exit: number }[] };
      expect((recorded.checks ?? []).length).toBeGreaterThan(0);
      expect((recorded.checks ?? []).every((c) => c.exit === 0)).toBe(true);
      // ... and the trailers are present.
      const message = sh(repoDir, ["log", "-1", "--format=%B", landedSha]);
      for (const trailer of [
        `Agency-Mission: ${missionId}`,
        `Agency-Task: ${docs.id}`,
        "Agency-Verify:",
        "Agency-Audit-Tip:",
      ]) {
        expect(message).toContain(trailer);
      }
      console.log(`live docs: landed ${landedSha}`);
    } finally {
      const store = (engine as unknown as { deps: { store: Store } }).deps.store;
      await store.close();
    }
  },
  32 * 60 * 1000,
);
