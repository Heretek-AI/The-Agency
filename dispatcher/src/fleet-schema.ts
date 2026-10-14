import { z } from "zod";

/**
 * Zod schema for fleet.yaml (shared context 9.9). Imported by the renderer
 * and, later, by the Dispatcher. Unknown keys are rejected; an `ro` expert
 * with `proposed_writes` is rejected; a `scoped` expert without them is
 * rejected.
 */

export const TierSchema = z.enum(["frontier", "standard", "fast", "review"]);
export const ProfileSchema = z.enum(["core", "extended"]);
export const AccessSchema = z.enum(["ro", "scoped"]);

const ExpertBaseSchema = z
  .object({
    enabled: z.boolean(),
    profile: ProfileSchema,
    tier: TierSchema,
    access: AccessSchema,
    description: z.string().min(1),
    handles: z.array(z.string().min(1)).min(1),
    delegates: z.array(z.string().min(1)).min(1),
    proposed_writes: z.array(z.string().min(1)),
    mcp: z.array(z.string().min(1)),
    skills: z.array(z.string().min(1)),
    image_tools: z.array(z.string().min(1)),
    egress: z.array(z.string().min(1)),
    browser: z.boolean(),
  })
  .strict();

export type ExpertEntry = z.infer<typeof ExpertBaseSchema>;

export const FleetExpertSchema = ExpertBaseSchema.superRefine((expert, ctx) => {
  if (expert.access === "ro" && expert.proposed_writes.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `access "ro" expert must not list proposed_writes`,
    });
  }
  if (expert.access === "scoped" && expert.proposed_writes.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `access "scoped" expert must list proposed_writes`,
    });
  }
});

export const FleetSchema = z
  .object({
    version: z.literal(1),
    defaults: z
      .object({
        port: z.number().int().positive(),
        maxConcurrent: z.number().int().positive(),
        taskTimeoutSec: z.number().int().positive(),
        resources: z
          .object({
            cpus: z.number().positive(),
            memory: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    tiers: z.record(z.string().min(1)).refine((tiers) => Object.keys(tiers).length > 0, {
      message: "tiers must not be empty",
    }),
    experts: z.record(FleetExpertSchema),
  })
  .strict();

export type FleetConfig = z.infer<typeof FleetSchema>;

/** Names of the enabled experts, in fleet.yaml order. */
export function enabledExperts(fleet: FleetConfig): string[] {
  return Object.entries(fleet.experts)
    .filter(([, expert]) => expert.enabled)
    .map(([name]) => name);
}
