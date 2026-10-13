import { describe, expect, test } from "bun:test";
import { baseEnv, optionalEnv, requiredEnv } from "../src/config.js";

describe("config", () => {
  test("requiredEnv returns a set variable and refuses empty ones", () => {
    process.env["AGENCY_STAGE0_PROBE"] = "yes";
    expect(requiredEnv("AGENCY_STAGE0_PROBE")).toBe("yes");
    process.env["AGENCY_STAGE0_PROBE"] = "";
    expect(() => requiredEnv("AGENCY_STAGE0_PROBE")).toThrow(/AGENCY_STAGE0_PROBE/);
    delete process.env["AGENCY_STAGE0_PROBE"];
    expect(() => requiredEnv("AGENCY_STAGE0_PROBE")).toThrow(/AGENCY_STAGE0_PROBE/);
    expect(optionalEnv("AGENCY_STAGE0_PROBE", "fallback")).toBe("fallback");
  });

  test("baseEnv returns only PATH and LANG", () => {
    process.env["AGENCY_STAGE0_CANARY"] = "must-not-leak";
    const env = baseEnv();
    expect(Object.keys(env).sort()).toEqual(["LANG", "PATH"]);
    expect(env["AGENCY_STAGE0_CANARY"]).toBeUndefined();
    delete process.env["AGENCY_STAGE0_CANARY"];
  });
});
