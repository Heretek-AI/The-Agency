import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface CheckpointFileEntry {
  path: string
  exists: boolean
  contentBase64?: string
}

export interface CheckpointManifest {
  id: string
  label: string
  createdAt: string
  files: CheckpointFileEntry[]
}

export function getCheckpointsDir(rootDir: string): string {
  return path.join(rootDir, ".opencode", "checkpoints")
}

export async function createCheckpoint(
  rootDir: string,
  input: { id?: string; label: string; paths: string[] },
): Promise<Omit<CheckpointManifest, "files"> & { fileCount: number }> {
  const id = input.id ?? `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const dir = getCheckpointsDir(rootDir)
  await fs.mkdir(dir, { recursive: true })

  const files: CheckpointFileEntry[] = []
  for (const rawPath of input.paths) {
    const abs = path.resolve(rootDir, rawPath)
    const rel = path.relative(rootDir, abs).split(path.sep).join("/")
    try {
      const buf = await fs.readFile(abs)
      files.push({
        path: rel,
        exists: true,
        contentBase64: buf.toString("base64"),
      })
    } catch {
      files.push({
        path: rel,
        exists: false,
      })
    }
  }

  const manifest: CheckpointManifest = {
    id,
    label: input.label,
    createdAt: new Date().toISOString(),
    files,
  }

  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(manifest, null, 2), "utf8")
  return {
    id: manifest.id,
    label: manifest.label,
    createdAt: manifest.createdAt,
    fileCount: files.length,
  }
}

export async function rollbackCheckpoint(
  rootDir: string,
  checkpointId: string,
): Promise<{ id: string; restoredFiles: string[]; removedFiles: string[] }> {
  const file = path.join(getCheckpointsDir(rootDir), `${path.basename(checkpointId)}.json`)
  const raw = await fs.readFile(file, "utf8")
  const manifest = JSON.parse(raw) as CheckpointManifest

  const restoredFiles: string[] = []
  const removedFiles: string[] = []

  for (const entry of manifest.files) {
    const abs = path.resolve(rootDir, entry.path)
    if (entry.exists && typeof entry.contentBase64 === "string") {
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, Buffer.from(entry.contentBase64, "base64"))
      restoredFiles.push(entry.path)
    } else if (!entry.exists) {
      await fs.rm(abs, { force: true })
      removedFiles.push(entry.path)
    }
  }

  return { id: manifest.id, restoredFiles, removedFiles }
}

export async function listCheckpoints(
  rootDir: string,
): Promise<Array<{ id: string; label: string; createdAt: string; fileCount: number }>> {
  try {
    const dir = getCheckpointsDir(rootDir)
    const entries = await fs.readdir(dir)
    const results = []
    for (const name of entries) {
      if (!name.endsWith(".json")) continue
      try {
        const raw = await fs.readFile(path.join(dir, name), "utf8")
        const parsed = JSON.parse(raw) as CheckpointManifest
        results.push({
          id: parsed.id,
          label: parsed.label,
          createdAt: parsed.createdAt,
          fileCount: parsed.files.length,
        })
      } catch {
        // ignore malformed checkpoint
      }
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

export function registerCheckpointTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "checkpoints",
    description:
      "Zero-Git-Noise Time-Travel Checkpoints for snapshotting and rolling back file sets before risky refactors.",
  })

  editor.add({
    name: "create",
    description: "Capture a time-travel snapshot of the specified file paths before a risky multi-file edit or refactor.",
    options: { namespace: "checkpoints", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Optional checkpoint ID" },
        label: { type: "string", description: "Human-readable description of the checkpoint" },
        paths: { type: "array", items: { type: "string" }, description: "File paths to snapshot" },
      },
      required: ["label", "paths"],
    },
    output: { type: "object" },
    execute: async (input: { id?: string; label: string; paths: string[] }) => {
      const res = await createCheckpoint(rootDir, input)
      return { output: res, content: `Created checkpoint [${res.id}] (${res.fileCount} files): ${res.label}` }
    },
  })

  editor.add({
    name: "rollback",
    description: "Restore all files in a checkpoint to their exact pre-refactor state.",
    options: { namespace: "checkpoints", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        checkpointId: { type: "string", description: "Checkpoint ID to restore" },
      },
      required: ["checkpointId"],
    },
    output: { type: "object" },
    execute: async (input: { checkpointId: string }) => {
      const res = await rollbackCheckpoint(rootDir, input.checkpointId)
      return {
        output: res,
        content: `Rolled back to checkpoint [${res.id}]: restored ${res.restoredFiles.length} file(s), removed ${res.removedFiles.length} file(s).`,
      }
    },
  })

  editor.add({
    name: "list",
    description: "List all available time-travel checkpoints in `.opencode/checkpoints/`.",
    options: { namespace: "checkpoints", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const list = await listCheckpoints(rootDir)
      return { output: { checkpoints: list }, content: JSON.stringify(list, null, 2) }
    },
  })
}
