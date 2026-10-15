import { expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { inviteAdmin } from "../src/admin.ts"
import { signupHandler } from "../src/handlers.ts"
import * as validation from "../src/validation.ts"

const src = (f: string) => readFileSync(join(import.meta.dir, "..", "src", f), "utf8")

it("exports helpers from validation.ts", () => {
  expect(validation.isEmail("a@b.co")).toBe(true)
  expect(validation.isStrongPassword("Password123")).toBe(true)
  expect(validation.validateSignup({ email: "nope", password: "short" })).toEqual(["invalid email", "weak password"])
})

it("handlers and admin no longer define their own helpers", () => {
  expect(src("handlers.ts")).not.toMatch(/function\s+(isEmail|isStrongPassword|validateSignup)\b/)
  expect(src("admin.ts")).not.toMatch(/function\s+isEmail\b/)
  expect(src("handlers.ts")).toContain("validation")
  expect(src("admin.ts")).toContain("validation")
})

it("keeps behaviour", () => {
  expect(signupHandler({ email: "x@y.io", password: "Sup3rStrongPw" })).toEqual({ status: 201, errors: [] })
  expect(signupHandler({ email: "bad", password: "Sup3rStrongPw" })).toEqual({ status: 400, errors: ["invalid email"] })
  expect(inviteAdmin("Boss@Corp.io")).toEqual({ ok: true, email: "boss@corp.io" })
  expect(inviteAdmin("nope")).toEqual({ ok: false, error: "invalid email" })
})
