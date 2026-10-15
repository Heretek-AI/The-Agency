import { expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = (f: string) => readFileSync(join(import.meta.dir, "..", "styles", f), "utf8")

function rule(text: string, selector: string): Record<string, string> {
  const m = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(text)
  if (!m) throw new Error(`missing rule ${selector}`)
  return Object.fromEntries(
    m[1].split(";").map((d) => d.split(":").map((s) => s.trim())).filter((p) => p.length === 2 && p[0]) as [string, string][],
  )
}

function luminance(hex: string): number {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

it("titles no longer clip descenders", () => {
  const t = rule(css("card.css"), ".card-title")
  expect(Number(t["line-height"])).toBeGreaterThanOrEqual(1.2)
  const clipsByHeight = t.height && t.overflow === "hidden" && parseFloat(t.height) < 22 * 1.2
  expect(Boolean(clipsByHeight)).toBe(false)
})

it("all card text meets WCAG AA against the background", () => {
  const text = css("card.css")
  const bg = rule(text, ".card").background
  expect(bg).toBe("#ffffff")
  for (const sel of [".card-title", ".card-meta", ".card-body"]) {
    expect(contrast(rule(text, sel).color, bg)).toBeGreaterThanOrEqual(4.5)
  }
})

it("keeps font sizes and the grid", () => {
  const text = css("card.css")
  expect(rule(text, ".card-title")["font-size"]).toBe("22px")
  expect(rule(text, ".card-meta")["font-size"]).toBe("13px")
  expect(rule(text, ".card-body")["font-size"]).toBe("15px")
  expect(css("layout.css")).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));")
})
