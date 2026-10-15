import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"

/**
 * Pillar 4: On-Demand Domain Packs (`src/packs/index.ts`)
 *
 * Consolidates Heretek-AI's vertical plugins into one unified registry:
 * - `re` (`opencode-rea`): Reverse Engineering & Binary Triage.
 * - `godot` (`godot-opencode`): Godot 4.x Engine `.tscn` scene tree parser & GDScript checker.
 * - `gdevelop` (`GDevelop-Unlocked`): GDevelop 5 `game.json` inspector.
 */

export type DomainPackId = "re" | "godot" | "gdevelop"

export interface DomainPackStatus {
  id: DomainPackId
  title: string
  replacesRepo: string
  active: boolean
  autoDetected: boolean
  reason: string
}

export interface DomainPackDetection {
  godot: boolean
  gdevelop: boolean
  reverseEngineering: boolean
  recommendedPacks: string[]
}

const activePacksByRoot = new Map<string, Set<DomainPackId>>()

export function activateDomainPack(rootDir: string, packId: DomainPackId): void {
  const key = path.resolve(rootDir)
  const set = activePacksByRoot.get(key) ?? new Set<DomainPackId>()
  set.add(packId)
  activePacksByRoot.set(key, set)
}

export async function detectDomainPacks(rootDir: string): Promise<DomainPackDetection> {
  let entries: string[] = []
  try {
    entries = await fs.readdir(rootDir)
  } catch {
    return { godot: false, gdevelop: false, reverseEngineering: false, recommendedPacks: [] }
  }
  const godot = entries.includes("project.godot") || entries.some((n) => n.endsWith(".tscn") || n.endsWith(".gd"))
  const gdevelop = entries.includes("game.json") || entries.some((n) => n.endsWith(".gdg"))
  const reverseEngineering = entries.some((n) => /\.(?:exe|dll|so|dylib|bin|elf|apk|ipa|pcap)$/i.test(n))
  const recommendedPacks: string[] = []
  if (godot) recommendedPacks.push("godot")
  if (gdevelop) recommendedPacks.push("gdevelop")
  if (reverseEngineering) recommendedPacks.push("re")
  return { godot, gdevelop, reverseEngineering, recommendedPacks }
}

export async function inspectGodotScene(
  rootDir: string,
  scenePath: string,
): Promise<{
  path: string
  nodeCount: number
  nodes: Array<{ name: string; type: string; parent: string }>
  externalScripts: string[]
  signalConnections: Array<{ signal: string; from: string; to: string; method: string }>
}> {
  const abs = path.resolve(rootDir, scenePath)
  const raw = await fs.readFile(abs, "utf8")
  const nodes: Array<{ name: string; type: string; parent: string }> = []
  const externalScripts: string[] = []
  const signalConnections: Array<{ signal: string; from: string; to: string; method: string }> = []
  const nodeRe = /\[node\s+name="([^"]+)"(?:\s+type="([^"]+)")?(?:\s+parent="([^"]+)")?[^\]]*\]/g
  const extRe = /\[ext_resource\s+type="Script"\s+path="([^"]+)"[^\]]*\]/g
  const connRe = /\[connection\s+signal="([^"]+)"\s+from="([^"]+)"\s+to="([^"]+)"\s+method="([^"]+)"[^\]]*\]/g
  let m: RegExpExecArray | null
  while ((m = nodeRe.exec(raw)) !== null) {
    nodes.push({ name: m[1], type: m[2] || "Instance", parent: m[3] || "." })
  }
  while ((m = extRe.exec(raw)) !== null) {
    externalScripts.push(m[1])
  }
  while ((m = connRe.exec(raw)) !== null) {
    signalConnections.push({ signal: m[1], from: m[2], to: m[3], method: m[4] })
  }
  return { path: scenePath, nodeCount: nodes.length, nodes, externalScripts, signalConnections }
}

export async function inspectGDevelopProject(
  rootDir: string,
  projectPath: string = "game.json",
): Promise<{
  projectName: string
  version: string
  sceneCount: number
  scenes: Array<{ name: string; objectCount: number; layerCount: number; eventCount: number }>
  externalEventCount: number
  extensionCount: number
}> {
  const abs = path.resolve(rootDir, projectPath)
  const raw = await fs.readFile(abs, "utf8")
  const parsed = JSON.parse(raw)
  const layouts = Array.isArray(parsed.layouts) ? parsed.layouts : []
  const scenes = layouts.map((l: any) => ({
    name: String(l.name ?? "Untitled"),
    objectCount: Array.isArray(l.objects) ? l.objects.length : 0,
    layerCount: Array.isArray(l.layers) ? l.layers.length : 0,
    eventCount: Array.isArray(l.events) ? l.events.length : 0,
  }))
  return {
    projectName: String(parsed.properties?.name ?? "GDevelop Project"),
    version: String(parsed.properties?.version ?? "1.0.0"),
    sceneCount: scenes.length,
    scenes,
    externalEventCount: Array.isArray(parsed.externalEvents) ? parsed.externalEvents.length : 0,
    extensionCount: Array.isArray(parsed.eventsFunctionsExtensions) ? parsed.eventsFunctionsExtensions.length : 0,
  }
}

export async function inspectBinaryTarget(
  rootDir: string,
  binaryPath: string,
): Promise<{
  path: string
  byteLength: number
  sha256: string
  format: string
  entropyBitsPerByte: number
  extractedStringsCount: number
  suspiciousStrings: string[]
}> {
  const abs = path.resolve(rootDir, binaryPath)
  const buf = await fs.readFile(abs)
  const sha256 = createHash("sha256").update(buf).digest("hex")
  let format = "UNKNOWN"
  if (buf.length >= 4) {
    if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) format = "ELF"
    else if (buf[0] === 0x4d && buf[1] === 0x5a) format = "PE/COFF"
    else if (
      (buf[0] === 0xfe && buf[1] === 0xed && buf[2] === 0xfa && (buf[3] === 0xce || buf[3] === 0xcf)) ||
      (buf[3] === 0xfe && buf[2] === 0xed && buf[1] === 0xfa && (buf[0] === 0xce || buf[0] === 0xcf))
    )
      format = "Mach-O"
    else if (buf[0] === 0x00 && buf[1] === 0x61 && buf[2] === 0x73 && buf[3] === 0x6d) format = "WASM"
  }
  const counts = new Array<number>(256).fill(0)
  for (let i = 0; i < buf.length; i++) counts[buf[i]]++
  let entropy = 0
  if (buf.length > 0) {
    for (const c of counts) {
      if (c > 0) {
        const p = c / buf.length
        entropy -= p * Math.log2(p)
      }
    }
  }
  const asciiContent = buf.toString("latin1")
  const strMatches = asciiContent.match(/[ -~]{5,120}/g) ?? []
  const suspiciousRe =
    /(?:https?:\/\/|\/bin\/|\/etc\/|cmd\.exe|powershell|VirtualAlloc|LoadLibrary|dlopen|ptrace|AES|RSA|flag\{|password|token|secret)/i
  const suspiciousStrings = strMatches.filter((s) => suspiciousRe.test(s)).slice(0, 40)
  return {
    path: binaryPath,
    byteLength: buf.length,
    sha256,
    format,
    entropyBitsPerByte: +entropy.toFixed(3),
    extractedStringsCount: strMatches.length,
    suspiciousStrings,
  }
}

export const DOMAIN_PACK_ROLES: Record<string, { id: string; name: string; description: string; mode: string; system: string }> = {
  "specialist-godot": {
    id: "specialist-godot",
    name: "Godot 4 Architect",
    description: "Godot 4.x GDScript, Scene Tree (.tscn), Signal & Shader Specialist (consolidates godot-opencode).",
    mode: "subagent",
    system:
      "You are the Principal Godot 4.x Engine Architect (`specialist-godot`). Inspect `.tscn` scene trees via `tools.packs.godot_inspect_scene`, enforce typed GDScript 2.0 (`class_name`, `@export`, `@onready`), and verify signal connections cleanly.",
  },
  "specialist-gdevelop": {
    id: "specialist-gdevelop",
    name: "GDevelop 5 Specialist",
    description: "GDevelop 5 Event Sheet, Scene JSON (`game.json`), and Custom Behavior Specialist (consolidates GDevelop-Unlocked).",
    mode: "subagent",
    system:
      "You are the Principal GDevelop 5 Game Engineer (`specialist-gdevelop`). Inspect `game.json` via `tools.packs.gdevelop_inspect_game` before mutating scenes, objects, or event sheets, and preserve valid GDevelop JSON schema invariants.",
  },
  "specialist-re": {
    id: "specialist-re",
    name: "Reverse Engineering Analyst",
    description: "Binary Triage, Disassembly, Protocol Reconstruction & Security Analyst (consolidates opencode-rea).",
    mode: "subagent",
    system:
      "You are the Principal Reverse Engineering & Binary Intelligence Analyst (`specialist-re`). Use `tools.packs.re_inspect_binary` for static header, entropy, and string triage before deeper disassembly or decompilation.",
  },
}

export async function registerDomainPacks(ctx: any, rootDir: string): Promise<DomainPackDetection> {
  const detection = await detectDomainPacks(rootDir)
  if (ctx.agent?.transform) {
    await ctx.agent.transform((editor: any) => {
      for (const [id, def] of Object.entries(DOMAIN_PACK_ROLES)) {
        editor.update(id, (item: any) => {
          item.name = def.name
          item.description = def.description
          item.mode = def.mode
          item.system = def.system
        })
      }
    })
  }
  if (ctx.tool?.transform) {
    await ctx.tool.transform((editor: any) => {
      editor.namespace({
        name: "packs",
        description: "Consolidated Domain Packs for Godot 4 (`godot-opencode`), GDevelop 5 (`GDevelop-Unlocked`), and Reverse Engineering (`opencode-rea`).",
      })
      editor.add({
        name: "detect",
        description: "Auto-detect active domain packs (`godot`, `gdevelop`, `re`) in the current workspace.",
        options: { namespace: "packs", codemode: true, pinned: true },
        input: { type: "object", properties: {} },
        output: { type: "object" },
        execute: async () => {
          const res = await detectDomainPacks(rootDir)
          return { output: res, content: JSON.stringify(res, null, 2) }
        },
      })
      editor.add({
        name: "godot_inspect_scene",
        description: "Parse a Godot 4 `.tscn` scene file into its node hierarchy, external scripts, and signal connections.",
        options: { namespace: "packs", codemode: true, pinned: detection.godot },
        input: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
        output: { type: "object" },
        execute: async (input: { path: string }) => {
          const res = await inspectGodotScene(rootDir, input.path)
          return { output: res, content: JSON.stringify(res, null, 2) }
        },
      })
      editor.add({
        name: "gdevelop_inspect_game",
        description: "Parse a GDevelop 5 `game.json` project into scenes, object counts, layers, events, and extensions.",
        options: { namespace: "packs", codemode: true, pinned: detection.gdevelop },
        input: {
          type: "object",
          properties: { path: { type: "string" } },
        },
        output: { type: "object" },
        execute: async (input: { path?: string }) => {
          const res = await inspectGDevelopProject(rootDir, input?.path ?? "game.json")
          return { output: res, content: JSON.stringify(res, null, 2) }
        },
      })
      editor.add({
        name: "gdevelop_unlock_ai_config",
        description:
          "Generate a GDevelop-Unlocked local AI provider bridge configuration (`.opencode/gdevelop-unlocked.json`) pointing GDevelop AI requests to your custom OpenCode/OpenAI-compatible endpoint.",
        options: { namespace: "packs", codemode: true, pinned: detection.gdevelop },
        input: {
          type: "object",
          properties: {
            endpointUrl: { type: "string" },
            modelId: { type: "string" },
            enableDebugTelemetry: { type: "boolean" },
          },
        },
        output: { type: "object" },
        execute: async (input: { endpointUrl?: string; modelId?: string; enableDebugTelemetry?: boolean }) => {
          const cfg = {
            provider: "gdevelop-unlocked-bridge",
            endpointUrl: input?.endpointUrl ?? "http://127.0.0.1:4096/v1",
            modelId: input?.modelId ?? "swarmos-director",
            enableDebugTelemetry: input?.enableDebugTelemetry ?? true,
            generatedAt: new Date().toISOString(),
          }
          const outFile = path.join(rootDir, ".opencode", "gdevelop-unlocked.json")
          await fs.mkdir(path.dirname(outFile), { recursive: true })
          await fs.writeFile(outFile, JSON.stringify(cfg, null, 2), "utf8")
          return { output: cfg, content: `Wrote GDevelop-Unlocked AI endpoint config to ${outFile}` }
        },
      })
      editor.add({
        name: "re_inspect_binary",
        description:
          "Perform static reverse-engineering triage on a binary (`ELF`, `PE/COFF`, `Mach-O`, `WASM`), computing SHA-256, Shannon entropy, and suspicious embedded strings.",
        options: { namespace: "packs", codemode: true, pinned: detection.reverseEngineering },
        input: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
        output: { type: "object" },
        execute: async (input: { path: string }) => {
          const res = await inspectBinaryTarget(rootDir, input.path)
          return { output: res, content: JSON.stringify(res, null, 2) }
        },
      })
    })
  }
  return detection
}

export function registerDomainPackTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "packs",
    description:
      "Unified Heretek Domain Packs (`re` from opencode-rea, `godot` from godot-opencode, `gdevelop` from GDevelop-Unlocked). Dormant until auto-detected or activated via `/pack`.",
  })
  editor.add({
    name: "status",
    description: "List active domain packs in this workspace.",
    options: { namespace: "packs", codemode: true, pinned: false },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const packs = await detectDomainPacks(rootDir)
      return { output: { packs }, content: JSON.stringify(packs, null, 2) }
    },
  })
  editor.add({
    name: "godot_inspect_scene",
    description: "Parse a Godot 4.x `.tscn` scene file into its node hierarchy.",
    options: { namespace: "packs", codemode: true, pinned: false },
    input: {
      type: "object",
      properties: { path: { type: "string", description: "Path to .tscn file" } },
      required: ["path"],
    },
    output: { type: "object" },
    execute: async (input: { path: string }) => {
      const res = await inspectGodotScene(rootDir, input.path)
      return { output: res, content: JSON.stringify(res, null, 2) }
    },
  })
  editor.add({
    name: "gdevelop_inspect_project",
    description: "Parse a GDevelop 5 `game.json` project.",
    options: { namespace: "packs", codemode: true, pinned: false },
    input: {
      type: "object",
      properties: { path: { type: "string", description: "Path to game.json (default 'game.json')" } },
    },
    output: { type: "object" },
    execute: async (input: { path?: string }) => {
      const res = await inspectGDevelopProject(rootDir, input?.path ?? "game.json")
      return { output: res, content: JSON.stringify(res, null, 2) }
    },
  })
  editor.add({
    name: "re_inspect_binary",
    description: "Identify binary format and suspicious strings.",
    options: { namespace: "packs", codemode: true, pinned: false },
    input: {
      type: "object",
      properties: { path: { type: "string", description: "Path to binary file" } },
      required: ["path"],
    },
    output: { type: "object" },
    execute: async (input: { path: string }) => {
      const res = await inspectBinaryTarget(rootDir, input.path)
      return { output: res, content: JSON.stringify(res, null, 2) }
    },
  })
}
