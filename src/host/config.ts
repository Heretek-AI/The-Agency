import * as fs from "node:fs/promises"
import * as path from "node:path"

export type SwarmOSMode = "full" | "observe"

export interface SwarmOSConfig {
  /** `full` registers every SwarmOS module; `observe` registers only telemetry and `/doctor` (benchmark baseline). */
  mode: SwarmOSMode
  /** Write per-session tool telemetry to `.opencode/telemetry/<sessionID>.jsonl`. */
  telemetry: boolean
  /** Token budget shared by every block SwarmOS injects into a turn (memory, artifacts, hints). */
  contextBudgetTokens: number
  /** Code Mode namespaces pinned for every agent; everything else stays discoverable via search. */
  pinnedNamespaces: string[]
  /** Snapshot target files before every edit/write/patch and roll back all of them if the call fails. */
  autoTransactions: boolean
  /** Downgrade saved approvals to "ask" for risky actions after a session reads untrusted external content. */
  taintTracking: boolean
}

export const DEFAULT_PINNED_NAMESPACES = ["org", "fs", "repo", "verify", "artifacts"]

export const DEFAULT_CONFIG: SwarmOSConfig = {
  mode: "full",
  telemetry: true,
  contextBudgetTokens: 6000,
  pinnedNamespaces: DEFAULT_PINNED_NAMESPACES,
  autoTransactions: true,
  taintTracking: true,
}

export function getConfigPath(rootDir: string): string {
  return path.join(rootDir, ".opencode", "swarmos.json")
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  if (/^(1|true|yes|on)$/i.test(value)) return true
  if (/^(0|false|no|off)$/i.test(value)) return false
  return undefined
}

/**
 * Loads `.opencode/swarmos.json`, then applies `SWARMOS_*` environment overrides.
 */
export async function loadConfig(rootDir: string, env: Record<string, string | undefined> = process.env): Promise<SwarmOSConfig> {
  let fileConfig: Partial<SwarmOSConfig> = {}
  try {
    const raw = await fs.readFile(getConfigPath(rootDir), "utf8")
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") fileConfig = parsed
  } catch {
    // no config file
  }

  const config: SwarmOSConfig = { ...DEFAULT_CONFIG, ...fileConfig }

  if (env.SWARMOS_MODE === "observe" || env.SWARMOS_MODE === "full") config.mode = env.SWARMOS_MODE
  const telemetry = parseBool(env.SWARMOS_TELEMETRY)
  if (telemetry !== undefined) config.telemetry = telemetry
  const budget = Number(env.SWARMOS_CONTEXT_BUDGET)
  if (Number.isFinite(budget) && budget > 0) config.contextBudgetTokens = budget
  if (env.SWARMOS_PINNED) {
    config.pinnedNamespaces = env.SWARMOS_PINNED.split(",").map((s) => s.trim()).filter(Boolean)
  }
  const tx = parseBool(env.SWARMOS_AUTO_TRANSACTIONS)
  if (tx !== undefined) config.autoTransactions = tx
  const taint = parseBool(env.SWARMOS_TAINT_TRACKING)
  if (taint !== undefined) config.taintTracking = taint

  if (config.mode !== "full" && config.mode !== "observe") config.mode = "full"
  if (!Array.isArray(config.pinnedNamespaces)) config.pinnedNamespaces = DEFAULT_PINNED_NAMESPACES
  return config
}
