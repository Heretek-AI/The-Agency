import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

/** The toolchain pins exist and agree between versions.env and package.json. */
test("scaffolding: versions.env pins match the installed dependency versions", () => {
  const root = path.join(import.meta.dir, "..", "..");
  const envText = readFileSync(path.join(root, "versions.env"), "utf8");
  const pins = new Map(
    envText
      .split("\n")
      .filter((l) => l.trim().length > 0 && !l.trim().startsWith("#"))
      .map((l) => {
        const eq = l.indexOf("=");
        return [l.slice(0, eq).trim(), l.slice(eq + 1).trim()] as const;
      }),
  );
  expect(pins.get("BUN_VERSION")).toBe("1.4.2");
  expect(pins.get("OPENCODE_VERSION")).toBe("2.0.26");
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    devDependencies: Record<string, string>;
  };
  expect(pkg.devDependencies["typescript"]).toBe(pins.get("TYPESCRIPT_VERSION"));
  expect(pkg.devDependencies["oxlint"]).toBe(pins.get("OXLINT_VERSION"));
  expect(pkg.devDependencies["prettier"]).toBe(pins.get("PRETTIER_VERSION"));
  expect(pkg.devDependencies["@types/bun"]).toBe(pins.get("BUN_TYPES_VERSION"));
  const dispatcher = JSON.parse(
    readFileSync(path.join(root, "dispatcher", "package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  expect(dispatcher.dependencies["zod"]).toBe(pins.get("ZOD_VERSION"));
});
