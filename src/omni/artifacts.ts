import * as fs from "node:fs/promises"
import * as path from "node:path"

export type ArtifactName = "task.md" | "plan.md" | "walkthrough.md" | "notes.md" | string

export function getArtifactsDir(rootDir: string): string {
  return path.join(rootDir, ".opencode", "artifacts")
}

export async function writeArtifact(
  rootDir: string,
  name: ArtifactName,
  content: string,
): Promise<{ name: string; path: string; bytes: number; updatedAt: string }> {
  const safeName = path.basename(name)
  const dir = getArtifactsDir(rootDir)
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, safeName)
  await fs.writeFile(target, content, "utf8")
  return {
    name: safeName,
    path: target,
    bytes: Buffer.byteLength(content, "utf8"),
    updatedAt: new Date().toISOString(),
  }
}

export async function readArtifact(
  rootDir: string,
  name: ArtifactName,
): Promise<{ name: string; exists: boolean; content: string }> {
  const safeName = path.basename(name)
  const target = path.join(getArtifactsDir(rootDir), safeName)
  try {
    const content = await fs.readFile(target, "utf8")
    return { name: safeName, exists: true, content }
  } catch {
    return { name: safeName, exists: false, content: "" }
  }
}

export async function listArtifacts(rootDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(getArtifactsDir(rootDir), { withFileTypes: true })
    return entries.filter((e) => e.isFile()).map((e) => e.name).sort()
  } catch {
    return []
  }
}

export function registerArtifactTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "artifacts",
    description:
      "Antigravity-style persistent workspace artifacts (`task.md`, `plan.md`, `walkthrough.md`, `notes.md`) automatically synced into session context.",
  })

  editor.add({
    name: "write",
    description: "Create or update a persistent Markdown artifact (`task.md`, `plan.md`, `walkthrough.md`, `notes.md`).",
    options: { namespace: "artifacts", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        name: { type: "string", description: "Artifact filename (e.g. 'task.md', 'plan.md', 'walkthrough.md')" },
        content: { type: "string", description: "Complete Markdown content" },
      },
      required: ["name", "content"],
    },
    output: { type: "object" },
    execute: async (input: { name: string; content: string }) => {
      const res = await writeArtifact(rootDir, input.name, input.content)
      return { output: res, content: `Updated artifact ${res.name} (${res.bytes} bytes)` }
    },
  })

  editor.add({
    name: "read",
    description: "Read a persistent Markdown artifact from `.opencode/artifacts/`.",
    options: { namespace: "artifacts", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        name: { type: "string", description: "Artifact filename" },
      },
      required: ["name"],
    },
    output: { type: "object" },
    execute: async (input: { name: string }) => {
      const res = await readArtifact(rootDir, input.name)
      return { output: res, content: res.exists ? res.content : `Artifact ${input.name} does not exist yet.` }
    },
  })

  editor.add({
    name: "list",
    description: "List all persistent artifacts in `.opencode/artifacts/`.",
    options: { namespace: "artifacts", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const files = await listArtifacts(rootDir)
      return { output: { artifacts: files }, content: JSON.stringify(files, null, 2) }
    },
  })
}

/**
 * Automatically injects active `task.md` and `plan.md` artifacts into the session context
 * (excluding compaction requests) so multi-step engineering, GUI, research, and office tasks
 * maintain persistent state across turns.
 */
export async function registerArtifactContextHook(ctx: any, rootDir: string): Promise<void> {
  if (!ctx.session?.hook) return

  const injectArtifacts = async (event: any) => {
    if (event.agent === "compaction" || event.kind === "compaction") return
    if (!Array.isArray(event.system) || event.system.length === 0) return

    const [taskArt, planArt] = await Promise.all([
      readArtifact(rootDir, "task.md"),
      readArtifact(rootDir, "plan.md"),
    ])

    if (!taskArt.exists && !planArt.exists) return

    const sections: string[] = ["<active-workspace-artifacts>"]
    if (taskArt.exists && taskArt.content.trim()) {
      sections.push(`## Active Task Checklist (.opencode/artifacts/task.md)\n${taskArt.content.trim().slice(0, 4000)}`)
    }
    if (planArt.exists && planArt.content.trim()) {
      sections.push(`## Active Implementation Plan (.opencode/artifacts/plan.md)\n${planArt.content.trim().slice(0, 4000)}`)
    }
    sections.push("</active-workspace-artifacts>")

    const lastIdx = event.system.length - 1
    const lastPart = event.system[lastIdx]
    if (lastPart && typeof lastPart.text === "string" && !lastPart.text.includes("<active-workspace-artifacts>")) {
      event.system[lastIdx] = {
        ...lastPart,
        text: `${lastPart.text}\n\n${sections.join("\n\n")}`,
      }
    }
  }

  await ctx.session.hook("context", injectArtifacts)
}
