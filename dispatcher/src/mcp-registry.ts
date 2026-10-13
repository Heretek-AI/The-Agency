import { z } from "zod";

/**
 * Zod schema for mcp/registry.jsonc (shared context 9.11). Imported by the
 * renderer and by the schema test. Each entry carries the v2 server config
 * plus `requires` (variables that must be non-empty for the server to be
 * enabled). Unknown keys are rejected.
 */

const TimeoutSchema = z
  .object({
    startup: z.number().int().positive().optional(),
    catalog: z.number().int().positive().optional(),
    execution: z.number().int().positive().optional(),
  })
  .strict();

const LocalServerConfigSchema = z
  .object({
    type: z.literal("local"),
    command: z.array(z.string().min(1)).min(1),
    cwd: z.string().optional(),
    environment: z.record(z.string()).optional(),
    disabled: z.boolean().optional(),
    codemode: z.boolean().optional(),
    timeout: TimeoutSchema.optional(),
  })
  .strict();

const RemoteServerConfigSchema = z
  .object({
    type: z.literal("remote"),
    url: z.string().min(1),
    headers: z.record(z.string()).optional(),
    oauth: z.union([z.boolean(), z.record(z.string())]).optional(),
    disabled: z.boolean().optional(),
    codemode: z.boolean().optional(),
    timeout: TimeoutSchema.optional(),
  })
  .strict();

export const McpRegistryEntrySchema = z
  .object({
    requires: z.array(z.string().min(1)),
    config: z.union([LocalServerConfigSchema, RemoteServerConfigSchema]),
  })
  .strict();

export const McpRegistrySchema = z
  .object({
    servers: z.record(McpRegistryEntrySchema),
  })
  .strict();

export type McpRegistry = z.infer<typeof McpRegistrySchema>;
export type McpRegistryEntry = z.infer<typeof McpRegistryEntrySchema>;
