export type Level = "debug" | "info" | "warn" | "error"

export interface Logger {
  lines: string[]
  log(level: Level, msg: string): void
}

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export function createLogger(options: { name: string; level?: Level }): Logger {
  const lines: string[] = []
  const min = ORDER[options.level ?? "info"]
  return {
    lines,
    log(level, msg) {
      if (ORDER[level] < min) return
      lines.push(`[${level.toUpperCase()}] ${options.name}: ${msg}`)
    },
  }
}
