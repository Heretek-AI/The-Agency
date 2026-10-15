import { expect, it } from "bun:test"
import { slugify } from "../src/slugify.ts"

it("lowercases, strips accents and collapses separators", () => {
  expect(slugify("Hello World")).toBe("hello-world")
  expect(slugify("Crème Brûlée")).toBe("creme-brulee")
  expect(slugify("  --A__B!!c  ")).toBe("a-b-c")
})

it("supports custom separators and ampersands", () => {
  expect(slugify("Rock & Roll", { separator: "_" })).toBe("rock_and_roll")
  expect(slugify("R&D")).toBe("r-and-d")
})

it("truncates on word boundaries without trailing separators", () => {
  expect(slugify("the quick brown fox", { maxLength: 12 })).toBe("the-quick")
  expect(slugify("the quick brown fox", { maxLength: 15 })).toBe("the-quick-brown")
  expect(slugify("supercalifragilistic", { maxLength: 5 })).toBe("super")
})

it("throws on empty slugs", () => {
  expect(() => slugify("!!!")).toThrow(TypeError)
  expect(() => slugify("")).toThrow("empty slug")
})
