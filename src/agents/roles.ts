import {
  PROMPT_ARCHITECT,
  PROMPT_DIRECTOR,
  PROMPT_MANAGER,
  PROMPT_QA_ADVERSARY,
  PROMPT_RELEASE_OPS,
  PROMPT_OFFICE_ANALYST,
  PROMPT_RESEARCHER,
  PROMPT_STAFF_BACKEND,
  PROMPT_STAFF_UI,
  PROMPT_STUDIO_GUI,
} from "./prompts.js"

export interface AgentPermissionRule {
  action: string
  resource: string
  effect: "allow" | "deny" | "ask"
}

export interface AgentDefinition {
  id: string
  name: string
  description: string
  mode: "primary" | "subagent" | "all"
  system: string
  permissions: AgentPermissionRule[]
}

export const SWARMOS_ROLES: Record<string, AgentDefinition> = {
  director: {
    id: "director",
    name: "Director",
    description: "VP of Product & Engineering. Orchestrates Architect, Manager, QA, and Release Ops.",
    mode: "primary",
    system: PROMPT_DIRECTOR,
    permissions: [
      { action: "question", resource: "*", effect: "allow" },
      { action: "edit", resource: "*", effect: "deny" },
      { action: "write", resource: "*", effect: "deny" },
      { action: "patch", resource: "*", effect: "deny" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "architect", effect: "allow" },
      { action: "subagent", resource: "manager", effect: "allow" },
      { action: "subagent", resource: "explore", effect: "allow" },
      { action: "subagent", resource: "release-ops", effect: "allow" },
      { action: "subagent", resource: "studio-gui", effect: "allow" },
      { action: "subagent", resource: "researcher", effect: "allow" },
      { action: "subagent", resource: "office-analyst", effect: "allow" },
    ],
  },
  architect: {
    id: "architect",
    name: "Architect",
    description: "Principal Systems & UI Design Architect. Locks schemas, interfaces, and design tokens first.",
    mode: "subagent",
    system: PROMPT_ARCHITECT,
    permissions: [
      { action: "question", resource: "*", effect: "deny" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "explore", effect: "allow" },
    ],
  },
  manager: {
    id: "manager",
    name: "Manager",
    description: "Engineering Manager. Coordinates parallel staff-backend, staff-ui, and qa-adversary agents.",
    mode: "subagent",
    system: PROMPT_MANAGER,
    permissions: [
      { action: "question", resource: "*", effect: "deny" },
      { action: "edit", resource: "*", effect: "deny" },
      { action: "write", resource: "*", effect: "deny" },
      { action: "patch", resource: "*", effect: "deny" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "staff-backend", effect: "allow" },
      { action: "subagent", resource: "staff-ui", effect: "allow" },
      { action: "subagent", resource: "qa-adversary", effect: "allow" },
      { action: "subagent", resource: "explore", effect: "allow" },
    ],
  },
  "staff-backend": {
    id: "staff-backend",
    name: "Staff Backend",
    description: "Principal Backend & Systems Engineer. Implements data layers, APIs, business logic, and unit tests.",
    mode: "subagent",
    system: PROMPT_STAFF_BACKEND,
    permissions: [
      { action: "question", resource: "*", effect: "deny" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "explore", effect: "allow" },
    ],
  },
  "staff-ui": {
    id: "staff-ui",
    name: "Staff UI",
    description: "Principal Design Engineer. Builds high-craft UIs and verifies DOM geometry & screenshots in the browser.",
    mode: "subagent",
    system: PROMPT_STAFF_UI,
    permissions: [
      { action: "question", resource: "*", effect: "deny" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "explore", effect: "allow" },
    ],
  },
  "qa-adversary": {
    id: "qa-adversary",
    name: "QA Adversary",
    description: "Adversarial QA, E2E & Visual Gatekeeper. Audits diffs, runs tests & DOM geometry checks, and issues PASS/REJECT receipts.",
    mode: "subagent",
    system: PROMPT_QA_ADVERSARY,
    permissions: [
      { action: "question", resource: "*", effect: "deny" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "explore", effect: "allow" },
      { action: "edit", resource: "*", effect: "deny" },
      { action: "write", resource: "*", effect: "deny" },
      { action: "patch", resource: "*", effect: "deny" },
      { action: "edit", resource: "*.test.*", effect: "allow" },
      { action: "edit", resource: "*.spec.*", effect: "allow" },
      { action: "edit", resource: "*test*/*", effect: "allow" },
      { action: "edit", resource: "*tests*/*", effect: "allow" },
      { action: "edit", resource: "*e2e*/*", effect: "allow" },
      { action: "write", resource: "*.test.*", effect: "allow" },
      { action: "write", resource: "*.spec.*", effect: "allow" },
      { action: "write", resource: "*test*/*", effect: "allow" },
      { action: "write", resource: "*tests*/*", effect: "allow" },
      { action: "write", resource: "*e2e*/*", effect: "allow" },
      { action: "patch", resource: "*.test.*", effect: "allow" },
      { action: "patch", resource: "*.spec.*", effect: "allow" },
      { action: "patch", resource: "*test*/*", effect: "allow" },
      { action: "patch", resource: "*tests*/*", effect: "allow" },
      { action: "patch", resource: "*e2e*/*", effect: "allow" },
    ],
  },
  "release-ops": {
    id: "release-ops",
    name: "Release Ops",
    description: "Staff Release & Integration Engineer. Merges verified worktrees and runs full-repo checks.",
    mode: "subagent",
    system: PROMPT_RELEASE_OPS,
    permissions: [
      { action: "question", resource: "*", effect: "deny" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "explore", effect: "allow" },
      { action: "subagent", resource: "qa-adversary", effect: "allow" },
    ],
  },
  "studio-gui": {
    id: "studio-gui",
    name: "Studio GUI",
    description: "Primary Web & Native Desktop GUI Designer. Combines token-first styling with live DOM geometry & desktop window visual critique.",
    mode: "all",
    system: PROMPT_STUDIO_GUI,
    permissions: [
      { action: "question", resource: "*", effect: "allow" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "explore", effect: "allow" },
      { action: "subagent", resource: "qa-adversary", effect: "allow" },
    ],
  },
  researcher: {
    id: "researcher",
    name: "Researcher",
    description: "Primary Deep Research & Technical Intelligence Analyst. Runs parallel web/repo discovery with a verified citation ledger.",
    mode: "all",
    system: PROMPT_RESEARCHER,
    permissions: [
      { action: "question", resource: "*", effect: "allow" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "explore", effect: "allow" },
    ],
  },
  "office-analyst": {
    id: "office-analyst",
    name: "Office Analyst",
    description: "Primary Document, Spreadsheet, Presentation & Data Architect (.docx, .xlsx, .pptx, .pdf, .sqlite) with visual page previewing.",
    mode: "all",
    system: PROMPT_OFFICE_ANALYST,
    permissions: [
      { action: "question", resource: "*", effect: "allow" },
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "explore", effect: "allow" },
    ],
  },
}

export function registerSwarmOSAgents(editor: any): void {
  for (const [id, def] of Object.entries(SWARMOS_ROLES)) {
    editor.update(id, (item: any) => {
      item.name = def.name
      item.description = def.description
      item.mode = def.mode
      item.system = def.system
      if (!Array.isArray(item.permissions)) {
        item.permissions = []
      }
      for (const rule of def.permissions) {
        item.permissions.push(rule)
      }
    })
  }
}
