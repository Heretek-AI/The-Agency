import { createLogger } from "./logger.js"

export const httpLog = createLogger({ name: "http", level: "warn" })

export function handle(path: string): number {
  httpLog.log("info", `GET ${path}`)
  if (path === "/boom") {
    httpLog.log("error", "handler crashed")
    return 500
  }
  return 200
}
