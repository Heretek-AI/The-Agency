import { createLogger } from "./logger.js"

export const dbLog = createLogger("db")

export function query(sql: string): number {
  dbLog.log("debug", `query ${sql}`)
  if (sql.includes("DROP")) dbLog.log("warn", "destructive query")
  return sql.length
}
