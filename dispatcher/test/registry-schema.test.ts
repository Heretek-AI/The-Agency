import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import {
  ChecksConfigSchema,
  OwnershipConfigSchema,
  RepoConfigSchema,
} from "../src/registry-schema.js";

async function loadExample(name: string): Promise<unknown> {
  const file = Bun.file(new URL(`../../registry.example/demo/${name}`, import.meta.url));
  return parseYaml(await file.text());
}

describe("registry control files", () => {
  test("example repo.yaml validates", async () => {
    expect(RepoConfigSchema.safeParse(await loadExample("repo.yaml")).success).toBe(true);
  });

  test("example ownership.yaml validates", async () => {
    expect(OwnershipConfigSchema.safeParse(await loadExample("ownership.yaml")).success).toBe(true);
  });

  test("example checks.yaml validates", async () => {
    expect(ChecksConfigSchema.safeParse(await loadExample("checks.yaml")).success).toBe(true);
  });

  test("repo.yaml rejects unknown keys", async () => {
    const raw = (await loadExample("repo.yaml")) as Record<string, unknown>;
    expect(RepoConfigSchema.safeParse({ ...raw, bogus: 1 }).success).toBe(false);
  });

  test("ownership.yaml rejects an expert without writes", async () => {
    const raw = (await loadExample("ownership.yaml")) as {
      experts: Record<string, unknown>;
    };
    const mutated = structuredClone(raw);
    mutated.experts["backend"] = { writes: [] };
    expect(OwnershipConfigSchema.safeParse(mutated).success).toBe(false);
  });

  test("checks.yaml rejects an empty check list", async () => {
    const raw = (await loadExample("checks.yaml")) as Record<string, unknown>;
    expect(ChecksConfigSchema.safeParse({ ...raw, checks: [] }).success).toBe(false);
  });

  test("checks.yaml rejects a check without a run command", async () => {
    const raw = (await loadExample("checks.yaml")) as {
      checks: Record<string, unknown>[];
    };
    const mutated = structuredClone(raw);
    mutated.checks = [{ ...mutated.checks[0], run: "" }];
    expect(ChecksConfigSchema.safeParse(mutated).success).toBe(false);
  });
});
