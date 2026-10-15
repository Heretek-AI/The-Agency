const UNIT_MS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000 }

export function parseDuration(input: string): number {
  let total = 0
  const re = /(\d+)([hms])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    total += Number(m[1]) * (UNIT_MS[m[2]] ?? 0)
    if (m[2] === "h") break
  }
  return total === 0 ? Number(input) * 1000 : total
}
