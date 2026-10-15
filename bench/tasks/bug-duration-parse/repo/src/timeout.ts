import { parseDuration } from "./duration.js"

export function requestTimeout(config: { timeout?: string }): number {
  return parseDuration(config.timeout ?? "30s")
}
