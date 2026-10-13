import { z } from "zod";

/**
 * Zod schemas for the fleet-side registry control files (Stage 1b,
 * Step 8). The registry directory is never mounted into any expert.
 * Unknown keys are rejected.
 */

export const RepoConfigSchema = z
  .object({
    id: z.string().min(1),
    defaultBranch: z.string().min(1),
    planApprovalAbove: z.number().int().min(0),
  })
  .strict();

export const OwnershipConfigSchema = z
  .object({
    version: z.literal(1),
    experts: z.record(
      z
        .object({
          writes: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    shared: z.array(z.string().min(1)),
    protected: z.array(z.string().min(1)),
  })
  .strict();

export const ChecksConfigSchema = z
  .object({
    version: z.literal(1),
    setup: z.array(z.string().min(1)),
    checks: z
      .array(
        z
          .object({
            id: z.string().min(1),
            run: z.string().min(1),
            timeoutSec: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type RepoConfig = z.infer<typeof RepoConfigSchema>;
export type OwnershipConfig = z.infer<typeof OwnershipConfigSchema>;
export type ChecksConfig = z.infer<typeof ChecksConfigSchema>;
