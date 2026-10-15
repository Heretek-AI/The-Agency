import { expect, it } from "bun:test"
import { paginate } from "../src/paginate.ts"
import { productPage } from "../src/products.ts"

it("returns non-overlapping 1-indexed pages", () => {
  const ids = [1, 2, 3].flatMap((p) => productPage(p).items.map((x) => x.id))
  expect(ids).toEqual(Array.from({ length: 23 }, (_, i) => i + 1))
})

it("reports totalPages exactly", () => {
  expect(paginate([1, 2, 3, 4], 1, 2).totalPages).toBe(2)
  expect(paginate([1, 2, 3, 4, 5], 1, 2).totalPages).toBe(3)
  expect(paginate([], 1, 10).totalPages).toBe(0)
})

it("returns an empty page past the end", () => {
  expect(paginate([1, 2, 3], 3, 2).items).toEqual([])
})
