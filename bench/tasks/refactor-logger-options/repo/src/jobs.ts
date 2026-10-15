import { createLogger } from "./logger.js"

export const jobLog = createLogger("jobs")

export function runJob(id: string): void {
  jobLog.log("debug", `start ${id}`)
  jobLog.log("info", `done ${id}`)
}
