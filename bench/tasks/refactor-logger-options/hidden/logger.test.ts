import { expect, it } from "bun:test"
import { dbLog, query } from "../src/db.ts"
import { handle, httpLog } from "../src/http.ts"
import { jobLog, runJob } from "../src/jobs.ts"
import { createLogger } from "../src/logger.ts"

it("filters below the configured level and defaults to info", () => {
  const l = (createLogger as any)({ name: "t" })
  l.log("debug", "hidden")
  l.log("info", "shown")
  expect(l.lines).toEqual(["[INFO] t: shown"])
})

it("callers use their configured levels", () => {
  query("SELECT 1")
  query("DROP TABLE x")
  expect(dbLog.lines).toEqual(["[WARN] db: destructive query"])
  handle("/ok")
  handle("/boom")
  expect(httpLog.lines).toEqual(["[ERROR] http: handler crashed"])
  runJob("j1")
  expect(jobLog.lines).toEqual(["[DEBUG] jobs: start j1", "[INFO] jobs: done j1"])
})
