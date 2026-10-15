/**
 * Stage 1e Playwright backing server: a real Dispatcher engine against
 * scripted fake OpenCode experts, serving the built web UI. Seeded
 * missions cover every E2E spec; specs run serially and each consumes
 * its own mission so approvals and edits never collide.
 */
import {
  attachFake,
  loginToken,
  makeServiceHarness,
  startTestHttp,
} from "../../../dispatcher/test/support/service-harness.js";
import { ensureDirectorSession } from "../../../dispatcher/src/director.js";
import { MissionStatuses } from "../../../dispatcher/src/model.js";
import type { DirectorTask } from "../../../dispatcher/src/plan.js";

const PORT = Number(process.env["ACCEPT_1E_PORT"] ?? "4101");

const RESULT_BLOCK = (summary: string): string =>
  [
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

const scoutTask = (id: string, title: string, objective: string): DirectorTask => ({
  id,
  title,
  role: "recon",
  expert: "scout",
  deps: [],
  trigger: "all_success",
  input: { objective, acceptance: ["report filed"], paths: [] },
  policy: { strategy: "fail" },
});

const backendTask = (id: string): DirectorTask => ({
  id,
  title: "seed a source file",
  role: "build",
  expert: "backend",
  deps: [],
  trigger: "all_success",
  input: {
    objective: "create src/seeded.ts with a hello function",
    acceptance: ["src/seeded.ts exists"],
    paths: ["src/*"],
  },
  policy: { strategy: "fail" },
});

const backendPlanTask = (id: string, title: string): DirectorTask => ({
  id,
  title,
  role: "build",
  expert: "backend",
  deps: [],
  trigger: "all_success",
  input: {
    objective: `implement ${title}`,
    acceptance: ["change verified"],
    paths: ["src/*"],
  },
  policy: { strategy: "fail" },
});

async function main(): Promise<void> {
  const h = await makeServiceHarness();
  await attachFake(h, "director", {
    rules: [
      {
        matchPrompt: "hello-director",
        steps: [
          {
            kind: "message",
            role: "assistant",
            content: "Director acknowledges hello-director; draft plan follows.",
          },
        ],
      },
    ],
    defaultSteps: [{ kind: "message", role: "assistant", content: "Director online and ready." }],
  });
  await attachFake(h, "scout", {
    rules: [],
    defaultSteps: [{ kind: "message", role: "assistant", content: RESULT_BLOCK("recon finished") }],
  });
  await attachFake(h, "docs", {
    rules: [],
    defaultSteps: [{ kind: "message", role: "assistant", content: RESULT_BLOCK("docs finished") }],
  });
  const backendFake = await attachFake(h, "backend", {
    rules: [],
    defaultSteps: [
      {
        kind: "write",
        path: "src/seeded.ts",
        content: 'export function hello(): string {\n  return "hello";\n}\n',
      },
      { kind: "commit", message: "seed src/seeded.ts" },
      { kind: "message", role: "assistant", content: RESULT_BLOCK("seeded src/seeded.ts") },
    ],
  });
  void backendFake;

  const waiting = ["m-wait-1", "m-wait-3"];
  for (const id of waiting) {
    const m = await h.engine.createMission({
      id,
      repo: "demo",
      source: "api",
      playbook: "director",
      objective: `waiting mission ${id}`,
    });
    await h.engine.submitPlan(
      m.id,
      ["a", "b", "c", "d"].map((k) => scoutTask(`${id}-t${k}`, `recon ${k}`, `look at ${k}`)),
    );
  }

  // m-wait-2 carries backend work items so the plan editor can change
  // titles and paths inside the backend ownership grant.
  const editable = await h.engine.createMission({
    id: "m-wait-2",
    repo: "demo",
    source: "api",
    playbook: "director",
    objective: "waiting mission m-wait-2",
  });
  await h.engine.submitPlan(
    editable.id,
    ["a", "b", "c", "d"].map((k) => backendPlanTask(`m-wait-2-t${k}`, `build ${k}`)),
  );

  const chat = await h.engine.createMission({
    id: "m-chat",
    repo: "demo",
    source: "api",
    playbook: "director",
    objective: "chat mission with a live director session",
  });
  await h.engine.submitPlan(chat.id, [scoutTask("m-chat-t1", "recon one", "look around once")]);
  const director = h.clients.get("director");
  if (director === undefined) throw new Error("director client is missing");
  const sessionId = await ensureDirectorSession(h.engine, { director }, chat.id, h.repoDir);
  await director.prompt(sessionId, "seed greeting");

  const diffMission = await h.engine.createMission({
    id: "m-diff",
    repo: "demo",
    source: "api",
    playbook: "director",
    objective: "diff mission with a landed file change",
  });
  await h.engine.submitPlan(diffMission.id, [backendTask("m-diff-t1")]);
  if (h.engine.getMission(diffMission.id).mission.status === MissionStatuses.waitingHuman) {
    await h.engine.approve(diffMission.id);
  }
  for (let i = 0; i < 40; i += 1) {
    await h.engine.tick();
    const done = h.engine.getMission(diffMission.id).tasks[0]?.status === "done";
    if (done) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const landed = h.engine.getMission(diffMission.id).tasks[0];
  if (landed?.status !== "done") throw new Error("seed diff task did not finish");

  const url = await startTestHttp(h, {
    port: PORT,
    webRoot: new URL("../../../dispatcher/dist/web", import.meta.url).pathname,
  });
  const approver = await loginToken(url, "approver");
  console.log(`accept-1e-server ready at ${url} missions=${h.engine.listMissionIds().join(",")}`);
  console.log(`ACCEPT_1E_TOKEN=${approver.token}`);
  setInterval(() => {
    h.engine.tick().catch(() => {});
  }, 1000);
}

await main();
