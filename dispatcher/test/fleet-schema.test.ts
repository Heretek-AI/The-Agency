import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { FleetSchema, enabledExperts } from "../src/fleet-schema.js";

const CORE_TWELVE = [
  "director",
  "scout",
  "architect",
  "product",
  "frontend",
  "backend",
  "dba",
  "platform",
  "security",
  "qa",
  "reviewer",
  "docs",
];

const ALL_TWENTY_FIVE = [
  ...CORE_TWELVE,
  "qa-functional",
  "qa-adversarial",
  "api",
  "sre",
  "performance",
  "debugger",
  "refactor",
  "data",
  "ml",
  "mobile",
  "design",
  "release",
  "compliance",
];

async function loadFleet(): Promise<unknown> {
  const file = Bun.file(new URL("../../fleet.yaml", import.meta.url));
  return parseYaml(await file.text());
}

describe("fleet.yaml", () => {
  test("validates against the schema", async () => {
    const parsed = FleetSchema.safeParse(await loadFleet());
    expect(parsed.success).toBe(true);
  });

  test("holds the 25 names in shared context 9.10 and no others", async () => {
    const fleet = FleetSchema.parse(await loadFleet());
    expect(Object.keys(fleet.experts).sort()).toEqual([...ALL_TWENTY_FIVE].sort());
  });

  test("enables exactly the twelve core experts", async () => {
    const fleet = FleetSchema.parse(await loadFleet());
    expect(enabledExperts(fleet).sort()).toEqual([...CORE_TWELVE].sort());
  });
});

describe("fleet schema rejections", () => {
  test("rejects an unknown key", async () => {
    const raw = (await loadFleet()) as Record<string, unknown>;
    const experts = (raw["experts"] ?? {}) as Record<string, Record<string, unknown>>;
    const mutated = structuredClone(raw);
    (mutated["experts"] as Record<string, Record<string, unknown>>)["backend"] = {
      ...experts["backend"],
      somethingNew: true,
    };
    expect(FleetSchema.safeParse(mutated).success).toBe(false);
  });

  test("rejects an ro expert with proposed_writes", async () => {
    const raw = (await loadFleet()) as Record<string, unknown>;
    const mutated = structuredClone(raw);
    const experts = mutated["experts"] as Record<string, Record<string, unknown>>;
    (experts["scout"] as Record<string, unknown>)["proposed_writes"] = ["notes/*"];
    expect(FleetSchema.safeParse(mutated).success).toBe(false);
  });

  test("rejects a scoped expert without proposed_writes", async () => {
    const raw = (await loadFleet()) as Record<string, unknown>;
    const mutated = structuredClone(raw);
    const experts = mutated["experts"] as Record<string, Record<string, unknown>>;
    (experts["backend"] as Record<string, unknown>)["proposed_writes"] = [];
    expect(FleetSchema.safeParse(mutated).success).toBe(false);
  });

  test("rejects an unknown tier value", async () => {
    const raw = (await loadFleet()) as Record<string, unknown>;
    const mutated = structuredClone(raw);
    const experts = mutated["experts"] as Record<string, Record<string, unknown>>;
    (experts["backend"] as Record<string, unknown>)["tier"] = "ultra";
    expect(FleetSchema.safeParse(mutated).success).toBe(false);
  });
});
