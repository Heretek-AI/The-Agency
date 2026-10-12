import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { open } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { GENESIS_HASH, canonicalJson, chainHash, sha256Hex } from "./util/hash.js";
import { redactJson } from "./util/redact.js";

/**
 * Tamper-evident audit log (shared context 9.12). One JSON object per line:
 * `{ seq, at, actor, event, data, prevHash, hash }` where
 * `hash = sha256(prevHash + ":" + canonicalJson({ seq, at, actor, event, data }))`.
 *
 * - The Dispatcher is the only writer. `open` takes an exclusive lock file;
 *   a second opener fails naming the lock holder.
 * - `append` writes one line with `O_APPEND` and `fsync`. Earlier bytes are
 *   never rewritten or truncated through this handle.
 * - `open` verifies the whole chain and fails closed on a torn final line
 *   (partial write after a crash), reporting the byte offset. A human runs
 *   `scripts/audit-repair.ts` to move the fragment aside.
 * - `anchor` / `checkAnchor` detect a wholesale rewrite: a replacement chain
 *   that merely verifies still fails the anchor check. Describe this log as
 *   tamper-evident, not tamper-proof: the git-anchored tip hashes in landing
 *   commits are what expose a rewritten file.
 */

export interface JournalEntry {
  readonly seq: number;
  readonly at: string;
  readonly actor: string;
  readonly event: string;
  readonly data?: unknown;
  readonly prevHash: string;
  readonly hash: string;
}

export interface VerifyResult {
  readonly ok: boolean;
  /** 1-based line number of the first bad entry, when !ok. */
  readonly badLine?: number;
  readonly reason?: string;
}

export interface Anchor {
  readonly seq: number;
  readonly hash: string;
}

export class TornLogError extends Error {
  readonly offset: number;
  constructor(offset: number) {
    super(`audit log has a torn final line at byte offset ${offset}; run scripts/audit-repair.ts`);
    this.name = "TornLogError";
    this.offset = offset;
  }
}

export class LockedError extends Error {
  constructor(dir: string, holder: string) {
    super(`audit log at ${dir} is locked by ${holder}`);
    this.name = "LockedError";
  }
}

export function entryHash(e: Omit<JournalEntry, "hash">): string {
  return chainHash(e.prevHash, {
    seq: e.seq,
    at: e.at,
    actor: e.actor,
    event: e.event,
    data: e.data,
  });
}

/** Build one entry. `data` is redacted before hashing. Exported for tests. */
export function createEntry(
  prevHash: string,
  seq: number,
  event: string,
  data: unknown,
  actor: string,
): JournalEntry {
  const entry: JournalEntry = {
    seq,
    at: new Date().toISOString(),
    actor,
    event,
    data: data === undefined ? undefined : redactJson(data),
    prevHash,
    hash: "",
  };
  return { ...entry, hash: entryHash(entry) };
}

export function parseJournalLine(line: string): JournalEntry {
  const raw = JSON.parse(line) as JournalEntry;
  if (
    typeof raw.seq !== "number" ||
    typeof raw.at !== "string" ||
    typeof raw.actor !== "string" ||
    typeof raw.event !== "string" ||
    typeof raw.prevHash !== "string" ||
    typeof raw.hash !== "string"
  ) {
    throw new Error("malformed journal entry");
  }
  return raw;
}

/** Verify a parsed entry sequence: ordering, linkage, and hashes. */
export function verifyEntries(entries: JournalEntry[]): VerifyResult {
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.seq !== i + 1)
      return { ok: false, badLine: i + 1, reason: `bad seq ${e.seq}, want ${i + 1}` };
    if (e.prevHash !== prev) return { ok: false, badLine: i + 1, reason: "prevHash mismatch" };
    if (e.hash !== entryHash(e)) return { ok: false, badLine: i + 1, reason: "hash mismatch" };
    prev = e.hash;
  }
  return { ok: true };
}

export const auditFile = (dir: string): string => path.join(dir, "audit.jsonl");
export const lockFile = (dir: string): string => path.join(dir, "audit.lock");

interface ParsedLog {
  entries: JournalEntry[];
}

/** Read and validate the raw bytes: torn tail fails closed with its offset. */
async function readLog(dir: string): Promise<ParsedLog> {
  let bytes: Buffer;
  try {
    bytes = await readFile(auditFile(dir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { entries: [] };
    throw err;
  }
  if (bytes.length === 0) return { entries: [] };
  if (bytes[bytes.length - 1] !== 0x0a) {
    throw new TornLogError(bytes.lastIndexOf(0x0a) + 1);
  }
  const text = bytes.toString("utf8");
  const lines = text.split("\n");
  lines.pop();
  const entries: JournalEntry[] = [];
  let offset = 0;
  for (const line of lines) {
    if (line.length === 0) {
      offset += 1;
      continue;
    }
    let entry: JournalEntry;
    try {
      entry = parseJournalLine(line);
    } catch {
      throw new TornLogError(offset);
    }
    entries.push(entry);
    offset += Buffer.byteLength(line, "utf8") + 1;
  }
  const check = verifyEntries(entries);
  if (!check.ok) {
    throw new Error(`audit log corrupt at line ${check.badLine}: ${check.reason}`);
  }
  void sha256Hex(canonicalJson({ verified: entries.length }));
  return { entries };
}

export class AuditLog {
  private entries: JournalEntry[];
  private readonly dir: string;
  private closed = false;

  private constructor(dir: string, entries: JournalEntry[]) {
    this.dir = dir;
    this.entries = entries;
  }

  /** Take the lock, verify the chain, and return a handle. */
  static async open(dir: string): Promise<AuditLog> {
    await mkdir(dir, { recursive: true });
    const holder = JSON.stringify({
      pid: process.pid,
      host: hostname(),
      at: new Date().toISOString(),
    });
    try {
      await writeFile(lockFile(dir), `${holder}\n`, { flag: "wx", mode: 0o600 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
        let existing = "(unreadable)";
        try {
          existing = (await readFile(lockFile(dir), "utf8")).trim();
        } catch {
          // keep the fallback text
        }
        throw new LockedError(dir, `${existing} (${lockFile(dir)})`);
      }
      throw err;
    }
    try {
      const { entries } = await readLog(dir);
      return new AuditLog(dir, entries);
    } catch (err) {
      await rm(lockFile(dir), { force: true });
      throw err;
    }
  }

  get length(): number {
    return this.entries.length;
  }

  get tipHash(): string {
    return this.entries.length === 0 ? GENESIS_HASH : this.entries[this.entries.length - 1]!.hash;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("AuditLog is closed");
  }

  /** Append one event: single O_APPEND write, then fsync. Never rewrites. */
  async append(event: string, data?: unknown, actor = "dispatcher"): Promise<JournalEntry> {
    this.assertOpen();
    const entry = createEntry(this.tipHash, this.entries.length + 1, event, data, actor);
    const handle = await open(auditFile(this.dir), "a", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.entries.push(entry);
    return entry;
  }

  /** Re-read the file and verify the whole chain. */
  async verify(): Promise<VerifyResult> {
    this.assertOpen();
    try {
      const { entries } = await readLog(this.dir);
      this.entries = entries;
      return { ok: true };
    } catch (err) {
      if (err instanceof TornLogError) {
        return { ok: false, reason: `torn tail at byte offset ${err.offset}` };
      }
      throw err;
    }
  }

  anchor(): Anchor {
    return { seq: this.entries.length, hash: this.tipHash };
  }

  /**
   * True only if the log holds `anchor.hash` at sequence `anchor.seq`.
   * A wholesale rewrite with a different but valid chain of the same length
   * still returns false: verifying is not enough, the anchor must match.
   */
  checkAnchor(anchor: Anchor): boolean {
    if (anchor.seq === 0) return anchor.hash === GENESIS_HASH && this.entries.length === 0;
    if (anchor.seq < 0 || anchor.seq > this.entries.length) return false;
    return this.entries[anchor.seq - 1]!.hash === anchor.hash;
  }

  list(): JournalEntry[] {
    return [...this.entries];
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      await rm(lockFile(this.dir), { force: true });
    }
  }
}
