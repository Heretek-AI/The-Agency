import { describe, expect, test } from "bun:test";
import { MissionSchema, TaskSchema } from "../src/model.js";
import type { Task } from "../src/model.js";

function validTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    missionId: "m-1",
    repo: "demo",
    title: "Build it",
    kind: "expert-run",
    role: "build",
    deps: [],
    trigger: "all_success",
    input: { objective: "Ship the thing", acceptance: ["it works"], paths: ["src/*"] },
    ceilingUSD: null,
    policy: { strategy: "fail" },
    status: "pending",
    attempts: 0,
    ...overrides,
  };
}

describe("model", () => {
  test("a minimal task parses", () => {
    expect(TaskSchema.safeParse(validTask()).success).toBe(true);
  });

  test("each dependency trigger value is accepted", () => {
    expect(TaskSchema.safeParse(validTask({ trigger: "all_success" })).success).toBe(true);
    expect(TaskSchema.safeParse(validTask({ trigger: "one_success" })).success).toBe(true);
    expect(
      TaskSchema.safeParse(validTask({ trigger: "any_time" as Task["trigger"] })).success,
    ).toBe(false);
  });

  test("every task status in 9.3 parses; unknown ones do not", () => {
    for (const status of [
      "pending",
      "ready",
      "running",
      "waiting-human",
      "done",
      "failed",
      "cancelled",
    ] as const) {
      expect(TaskSchema.safeParse(validTask({ status })).success).toBe(true);
    }
    expect(
      TaskSchema.safeParse(validTask({ status: "waiting_human" as Task["status"] })).success,
    ).toBe(false);
  });

  test("policy variants parse; ceilingUSD must stay null", () => {
    expect(
      TaskSchema.safeParse(validTask({ policy: { strategy: "retry", maxAttempts: 3 } })).success,
    ).toBe(true);
    expect(TaskSchema.safeParse(validTask({ policy: { strategy: "replan" } })).success).toBe(true);
    expect(
      TaskSchema.safeParse(validTask({ ceilingUSD: 5 } as unknown as Partial<Task>)).success,
    ).toBe(false);
  });

  test("a mission with tasks parses", () => {
    const mission = {
      id: "m-1",
      repo: "demo",
      source: "chat",
      playbook: "small-fix",
      objective: "Fix the bug",
      priority: 1,
      status: "planning",
      plan: { steps: [] },
      tasks: [validTask()],
      decisions: [],
      integrationBranch: "fleet/integration/m-1",
      baseSha: "abc123",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(MissionSchema.safeParse(mission).success).toBe(true);
  });
});
