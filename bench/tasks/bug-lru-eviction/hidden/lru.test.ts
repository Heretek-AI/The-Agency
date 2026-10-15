import { expect, it } from "bun:test"
import { LRUCache } from "../src/cache/lru.ts"
import { SessionService } from "../src/session-service.ts"

it("evicts the least recently used entry", () => {
  const c = new LRUCache<string, number>(3)
  c.set("a", 1)
  c.set("b", 2)
  c.set("c", 3)
  c.set("d", 4)
  expect([..."abcd"].filter((k) => c.has(k))).toEqual(["b", "c", "d"])
  expect(c.size).toBe(3)
})

it("treats get() as a use", () => {
  const c = new LRUCache<string, number>(3)
  c.set("a", 1)
  c.set("b", 2)
  c.set("c", 3)
  expect(c.get("a")).toBe(1)
  c.set("d", 4)
  expect([..."abcd"].filter((k) => c.has(k))).toEqual(["a", "c", "d"])
})

it("keeps active sessions logged in", () => {
  const svc = new SessionService(3)
  svc.login("alice")
  svc.login("bob")
  svc.login("dave")
  svc.touch("alice")
  svc.login("carol")
  expect(svc.isLoggedIn("alice")).toBe(true)
  expect(svc.isLoggedIn("bob")).toBe(false)
  expect(svc.isLoggedIn("dave")).toBe(true)
  expect(svc.isLoggedIn("carol")).toBe(true)
})
