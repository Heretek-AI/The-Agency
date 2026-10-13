import { describe, expect, test } from "bun:test";
import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseYaml } from "yaml";
import { McpRegistrySchema } from "../src/mcp-registry.js";
import { FleetSchema } from "../src/fleet-schema.js";

async function loadRegistry(): Promise<unknown> {
  const file = Bun.file(new URL("../../mcp/registry.jsonc", import.meta.url));
  const errors: unknown[] = [];
  const parsed: unknown = parseJsonc(await file.text(), errors, { allowTrailingComma: true });
  expect(errors).toEqual([]);
  return parsed;
}

describe("mcp/registry.jsonc", () => {
  test("validates against the schema", async () => {
    const parsed = McpRegistrySchema.safeParse(await loadRegistry());
    expect(parsed.success).toBe(true);
  });

  test("covers every MCP key named in fleet.yaml", async () => {
    const fleetFile = Bun.file(new URL("../../fleet.yaml", import.meta.url));
    const fleet = FleetSchema.parse(parseYaml(await fleetFile.text()));
    const registry = McpRegistrySchema.parse(await loadRegistry());
    const named = new Set(Object.values(fleet.experts).flatMap((expert) => expert.mcp));
    for (const key of named) {
      expect(registry.servers[key]).toBeDefined();
    }
  });

  test("postgres, dbhub, figma, and linear ship disabled", async () => {
    const registry = McpRegistrySchema.parse(await loadRegistry());
    for (const key of ["postgres", "dbhub", "figma", "linear"]) {
      const entry = registry.servers[key];
      expect(entry).toBeDefined();
      const config = entry!.config;
      expect("disabled" in config && config.disabled).toBe(true);
    }
  });

  test("fleet requires FLEET_MCP_TOKEN", async () => {
    const registry = McpRegistrySchema.parse(await loadRegistry());
    expect(registry.servers["fleet"]?.requires).toContain("FLEET_MCP_TOKEN");
  });

  test("no local server is launched with an unpinned runtime fetch", async () => {
    const registry = McpRegistrySchema.parse(await loadRegistry());
    for (const [key, entry] of Object.entries(registry.servers)) {
      if (entry.config.type !== "local") continue;
      const command = entry.config.command.join(" ");
      // npx/uvx without a pinned version would fetch latest at run time.
      expect(command).not.toMatch(/\bnpx\b(?![^]*@)/);
      expect(command).not.toMatch(/\buvx\b.*--from\s+\S+(?<!\d)$/);
    }
  });
});
