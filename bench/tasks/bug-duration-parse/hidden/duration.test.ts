import { expect, it } from "bun:test"
import { parseDuration } from "../src/duration.ts"
import { requestTimeout } from "../src/timeout.ts"

it("parses combined units", () => {
  expect(parseDuration("1h30m")).toBe(5_400_000)
  expect(parseDuration("1h5m10s")).toBe(3_910_000)
  expect(parseDuration("2h")).toBe(7_200_000)
  expect(parseDuration("90m")).toBe(5_400_000)
  expect(parseDuration("45s")).toBe(45_000)
  expect(requestTimeout({})).toBe(30_000)
})

it("rejects invalid input", () => {
  for (const bad of ["", "5x", "h", "1h junk", "10", "-5s"]) {
    expect(() => parseDuration(bad)).toThrow(RangeError)
  }
})
