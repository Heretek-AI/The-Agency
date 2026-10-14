/** Typed environment access. This is the only module under
 * `dispatcher/src` or `verifier/src` that may read `process.env`
 * (enforced by the `lint` target in the Makefile).
 *
 * `baseEnv()` returns only `PATH` and `LANG` for callers to extend
 * deliberately; every child process receives an explicit environment.
 */
import { parse as parseYaml } from "yaml";
import { FleetSchema, type FleetConfig } from "./fleet-schema.js";
import {
  ChecksConfigSchema,
  OwnershipConfigSchema,
  RepoConfigSchema,
  type ChecksConfig,
  type OwnershipConfig,
  type RepoConfig,
} from "./registry-schema.js";

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`refusing to start: ${name} is empty or unset`);
  }
  return value;
}

export function optionalEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

/** Minimal explicit environment: only PATH and LANG, nothing else. */
export function baseEnv(): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    LANG: process.env["LANG"] ?? "C.UTF-8",
  };
}

/** Load and validate `fleet.yaml` (the roster source of truth). */
export async function loadFleet(fleetPath: string): Promise<FleetConfig> {
  let text: string;
  try {
    text = await Bun.file(fleetPath).text();
  } catch {
    throw new Error(`refusing to start: cannot read fleet config at ${fleetPath}`);
  }
  const parsed: unknown = parseYaml(text);
  const result = FleetSchema.safeParse(parsed);
  if (!result.success)
    throw new Error(
      `refusing to start: invalid fleet config at ${fleetPath}: ${result.error.issues[0]?.message}`,
    );
  return result.data;
}

export interface RepoRegistry {
  repo: RepoConfig;
  ownership: OwnershipConfig;
  checks: ChecksConfig;
}

async function loadYamlFile(filePath: string, what: string): Promise<unknown> {
  let text: string;
  try {
    text = await Bun.file(filePath).text();
  } catch {
    throw new Error(`refusing to start: cannot read ${what} at ${filePath}`);
  }
  try {
    return parseYaml(text);
  } catch (err) {
    throw new Error(
      `refusing to start: invalid YAML in ${what} at ${filePath}: ${(err as Error).message}`,
    );
  }
}

/**
 * Load one repository's fleet-side control files from
 * `state/registry/<repoId>/` (never mounted into experts). Fails closed
 * when any file is missing or invalid.
 */
export async function loadRegistry(registryDir: string): Promise<RepoRegistry> {
  const repo = RepoConfigSchema.safeParse(
    await loadYamlFile(`${registryDir}/repo.yaml`, "repo.yaml"),
  );
  if (!repo.success)
    throw new Error(
      `refusing to start: invalid repo.yaml in ${registryDir}: ${repo.error.issues[0]?.message}`,
    );
  const ownership = OwnershipConfigSchema.safeParse(
    await loadYamlFile(`${registryDir}/ownership.yaml`, "ownership.yaml"),
  );
  if (!ownership.success)
    throw new Error(
      `refusing to start: invalid ownership.yaml in ${registryDir}: ${ownership.error.issues[0]?.message}`,
    );
  const checks = ChecksConfigSchema.safeParse(
    await loadYamlFile(`${registryDir}/checks.yaml`, "checks.yaml"),
  );
  if (!checks.success)
    throw new Error(
      `refusing to start: invalid checks.yaml in ${registryDir}: ${checks.error.issues[0]?.message}`,
    );
  return { repo: repo.data, ownership: ownership.data, checks: checks.data };
}

/** `director` → `DIRECTOR`. Matches the renderer's `upper` and init-env. */
export function envNamePrefix(expertName: string): string {
  return expertName.toUpperCase().replace(/-/g, "_");
}

export interface ExpertConnection {
  name: string;
  baseUrl: string;
  password: string;
}

/**
 * Connection for one expert: `http://<name>:4096` on the fleet network
 * (overridable for tests) with its unique server password. A missing
 * password throws naming the variable; there are no credential defaults.
 */
export function expertConnection(
  fleet: FleetConfig,
  expertName: string,
  baseUrlOverride?: string,
): ExpertConnection {
  const expert = fleet.experts[expertName];
  if (expert === undefined) throw new Error(`refusing to start: unknown expert ${expertName}`);
  if (!expert.enabled) throw new Error(`refusing to start: expert ${expertName} is disabled`);
  const password = requiredEnv(`PW_${envNamePrefix(expertName)}`);
  return { name: expertName, baseUrl: baseUrlOverride ?? `http://${expertName}:4096`, password };
}

/** The single model id the whole fleet uses. */
export function fleetModel(): string {
  return requiredEnv("AGENCY_MODEL");
}

export interface VerifierConnection {
  baseUrl: string;
  token: string;
}

/** Verifier endpoint on the fleet network with its bearer token. */
export function verifierConnection(baseUrlOverride?: string): VerifierConnection {
  return {
    baseUrl: baseUrlOverride ?? "http://verifier:8080",
    token: requiredEnv("VERIFIER_TOKEN"),
  };
}
