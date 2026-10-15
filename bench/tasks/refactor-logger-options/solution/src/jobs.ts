import { createLogger } from "./logger.js"

export const jobLog = createLogger({ name: "jobs", level: "debug" })

export function runJob(id: string): void {
  jobLog.log("debug", `start ${id}`)
  jobLog.log("info", `done ${id}`)
}
