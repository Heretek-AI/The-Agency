export type Level = "debug" | "info" | "warn" | "error"

export interface Logger {
  lines: string[]
  log(level: Level, msg: string): void
}

export function createLogger(name: string): Logger {
  const lines: string[] = []
  return {
    lines,
    log(level, msg) {
      lines.push(`[${level.toUpperCase()}] ${name}: ${msg}`)
    },
  }
}
