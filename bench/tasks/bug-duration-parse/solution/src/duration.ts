const UNIT_MS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000 }

export function parseDuration(input: string): number {
  if (!/^(?:\d+[hms])+$/.test(input)) throw new RangeError(`Invalid duration: "${input}"`)
  let total = 0
  for (const m of input.matchAll(/(\d+)([hms])/g)) total += Number(m[1]) * UNIT_MS[m[2]]
  return total
}
