import { expect, it } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { getUserHandler } from "../src/api/handlers.ts"
import { isAdmin } from "../src/auth.ts"
import { displayName } from "../src/profile.ts"
import * as repo from "../src/users/repo.ts"

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

it("exposes findUser returning undefined for unknown ids", () => {
  expect((repo as any).findUser(1).name).toBe("Ada")
  expect((repo as any).findUser(99)).toBeUndefined()
})

it("keeps a throwing deprecated alias", () => {
  expect(repo.getUserById(2).name).toBe("Linus")
  expect(() => repo.getUserById(99)).toThrow("User 99 not found")
})

it("keeps caller behaviour", () => {
  expect(isAdmin(1)).toBe(true)
  expect(isAdmin(99)).toBe(false)
  expect(displayName(2)).toBe("LINUS")
  expect(() => displayName(99)).toThrow("User 99 not found")
  expect(getUserHandler(1).status).toBe(200)
  expect(getUserHandler(99)).toEqual({ status: 404, body: { error: "not found" } })
})

it("no other file references getUserById", () => {
  const offenders = walk(join(import.meta.dir, "..", "src"))
    .filter((f) => !f.endsWith(join("users", "repo.ts")))
    .filter((f) => readFileSync(f, "utf8").includes("getUserById"))
  expect(offenders).toEqual([])
})
