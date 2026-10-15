import { execFile } from "node:child_process"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const VISUAL_QUALITY_CHECKLIST = {
  macroBalance: [
    "Balanced vertical & horizontal visual weight across the viewport (not top-heavy or clipped).",
    "Zero unanchored dead voids on desktop or mobile viewports.",
    "Zero unintended horizontal or vertical page overflow.",
  ],
  alignmentHarmony: [
    "Unified alignment axes across sibling cards, toolbar actions, and form controls.",
    "Consistent baseline alignment and uniform internal padding across sibling containers.",
  ],
  spatialHierarchy: [
    "Macro-whitespace (between sections) is visibly larger than micro-whitespace (inside cards/badges).",
    "Zero text or control collisions (`overlapX === 0 && overlapY === 0`).",
  ],
  typographyAndContrast: [
    "Body text meets WCAG >= 4.5:1 contrast; large/bold headings meet >= 3.0:1 contrast.",
    "Line height >= 1.15x font size on clipped containers so descenders (g, y, p, q) never clip.",
    "Numeric columns use `font-variant-numeric: tabular-nums` and right alignment.",
  ],
}

export async function captureDesktopWindow(
  rootDir: string,
  outputName: string = "desktop_gui_preview.png",
): Promise<{ path: string; method: string }> {
  const previewDir = path.join(rootDir, ".opencode", "artifacts", "previews")
  await fs.mkdir(previewDir, { recursive: true })
  const outPath = path.join(previewDir, path.basename(outputName))

  const platform = process.platform
  if (platform === "darwin") {
    await execFileAsync("screencapture", ["-x", outPath], { cwd: rootDir, timeout: 10000 })
    return { path: outPath, method: "macos-screencapture" }
  }

  // Linux X11 / Wayland fallbacks
  const commands: Array<{ bin: string; args: string[]; method: string }> = [
    { bin: "grim", args: [outPath], method: "wayland-grim" },
    { bin: "scrot", args: ["-o", outPath], method: "x11-scrot" },
    { bin: "import", args: ["-window", "root", outPath], method: "imagemagick-import" },
  ]

  for (const cmd of commands) {
    try {
      await execFileAsync(cmd.bin, cmd.args, { cwd: rootDir, timeout: 10000 })
      return { path: outPath, method: cmd.method }
    } catch {
      // try next capture utility
    }
  }

  throw new Error(
    "No desktop window capture utility found (tried screencapture, grim, scrot, import). For web/Electron/Tauri GUIs, use `tools.browser.screenshot`.",
  )
}

export function registerGuiStudioTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "gui",
    description:
      "Web & Native Desktop GUI Studio tools for capturing live application windows and running the 4-Pillar Visual Quality Checklist.",
  })

  editor.add({
    name: "get_visual_checklist",
    description:
      "Return the 4-Pillar Universal Visual Quality Checklist (Macro Balance, Alignment Axes, Spatial Hierarchy, Typography & Contrast) used to critique GUI screenshots.",
    options: { namespace: "gui", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => ({
      output: VISUAL_QUALITY_CHECKLIST,
      content: JSON.stringify(VISUAL_QUALITY_CHECKLIST, null, 2),
    }),
  })

  editor.add({
    name: "capture_desktop",
    description:
      "Capture a screenshot of the active native desktop GUI window (macOS `screencapture`, Wayland `grim`, X11 `scrot`/`import`) to `.opencode/artifacts/previews/` so you can inspect it multimodally via `read`.",
    options: { namespace: "gui", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Output PNG filename (default 'desktop_gui_preview.png')" },
      },
    },
    output: { type: "object" },
    execute: async (input: { filename?: string }) => {
      const res = await captureDesktopWindow(rootDir, input?.filename ?? "desktop_gui_preview.png")
      return {
        output: res,
        content: `Captured desktop GUI screenshot (${res.method}) -> ${res.path}. Call \`read\` on this path to visually inspect the GUI.`,
      }
    },
  })
}
