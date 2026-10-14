import { z } from "zod";

/**
 * Role-based authentication for the Dispatcher control plane (Stage 1d).
 * Accounts live in `state/registry/allowlist.yaml` with argon2-hashed
 * passwords. Logins yield opaque session tokens presented either as the
 * `agency_session` cookie or an `Authorization: Bearer` header.
 *
 * Roles: `viewer` reads; `approver` also approves, rejects, cancels,
 * edits waiting plans, and decides; `admin` also runs GC and manages
 * lifecycle and settings.
 */

export const RoleSchema = z.enum(["viewer", "approver", "admin"]);
export type Role = z.infer<typeof RoleSchema>;

const ROLE_RANK: Record<Role, number> = { viewer: 0, approver: 1, admin: 2 };

export function roleAtLeast(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

const AllowlistUserSchema = z
  .object({
    username: z.string().min(1),
    role: RoleSchema,
    passwordHash: z.string().min(1),
  })
  .strict();

const AllowlistSchema = z
  .object({
    version: z.literal(1),
    users: z.array(AllowlistUserSchema).min(1),
  })
  .strict();

export interface Account {
  username: string;
  role: Role;
  passwordHash: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Load accounts from the allowlist file. Fails closed: a missing file,
 * invalid YAML, a schema violation, a duplicate username, or a hash that
 * is not argon2 all throw.
 */
export async function loadAllowlist(allowlistPath: string): Promise<Map<string, Account>> {
  let text: string;
  try {
    text = await Bun.file(allowlistPath).text();
  } catch {
    throw new AuthError(`refusing to start: cannot read allowlist at ${allowlistPath}`);
  }
  const { parse: parseYaml } = await import("yaml");
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    throw new AuthError(
      `refusing to start: invalid YAML in allowlist at ${allowlistPath}: ${(err as Error).message}`,
    );
  }
  const result = AllowlistSchema.safeParse(parsed);
  if (!result.success)
    throw new AuthError(
      `refusing to start: invalid allowlist at ${allowlistPath}: ${result.error.issues[0]?.message}`,
    );
  const accounts = new Map<string, Account>();
  for (const user of result.data.users) {
    if (accounts.has(user.username))
      throw new AuthError(
        `refusing to start: duplicate username ${JSON.stringify(user.username)} in allowlist`,
      );
    if (!user.passwordHash.startsWith("$argon2"))
      throw new AuthError(
        `refusing to start: password hash for ${JSON.stringify(user.username)} is not argon2`,
      );
    accounts.set(user.username, {
      username: user.username,
      role: user.role,
      passwordHash: user.passwordHash,
    });
  }
  return accounts;
}

/** Argon2 verification. A wrong password returns false, never throws. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (password === "") return false;
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

export interface Session {
  token: string;
  username: string;
  role: Role;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** In-process session tokens. The map is the authority; expiry is checked on lookup. */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly ttlMs: number = SESSION_TTL_MS) {}

  issue(account: Pick<Account, "username" | "role">, now: number = Date.now()): Session {
    const session: Session = {
      token: `${crypto.randomUUID()}.${crypto.randomUUID()}`,
      username: account.username,
      role: account.role,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.sessions.set(session.token, session);
    return session;
  }

  lookup(token: string, now: number = Date.now()): Session | undefined {
    const session = this.sessions.get(token);
    if (session === undefined) return undefined;
    if (now >= session.expiresAt) {
      this.sessions.delete(token);
      return undefined;
    }
    return session;
  }

  revoke(token: string): boolean {
    return this.sessions.delete(token);
  }

  size(): number {
    return this.sessions.size;
  }
}

export const SESSION_COOKIE = "agency_session";

/** Bearer token from `Authorization`, if the header carries one. */
export function bearerToken(headers: Headers): string | undefined {
  const header = headers.get("authorization");
  if (header === null) return undefined;
  const match = /^Bearer (.+)$/.exec(header.trim());
  const token = match?.[1]?.trim();
  return token !== undefined && token !== "" ? token : undefined;
}

/** Session token from the `Cookie` header, if present. */
export function cookieToken(headers: Headers): string | undefined {
  const header = headers.get("cookie");
  if (header === null) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = part.slice(eq + 1).trim();
      if (value !== "") return value;
    }
  }
  return undefined;
}

/** Either presentation of the session token; Bearer wins when both arrive. */
export function sessionTokenFrom(headers: Headers): string | undefined {
  return bearerToken(headers) ?? cookieToken(headers);
}

export function sessionCookieHeader(token: string, secure: boolean = false): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
