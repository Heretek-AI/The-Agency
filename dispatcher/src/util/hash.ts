import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** sha256 of a UTF-8 string, hex-encoded. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** sha256 of a file's bytes, hex-encoded. */
export async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

/** Stable JSON encoding: sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

/** sha256 of the canonical JSON form of a value. */
export function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Next link in a prev-hash chain: hash(prevHash + canonical(entry)). */
export function chainHash(prevHash: string, entry: unknown): string {
  return sha256Hex(`${prevHash}:${canonicalJson(entry)}`);
}

/** Zero hash: the prevHash of the first journal entry. */
export const GENESIS_HASH = "0".repeat(64);
