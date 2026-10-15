import { expect, it } from "bun:test"
import { importBatch } from "../src/importer.ts"
import { Store } from "../src/store.ts"

it("saves every valid record in order before resolving", async () => {
  const store = new Store()
  const records = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, value: i }))
  const res = await importBatch(store, records)
  expect(res).toEqual({ saved: 8, failed: [] })
  expect(store.rows.map((r) => r.id)).toEqual(records.map((r) => r.id))
})

it("reports invalid records with their index", async () => {
  const store = new Store()
  const res = await importBatch(store, [
    { id: "a", value: 1 },
    { id: "", value: 2 },
    { id: "c", value: Number.NaN },
  ])
  expect(res.saved).toBe(1)
  expect(res.failed).toEqual([
    { index: 1, reason: "missing id" },
    { index: 2, reason: "value must be a finite number" },
  ])
})
