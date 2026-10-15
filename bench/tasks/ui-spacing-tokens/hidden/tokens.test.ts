import { expect, it } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const dir = join(import.meta.dir, "..", "styles")
const tokensCss = readFileSync(join(dir, "tokens.css"), "utf8")
const tokens = Object.fromEntries([...tokensCss.matchAll(/--(space-\d):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]))

function decls(): Array<{ file: string; prop: string; value: string }> {
  return readdirSync(join(dir, "components")).flatMap((file) =>
    [...readFileSync(join(dir, "components", file), "utf8").matchAll(/(padding[\w-]*|margin[\w-]*|gap)\s*:\s*([^;]+);/g)].map(
      (m) => ({ file, prop: m[1], value: m[2].trim() }),
    ),
  )
}

it("leaves tokens.css untouched", () => {
  expect(tokens).toEqual({ "space-1": 4, "space-2": 8, "space-3": 12, "space-4": 16, "space-5": 24, "space-6": 32 })
})

it("uses only tokens (or 0) for spacing", () => {
  for (const d of decls()) {
    for (const part of d.value.split(/\s+/)) {
      expect(part === "0" || /^var\(--space-[1-6]\)$/.test(part)).toBe(true)
    }
  }
})

it("picks the nearest token for each original value", () => {
  // First declaration of each property per file (the component's own rule, not later sub-rules).
  const byKey: Record<string, string> = {}
  for (const d of decls()) byKey[`${d.file}:${d.prop}`] ??= d.value
  expect(byKey["button.css:padding"]).toBe("var(--space-2) var(--space-4)")
  expect(byKey["button.css:margin-left"]).toBe("var(--space-2)")
  expect(byKey["panel.css:padding"].split(/\s+/)[0]).toBe("var(--space-5)")
  expect(byKey["panel.css:margin-bottom"]).toBe("var(--space-6)")
  expect(byKey["panel.css:gap"]).toBe("var(--space-3)")
})
