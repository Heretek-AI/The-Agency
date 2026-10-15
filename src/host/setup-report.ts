import * as path from "node:path"
import type { SwarmOSMode } from "./config.js"
import { hasCapability, type HostProbeResult } from "./contract.js"

export interface ModuleReport {
  id: string
  status: "registered" | "skipped" | "failed"
  detail?: string
  agents: string[]
  namespaces: string[]
  tools: string[]
  hooks: string[]
  commands: string[]
  skills: string[]
  /** Exceptions thrown by this module's hook handlers at runtime (caught so the host tool call survives). */
  runtimeErrors: Array<{ hook: string; message: string; at: string }>
  /** How many times the host has invoked each hook this module registered. */
  hookCalls: Record<string, number>
}

export interface SetupReport {
  version: string
  mode: SwarmOSMode
  rootDir: string
  startedAt: string
  host: HostProbeResult[]
  modules: ModuleReport[]
}

export interface SetupModule {
  id: string
  requires: string[]
  run: (ctx: any) => Promise<void> | void
}

const reports = new Map<string, SetupReport>()

export function getSetupReport(rootDir: string): SetupReport | undefined {
  return reports.get(path.resolve(rootDir))
}

export function storeSetupReport(report: SetupReport): void {
  reports.set(path.resolve(report.rootDir), report)
}

function newModuleReport(id: string): ModuleReport {
  return { id, status: "registered", agents: [], namespaces: [], tools: [], hooks: [], commands: [], skills: [], runtimeErrors: [], hookCalls: {} }
}

const MAX_RUNTIME_ERRORS = 20

function guardHandler(rec: ModuleReport, hookId: string, handler: any): any {
  if (typeof handler !== "function") return handler
  return async (...args: any[]) => {
    rec.hookCalls[hookId] = (rec.hookCalls[hookId] ?? 0) + 1
    try {
      return await handler(...args)
    } catch (err: any) {
      rec.runtimeErrors.push({ hook: hookId, message: String(err?.message ?? err).slice(0, 300), at: new Date().toISOString() })
      if (rec.runtimeErrors.length > MAX_RUNTIME_ERRORS) rec.runtimeErrors.shift()
      return undefined
    }
  }
}

function wrapEditor(editor: any, domain: string, rec: ModuleReport): any {
  if (!editor || typeof editor !== "object") return editor
  return new Proxy(editor, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== "function") return value
      return (...args: any[]) => {
        const arg = args[0]
        if (domain === "tool" && prop === "add" && arg?.name) {
          const ns = arg.options?.namespace
          rec.tools.push(ns ? `${ns}.${arg.name}` : String(arg.name))
        } else if (domain === "tool" && prop === "namespace" && arg?.name) {
          rec.namespaces.push(String(arg.name))
        } else if (domain === "command" && prop === "add" && arg?.name) {
          rec.commands.push(String(arg.name))
        } else if (domain === "agent" && prop === "update" && typeof arg === "string") {
          rec.agents.push(arg)
        } else if (domain === "skill" && prop === "add" && (arg?.id || arg?.name)) {
          rec.skills.push(String(arg.id ?? arg.name))
        }
        return value.apply(target, args)
      }
    },
  })
}

const INSTRUMENTED_DOMAINS = new Set(["agent", "tool", "command", "skill", "permission", "session"])

/**
 * Wraps the host context so everything a module registers is recorded in its report,
 * and every hook handler it installs is exception-isolated.
 */
export function instrumentHost(ctx: any, rec: ModuleReport): any {
  return new Proxy(ctx, {
    get(target, prop, receiver) {
      const domainValue = Reflect.get(target, prop, receiver)
      if (typeof prop !== "string" || !INSTRUMENTED_DOMAINS.has(prop) || !domainValue || typeof domainValue !== "object") {
        return domainValue
      }
      const domain = prop
      return new Proxy(domainValue, {
        get(dTarget, dProp, dReceiver) {
          const fn = Reflect.get(dTarget, dProp, dReceiver)
          if (typeof fn !== "function") return fn
          if (dProp === "transform") {
            return (callback: any) =>
              fn.call(dTarget, (editor: any, ...rest: any[]) => callback(wrapEditor(editor, domain, rec), ...rest))
          }
          if (dProp === "hook") {
            return (hookName: string, handler: any, ...rest: any[]) => {
              const hookId = `${domain}.${hookName}`
              rec.hooks.push(hookId)
              return fn.call(dTarget, hookName, guardHandler(rec, hookId, handler), ...rest)
            }
          }
          return fn.bind(dTarget)
        },
      })
    },
  })
}

function registeredSomething(rec: ModuleReport): boolean {
  return (
    rec.agents.length + rec.namespaces.length + rec.tools.length + rec.hooks.length + rec.commands.length + rec.skills.length >
    0
  )
}

/**
 * Runs each setup module in isolation: a missing host capability marks it `skipped`,
 * an exception marks it `failed`, and neither stops the remaining modules.
 */
export async function runSetupModules(ctx: any, modules: SetupModule[], report: SetupReport): Promise<void> {
  for (const mod of modules) {
    const rec = newModuleReport(mod.id)
    report.modules.push(rec)

    const missing = mod.requires.filter((cap) => !hasCapability(ctx, cap))
    if (missing.length > 0) {
      rec.status = "skipped"
      rec.detail = `host lacks ${missing.join(", ")}`
      continue
    }

    try {
      await mod.run(instrumentHost(ctx, rec))
      if (!registeredSomething(rec)) {
        rec.status = "skipped"
        rec.detail = "module ran but registered nothing"
      }
    } catch (err: any) {
      rec.status = "failed"
      rec.detail = String(err?.message ?? err).slice(0, 300)
    }
  }
}

export function formatDoctorReport(report: SetupReport | undefined, extras: string[] = []): string {
  if (!report) return "# SwarmOS Doctor\n\n_SwarmOS setup has not run in this workspace._"

  const missingRequired = report.host.filter((h) => h.required && !h.present)
  const lines: string[] = [
    `# SwarmOS Doctor (v${report.version}, mode: ${report.mode})`,
    "",
    `Workspace: \`${report.rootDir}\` · setup at ${report.startedAt}`,
    "",
    missingRequired.length === 0
      ? "**Host contract: OK.** Every required OpenCode V2 capability is present."
      : `**Host contract: BROKEN.** Missing required capabilities: ${missingRequired.map((m) => `\`${m.id}\``).join(", ")}. Modules depending on them are not active.`,
    "",
    "## Host capabilities",
    "| Capability | Present | Required | Used by |",
    "| :--- | :--- | :--- | :--- |",
    ...report.host.map((h) => `| \`${h.id}\` | ${h.present ? "yes" : "**no**"} | ${h.required ? "yes" : "no"} | ${h.usedBy} |`),
    "",
    "## Modules",
    "| Module | Status | Registered | Runtime errors |",
    "| :--- | :--- | :--- | :--- |",
    ...report.modules.map((m) => {
      const parts = [
        m.agents.length ? `${m.agents.length} agent(s)` : "",
        m.tools.length ? `${m.tools.length} tool(s)` : "",
        m.hooks.length ? `hooks: ${[...new Set(m.hooks)].join(", ")}` : "",
        m.commands.length ? `commands: ${m.commands.map((c) => `/${c}`).join(", ")}` : "",
        m.skills.length ? `skills: ${m.skills.join(", ")}` : "",
      ].filter(Boolean)
      const status = m.status === "registered" ? "registered" : `**${m.status}**${m.detail ? ` (${m.detail})` : ""}`
      return `| ${m.id} | ${status} | ${parts.join("; ") || "-"} | ${m.runtimeErrors.length} |`
    }),
  ]

  const hookTotals: Record<string, number> = {}
  for (const m of report.modules) {
    for (const h of m.hooks) hookTotals[h] ??= 0
    for (const [h, n] of Object.entries(m.hookCalls)) hookTotals[h] = (hookTotals[h] ?? 0) + n
  }
  const hookIds = Object.keys(hookTotals).sort()
  if (hookIds.length > 0) {
    lines.push(
      "",
      "## Hook activity",
      "Calls received from the host since setup. A hook stuck at 0 after real tool use means the host never fires it.",
      "",
      ...hookIds.map((h) => `- \`${h}\`: ${hookTotals[h]}`),
    )
  }

  const errored = report.modules.filter((m) => m.runtimeErrors.length > 0)
  if (errored.length > 0) {
    lines.push("", "## Recent hook errors")
    for (const m of errored) {
      for (const e of m.runtimeErrors.slice(-3)) {
        lines.push(`- \`${m.id}\` ${e.hook} @ ${e.at}: ${e.message}`)
      }
    }
  }

  if (extras.length > 0) lines.push("", ...extras)
  return lines.join("\n")
}
