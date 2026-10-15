import type { Record, Store } from "./store.js"

export interface ImportResult {
  saved: number
  failed: Array<{ index: number; reason: string }>
}

function validate(r: Record): string | undefined {
  if (!r.id) return "missing id"
  if (!Number.isFinite(r.value)) return "value must be a finite number"
  return undefined
}

export async function importBatch(store: Store, records: Record[]): Promise<ImportResult> {
  const result: ImportResult = { saved: 0, failed: [] }
  for (const [index, r] of records.entries()) {
    const reason = validate(r)
    if (reason) {
      result.failed.push({ index, reason })
      continue
    }
    await store.save(r)
    result.saved++
  }
  return result
}
