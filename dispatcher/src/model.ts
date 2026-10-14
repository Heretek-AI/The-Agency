import { z } from "zod";

/**
 * Task and Mission shapes (shared context 9.3, mirrors es-fleet). This is
 * the only module that declares these shapes or their status lists
 * (enforced by the `lint` target in the Makefile).
 */

export const TaskKindSchema = z.enum(["expert-run", "verify", "land", "human"]);
export const TaskTriggerSchema = z.enum(["all_success", "one_success"]);
export const TaskStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "waiting-human",
  "done",
  "failed",
  "cancelled",
]);
export const TaskPolicySchema = z.union([
  z.object({ strategy: z.literal("fail") }),
  z.object({ strategy: z.literal("retry"), maxAttempts: z.number().int().min(1) }),
  z.object({ strategy: z.literal("replan") }),
]);

export const TaskInputSchema = z.object({
  objective: z.string().min(1),
  context: z.string().optional(),
  constraints: z.string().optional(),
  acceptance: z.array(z.string()),
  paths: z.array(z.string()),
  base: z.string().optional(),
});

export const TaskSchema = z.object({
  id: z.string().min(1),
  missionId: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  kind: TaskKindSchema,
  role: z.string().min(1),
  expert: z.string().min(1).optional(),
  deps: z.array(z.string()),
  trigger: TaskTriggerSchema,
  input: TaskInputSchema,
  ceilingUSD: z.null(),
  policy: TaskPolicySchema,
  status: TaskStatusSchema,
  attempts: z.number().int().min(0),
  reason: z.string().optional(),
  result: z.unknown().optional(),
  sessionId: z.string().optional(),
  branch: z.string().optional(),
  worktree: z.string().optional(),
  headSha: z.string().optional(),
  landedSha: z.string().optional(),
});

export const MissionSourceSchema = z.enum(["chat", "api", "github", "schedule"]);
export const MissionStatusSchema = z.enum([
  "planning",
  "waiting-human",
  "running",
  "paused",
  "halted",
  "done",
  "failed",
  "cancelled",
]);

export const MissionSchema = z.object({
  id: z.string().min(1),
  repo: z.string().min(1),
  source: MissionSourceSchema,
  sourceRef: z.string().optional(),
  playbook: z.string().min(1),
  objective: z.string().min(1),
  priority: z.number().int(),
  status: MissionStatusSchema,
  plan: z.unknown(),
  tasks: z.array(TaskSchema),
  decisions: z.array(z.unknown()),
  directorSessionId: z.string().optional(),
  integrationBranch: z.string().min(1),
  baseSha: z.string().min(1),
  pausedUntil: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TaskKind = z.infer<typeof TaskKindSchema>;
export type TaskTrigger = z.infer<typeof TaskTriggerSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskPolicy = z.infer<typeof TaskPolicySchema>;
export type TaskInput = z.infer<typeof TaskInputSchema>;
export type Task = z.infer<typeof TaskSchema>;

/**
 * Status constants. Every other module compares through these (the lint
 * target keeps the `"waiting-human"` literal in this file only).
 */
export const TaskStatuses = {
  pending: "pending",
  ready: "ready",
  running: "running",
  waitingHuman: "waiting-human",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
} as const satisfies Record<string, TaskStatus>;
export type MissionSource = z.infer<typeof MissionSourceSchema>;
export type MissionStatus = z.infer<typeof MissionStatusSchema>;
export type Mission = z.infer<typeof MissionSchema>;

/** Mission status constants; see TaskStatuses above. */
export const MissionStatuses = {
  planning: "planning",
  waitingHuman: "waiting-human",
  running: "running",
  paused: "paused",
  halted: "halted",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
} as const satisfies Record<string, MissionStatus>;
