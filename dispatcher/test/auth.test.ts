import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearedSessionCookieHeader,
  cookieToken,
  bearerToken,
  loadAllowlist,
  roleAtLeast,
  sessionCookieHeader,
  sessionTokenFrom,
  SessionStore,
  verifyPassword,
  SESSION_COOKIE,
} from "../src/auth.js";

async function writeAllowlist(
  users: { username: string; role: string; hash: string }[],
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "agency-allow-"));
  const file = join(dir, "allowlist.yaml");
  const body = [
    "version: 1",
    "users:",
    ...users.map(
      (u) => `  - username: ${u.username}\n    role: ${u.role}\n    passwordHash: '${u.hash}'`,
    ),
  ].join("\n");
  writeFileSync(file, `${body}\n`);
  return file;
}

describe("allowlist", () => {
  test("a valid file loads three seeded roles", async () => {
    const admin = await Bun.password.hash("s3cret-admin", { algorithm: "argon2id" });
    const approver = await Bun.password.hash("s3cret-approver", { algorithm: "argon2id" });
    const viewer = await Bun.password.hash("s3cret-viewer", { algorithm: "argon2id" });
    const file = await writeAllowlist([
      { username: "admin", role: "admin", hash: admin },
      { username: "approver", role: "approver", hash: approver },
      { username: "viewer", role: "viewer", hash: viewer },
    ]);
    const accounts = await loadAllowlist(file);
    expect(accounts.size).toBe(3);
    expect(accounts.get("admin")?.role).toBe("admin");
  });

  test("a missing file refuses with the path", async () => {
    await expect(loadAllowlist("/nonexistent/allowlist.yaml")).rejects.toThrow(
      "/nonexistent/allowlist.yaml",
    );
  });

  test("a duplicate username refuses", async () => {
    const hash = await Bun.password.hash("x", { algorithm: "argon2id" });
    const file = await writeAllowlist([
      { username: "admin", role: "admin", hash },
      { username: "admin", role: "viewer", hash },
    ]);
    await expect(loadAllowlist(file)).rejects.toThrow("duplicate username");
  });

  test("a non-argon2 hash refuses", async () => {
    const file = await writeAllowlist([{ username: "admin", role: "admin", hash: "sha256:abc" }]);
    await expect(loadAllowlist(file)).rejects.toThrow("not argon2");
  });

  test("an unknown role refuses", async () => {
    const hash = await Bun.password.hash("x", { algorithm: "argon2id" });
    const file = await writeAllowlist([{ username: "root", role: "superuser", hash }]);
    await expect(loadAllowlist(file)).rejects.toThrow("allowlist");
  });
});

describe("passwords and sessions", () => {
  test("the right password verifies and the wrong one does not", async () => {
    const hash = await Bun.password.hash("correct", { algorithm: "argon2id" });
    expect(await verifyPassword("correct", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  test("sessions issue, look up, expire, and revoke", () => {
    const store = new SessionStore(1000);
    const session = store.issue({ username: "viewer", role: "viewer" }, 10_000);
    expect(store.lookup(session.token, 10_500)?.username).toBe("viewer");
    expect(store.lookup(session.token, 11_000)).toBeUndefined();
    const second = store.issue({ username: "admin", role: "admin" });
    expect(store.revoke(second.token)).toBe(true);
    expect(store.lookup(second.token)).toBeUndefined();
    expect(store.lookup("no-such-token")).toBeUndefined();
  });

  test("role ranks order viewer below approver below admin", () => {
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
    expect(roleAtLeast("viewer", "approver")).toBe(false);
    expect(roleAtLeast("approver", "approver")).toBe(true);
    expect(roleAtLeast("approver", "admin")).toBe(false);
    expect(roleAtLeast("admin", "admin")).toBe(true);
  });

  test("tokens arrive by Bearer header or session cookie", () => {
    const byBearer = new Headers({ authorization: "Bearer abc.def" });
    expect(bearerToken(byBearer)).toBe("abc.def");
    expect(sessionTokenFrom(byBearer)).toBe("abc.def");
    const byCookie = new Headers({ cookie: `other=1; ${SESSION_COOKIE}=cookie-token` });
    expect(cookieToken(byCookie)).toBe("cookie-token");
    expect(sessionTokenFrom(byCookie)).toBe("cookie-token");
    const both = new Headers({
      authorization: "Bearer bearer-wins",
      cookie: `${SESSION_COOKIE}=cookie-loses`,
    });
    expect(sessionTokenFrom(both)).toBe("bearer-wins");
    expect(sessionTokenFrom(new Headers())).toBeUndefined();
  });

  test("cookie headers set and clear the session", () => {
    expect(sessionCookieHeader("tok")).toContain(`${SESSION_COOKIE}=tok`);
    expect(sessionCookieHeader("tok")).toContain("HttpOnly");
    expect(clearedSessionCookieHeader()).toContain("Max-Age=0");
  });
});
