import { describe, expect, it } from "bun:test"
import SwarmOSPlugin, {
  EMBEDDED_UI_CRAFT_SKILL_MD,
  SWARMOS_PLUGIN_ID,
  SWARMOS_ROLES,
  loadSkillContent,
} from "../src/index.js"
import { extractOutline } from "../src/codemode/fs-outline.js"
import * as path from "node:path"

describe("SwarmOS Plugin & Roles Setup", () => {
  it("satisfies OpenCode V2 PluginModule.load schema ({ id, setup }) while remaining callable", () => {
    expect(SwarmOSPlugin.id).toBe(SWARMOS_PLUGIN_ID)
    expect(SwarmOSPlugin.id).toBe("heretek.swarmos")
    expect(typeof SwarmOSPlugin.setup).toBe("function")
    expect(typeof SwarmOSPlugin).toBe("function")
  })

  it("defines all 7 specialized roles with correct modes", () => {
    const roles = Object.keys(SWARMOS_ROLES)
    expect(roles).toContain("director")
    expect(roles).toContain("architect")
    expect(roles).toContain("manager")
    expect(roles).toContain("staff-backend")
    expect(roles).toContain("staff-ui")
    expect(roles).toContain("qa-adversary")
    expect(roles).toContain("release-ops")

    expect(SWARMOS_ROLES.director.mode).toBe("primary")
    expect(SWARMOS_ROLES.architect.mode).toBe("subagent")
    expect(SWARMOS_ROLES.manager.mode).toBe("subagent")
    expect(SWARMOS_ROLES["staff-backend"].mode).toBe("subagent")
    expect(SWARMOS_ROLES["staff-ui"].mode).toBe("subagent")
    expect(SWARMOS_ROLES["qa-adversary"].mode).toBe("subagent")
    expect(SWARMOS_ROLES["release-ops"].mode).toBe("subagent")
  })

  it("enforces separation of powers via permission rules (including patch for qa-adversary)", () => {
    // Director must be denied edit, write, and patch
    const directorPerms = SWARMOS_ROLES.director.permissions
    expect(directorPerms.find((p) => p.action === "edit" && p.resource === "*")?.effect).toBe("deny")
    expect(directorPerms.find((p) => p.action === "patch" && p.resource === "*")?.effect).toBe("deny")

    // Director subagents must be strictly restricted to leadership reports
    const subagentRules = directorPerms.filter((p) => p.action === "subagent")
    expect(subagentRules.find((p) => p.resource === "*" && p.effect === "deny")).toBeDefined()
    expect(subagentRules.find((p) => p.resource === "architect" && p.effect === "allow")).toBeDefined()
    expect(subagentRules.find((p) => p.resource === "manager" && p.effect === "allow")).toBeDefined()
    expect(subagentRules.find((p) => p.resource === "release-ops" && p.effect === "allow")).toBeDefined()
    expect(subagentRules.find((p) => p.resource === "explore" && p.effect === "allow")).toBeDefined()

    // Manager must be denied edit
    const managerPerms = SWARMOS_ROLES.manager.permissions
    expect(managerPerms.find((p) => p.action === "edit" && p.resource === "*")?.effect).toBe("deny")

    // QA Adversary must deny general edit/write/patch on * and allow edit/write/patch on test patterns
    const qaPerms = SWARMOS_ROLES["qa-adversary"].permissions
    expect(qaPerms.find((p) => p.action === "edit" && p.resource === "*")?.effect).toBe("deny")
    expect(qaPerms.find((p) => p.action === "edit" && p.resource === "*.test.*")?.effect).toBe("allow")
    expect(qaPerms.find((p) => p.action === "patch" && p.resource === "*.test.*")?.effect).toBe("allow")
    expect(qaPerms.find((p) => p.action === "patch" && p.resource === "*.spec.*")?.effect).toBe("allow")
  })

  it("registers all domains on plugin initialization (including update_task and absolute skill path)", async () => {
    const agentsRegistered: Record<string, any> = {}
    const toolsRegistered: Record<string, any> = {}
    const skillsRegistered: Record<string, any> = {}
    const namespaces: string[] = []
    const commandsRegistered: Record<string, any> = {}

    const mockCtx = {
      location: { directory: process.cwd() },
      agent: {
        transform: async (fn: any) => {
          fn({
            update: (id: string, updater: any) => {
              const item = { id, permissions: [] }
              updater(item)
              agentsRegistered[id] = item
            },
          })
        },
      },
      tool: {
        transform: async (fn: any) => {
          fn({
            namespace: (ns: any) => namespaces.push(ns.name),
            add: (tool: any) => {
              toolsRegistered[tool.name] = tool
            },
          })
        },
        hook: async () => {},
      },
      command: {
        transform: async (fn: any) => {
          fn({
            add: (cmd: any) => {
              commandsRegistered[cmd.name] = cmd
            },
          })
        },
      },
      skill: {
        transform: async (fn: any) => {
          fn({
            add: (skill: any) => {
              skillsRegistered[skill.id] = skill
            },
          })
        },
      },
      session: {
        hook: async () => {},
      },
    }

    await SwarmOSPlugin.setup(mockCtx)

    // Agents registered (7 Swarm Engineering + 3 Omni-Harness Adapters + 3 Domain Pack Specialists in v1.0.0+)
    expect(Object.keys(agentsRegistered).length).toBe(13)
    expect(agentsRegistered["studio-gui"].name).toBe("Studio GUI")
    expect(agentsRegistered.researcher.name).toBe("Researcher")
    expect(agentsRegistered["office-analyst"].name).toBe("Office Analyst")
    expect(agentsRegistered.director.name).toBe("Director")
    expect(agentsRegistered["specialist-godot"]).toBeDefined()
    expect(agentsRegistered["specialist-gdevelop"]).toBeDefined()
    expect(agentsRegistered["specialist-re"]).toBeDefined()

    // Namespaces registered
    expect(namespaces).toContain("org")
    expect(namespaces).toContain("ui")
    expect(namespaces).toContain("fs")

    // Tools registered (including update_task)
    expect(toolsRegistered.get_board).toBeDefined()
    expect(toolsRegistered.init_project).toBeDefined()
    expect(toolsRegistered.lock_contract).toBeDefined()
    expect(toolsRegistered.create_task).toBeDefined()
    expect(toolsRegistered.update_task).toBeDefined()
    expect(toolsRegistered.submit_qa_receipt).toBeDefined()
    expect(toolsRegistered.plan_tournament).toBeDefined()
    expect(toolsRegistered.resolve_tournament).toBeDefined()
    expect(toolsRegistered.verify_release_ready).toBeDefined()
    expect(toolsRegistered.get_audit_script).toBeDefined()
    expect(toolsRegistered.get_viewports).toBeDefined()
    expect(toolsRegistered.outline).toBeDefined()

    // Skill registered with absolute path and full embedded content
    expect(skillsRegistered["ui-craft"]).toBeDefined()
    expect(path.isAbsolute(skillsRegistered["ui-craft"].path)).toBe(true)
    expect(skillsRegistered["ui-craft"].content.length).toBeGreaterThan(1500)

    // Commands registered
    expect(commandsRegistered.ship).toBeDefined()
    expect(commandsRegistered.swarm).toBeDefined()
    expect(commandsRegistered.gui).toBeDefined()
    expect(commandsRegistered.research).toBeDefined()
    expect(commandsRegistered.office).toBeDefined()
    expect(commandsRegistered.artifacts).toBeDefined()
  })

  it("embeds full SKILL.md content even when disk path is missing", async () => {
    const content = await loadSkillContent("/nonexistent/swarmos/dir")
    expect(content).toBe(EMBEDDED_UI_CRAFT_SKILL_MD)
    expect(content).toContain("Archetype A: High-Craft Technical Dark")
  })

  it("extracts symbols accurately with fs-outline", async () => {
    const outline = await extractOutline(process.cwd(), "src/board/types.ts")
    expect(outline.path).toBe("src/board/types.ts")
    expect(outline.totalLines).toBeGreaterThan(20)
    expect(outline.symbols.length).toBeGreaterThan(0)
    expect(outline.symbols.some((s) => s.includes("ProjectCharter"))).toBe(true)
  })
})
