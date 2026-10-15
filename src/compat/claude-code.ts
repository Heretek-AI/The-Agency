import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

/**
 * Pillar 2: Claude Code Compatibility Bridge (`src/compat/claude-code.ts`)
 *
 * Absorbs `Heretek-AI/claude-4-opencode` directly into SwarmOS:
 * Discovers `.claude/commands`, `.claude/agents`, and `.claude/skills` assets
 * from the workspace root (and optionally `~/.claude/`) and registers them into OpenCode V2's
 * command, agent, and skill catalogs automatically.
 */

export interface ClaudeCommandDef {
  name: string
  description: string
  template: string
  promptTemplate: string
  path: string
  sourcePath: string
}

export interface ClaudeAgentDef {
  id: string
  name: string
  description: string
  system: string
  systemPrompt: string
  path: string
  sourcePath: string
}

export interface ClaudeSkillDef {
  id: string
  name: string
  description: string
  content: string
  path: string
  sourcePath: string
}

export interface ClaudeBridgeInventory {
  commands: ClaudeCommandDef[]
  agents: ClaudeAgentDef[]
  skills: ClaudeSkillDef[]
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n")
  if (!normalized.startsWith("---\n")) {
    return { meta: {}, body: normalized.trim() }
  }
  const endIdx = normalized.indexOf("\n---\n", 4)
  if (endIdx < 0) {
    return { meta: {}, body: normalized.trim() }
  }
  const fmBlock = normalized.slice(4, endIdx)
  const body = normalized.slice(endIdx + 5).trim()
  const meta: Record<string, string> = {}
  for (const line of fmBlock.split("\n")) {
    const colonIdx = line.indexOf(":")
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().toLowerCase()
      const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "")
      meta[key] = val
    }
  }
  return { meta, body }
}

async function listMdFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => path.join(dir, e.name))
  } catch {
    return []
  }
}

async function scanMarkdownFilesCompat(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const out: string[] = []
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isFile() && e.name.endsWith(".md")) {
        out.push(full)
      } else if (e.isDirectory()) {
        const skillMd = path.join(full, "SKILL.md")
        try {
          await fs.access(skillMd)
          out.push(skillMd)
        } catch {}
      }
    }
    return out.sort()
  } catch {
    return []
  }
}

export async function discoverClaudeCodeAssets(rootDir: string, second?: boolean | string): Promise<ClaudeBridgeInventory> {
  // Backwards compat: second arg was boolean includeUserHome; new API uses string extraClaudeDir
  let includeUserHome = false
  let extraClaudeDir: string | undefined
  if (typeof second === "boolean") includeUserHome = second
  else if (typeof second === "string" && second.length > 0) extraClaudeDir = second

  const roots: string[] = [path.join(rootDir, ".claude")]
  if (includeUserHome) roots.push(path.join(os.homedir(), ".claude"))
  if (extraClaudeDir) roots.push(path.resolve(extraClaudeDir))

  const commands: ClaudeCommandDef[] = []
  const agents: ClaudeAgentDef[] = []
  const skills: ClaudeSkillDef[] = []
  const seenCmds = new Set<string>()
  const seenAgents = new Set<string>()
  const seenSkills = new Set<string>()

  for (const base of roots) {
    // 1. commands
    const cmdFiles = [...(await listMdFiles(path.join(base, "commands"))), ...(await scanMarkdownFilesCompat(path.join(base, "commands")))]
    const uniqCmdFiles = [...new Set(cmdFiles)].sort()
    for (const file of uniqCmdFiles) {
      const rawName = path.basename(file, ".md").toLowerCase().replace(/[^a-z0-9_-]/g, "-")
      if (seenCmds.has(rawName)) continue
      try {
        const raw = await fs.readFile(file, "utf8")
        const { meta, body } = parseFrontmatter(raw)
        const name = (meta.name || rawName).toLowerCase().replace(/[^a-z0-9_-]/g, "-")
        if (seenCmds.has(name)) continue
        seenCmds.add(name)
        seenCmds.add(rawName)
        commands.push({
          name,
          description: meta.description || `Claude Code command /${name}`,
          template: body,
          promptTemplate: body,
          path: file,
          sourcePath: file,
        })
      } catch {}
    }

    // 2. agents
    const agentFiles = [...(await listMdFiles(path.join(base, "agents"))), ...(await scanMarkdownFilesCompat(path.join(base, "agents")))]
    const uniqAgentFiles = [...new Set(agentFiles)].sort()
    for (const file of uniqAgentFiles) {
      try {
        const raw = await fs.readFile(file, "utf8")
        const { meta, body } = parseFrontmatter(raw)
        const id = (meta.id || meta.name || path.basename(file, ".md")).toLowerCase().replace(/[^a-z0-9_-\s]/g, "").replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "-")
        if (seenAgents.has(id)) continue
        seenAgents.add(id)
        agents.push({
          id,
          name: meta.name || id,
          description: meta.description || `Claude Code agent ${id}`,
          system: body,
          systemPrompt: body,
          path: file,
          sourcePath: file,
        })
      } catch {}
    }

    // 3. skills — support both direct SKILL.md scan and nested skill dirs
    try {
      const skillDirs = await fs.readdir(path.join(base, "skills"), { withFileTypes: true })
      for (const d of skillDirs) {
        if (!d.isDirectory()) continue
        const skillFile = path.join(base, "skills", d.name, "SKILL.md")
        try {
          const raw = await fs.readFile(skillFile, "utf8")
          const { meta } = parseFrontmatter(raw)
          const parentName = d.name
          const id = (meta.name || parentName).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "-")
          if (seenSkills.has(id)) continue
          seenSkills.add(id)
          skills.push({
            id,
            name: meta.name || parentName,
            description: meta.description || `Claude Code skill ${id}`,
            content: raw,
            path: skillFile,
            sourcePath: skillFile,
          })
        } catch {}
      }
    } catch {}
    // Also cover scan-based skill files (dist-style) that may have been missed
    const skillFiles = await scanMarkdownFilesCompat(path.join(base, "skills"))
    for (const file of skillFiles) {
      try {
        const raw = await fs.readFile(file, "utf8")
        const { meta } = parseFrontmatter(raw)
        const parentName = path.basename(path.dirname(file))
        const fallback = parentName !== "skills" ? parentName : path.basename(file, ".md")
        const id = (meta.name || fallback).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "-")
        if (seenSkills.has(id)) continue
        seenSkills.add(id)
        skills.push({
          id,
          name: meta.name || fallback,
          description: meta.description || `Claude Code skill ${id}`,
          content: raw,
          path: file,
          sourcePath: file,
        })
      } catch {}
    }
  }

  return { commands, agents, skills }
}

export async function registerClaudeCodeBridge(ctx: any, rootDir: string): Promise<ClaudeBridgeInventory> {
  const inv = await discoverClaudeCodeAssets(rootDir, false)

  if (inv.agents.length > 0 && ctx.agent?.transform) {
    await ctx.agent.transform((editor: any) => {
      for (const a of inv.agents) {
        editor.update(a.id, (item: any) => {
          item.name = a.name
          item.description = a.description
          item.mode = "subagent"
          item.system = (a.systemPrompt ?? a.system) as string
        })
      }
    })
  }

  if (inv.skills.length > 0 && ctx.skill?.transform) {
    await ctx.skill.transform((editor: any) => {
      for (const s of inv.skills) {
        editor.add({
          id: s.id,
          name: s.name,
          description: s.description,
          autoinvoke: false,
          path: s.sourcePath ?? s.path,
          content: s.content,
        })
      }
    })
  }

  if (inv.commands.length > 0 && ctx.command?.transform) {
    await ctx.command.transform((editor: any) => {
      for (const cmd of inv.commands) {
        editor.add({
          name: cmd.name,
          description: cmd.description,
          execute: async (input: any) => {
            const args = String(input?.prompt?.text ?? input?.prompt ?? "").trim()
            const template = (cmd.promptTemplate ?? cmd.template) as string
            const rendered = template.includes("$ARGUMENTS")
              ? template.replaceAll("$ARGUMENTS", args)
              : `${template}${args ? `\n\n${args}` : ""}`
            if (ctx.session?.prompt) {
              await ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: rendered,
                delivery: input.delivery ?? "steer",
              })
            }
          },
        })
      }
    })
  }

  return inv
}

export function registerClaudeCompatTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "claude",
    description:
      "claude-4-opencode Compatibility Bridge: discovers and imports `.claude/commands`, `.claude/agents`, and `.claude/skills` into OpenCode V2.",
  })
  editor.add({
    name: "discover",
    description: "Scan `.claude/` directories for Claude Code slash commands, specialized subagents, and skills.",
    options: { namespace: "claude", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        extraClaudeDir: { type: "string" },
      },
    },
    output: { type: "object" },
    execute: async (input: { extraClaudeDir?: string }) => {
      const assets = await discoverClaudeCodeAssets(rootDir, input?.extraClaudeDir)
      return { output: assets, content: JSON.stringify(assets, null, 2) }
    },
  })
}

export function registerClaudeBridgeTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "claude",
    description: "Claude Code Compatibility Bridge (`claude-4-opencode`): inspects and loads Claude assets.",
  })

  editor.add({
    name: "inventory",
    description: "List all Claude Code commands, subagents, and skills discovered in `.claude/`.",
    options: { namespace: "claude", codemode: true, pinned: false },
    input: {
      type: "object",
      properties: {
        includeUserHome: { type: "boolean", description: "Also scan ~/.claude/ (default false)" },
      },
    },
    output: { type: "object" },
    execute: async (input: { includeUserHome?: boolean }) => {
      const inv = await discoverClaudeCodeAssets(rootDir, Boolean(input?.includeUserHome))
      return { output: inv, content: JSON.stringify(inv, null, 2) }
    },
  })
}
