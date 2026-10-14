/**
 * Read-only audit-chain check for acceptance scripts. Usage:
 *   bun scripts/accept-helpers/audit-chain.ts <audit-dir> [expected-tip]
 *
 * Verifies the JSONL chain (ordering, linkage, hashes; torn tail fails
 * closed) and, when a tip is given, requires it to equal some entry hash.
 * Prints `<entries> entries, tip <hash>` and exits 0 only when everything
 * holds. Takes no lock and writes nothing.
 */
import { readFile } from "node:fs/promises";
import { auditFile, parseJournalLine, verifyEntries } from "../../dispatcher/src/audit.js";

const dir = process.argv[2];
if (dir === undefined || dir === "") {
  console.error("usage: audit-chain.ts <audit-dir> [expected-tip]");
  process.exit(1);
}
const expectedTip = process.argv[3];

let bytes: Buffer;
try {
  bytes = await readFile(auditFile(dir));
} catch {
  console.error(`no audit log at ${auditFile(dir)}`);
  process.exit(1);
}
if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) {
  console.error("torn or empty audit log");
  process.exit(1);
}
const lines = bytes.toString("utf8").split("\n");
lines.pop();
let entries;
try {
  entries = lines.filter((l) => l.length > 0).map((l) => parseJournalLine(l));
} catch {
  console.error("audit log holds a malformed entry");
  process.exit(1);
}
const check = verifyEntries(entries);
if (!check.ok) {
  console.error(`audit chain broken at line ${check.badLine}: ${check.reason}`);
  process.exit(1);
}
if (entries.length === 0) {
  console.error("audit log holds no entries");
  process.exit(1);
}
const tip = entries[entries.length - 1]!.hash;
if (expectedTip !== undefined && !entries.some((e) => e.hash === expectedTip)) {
  console.error(`tip ${expectedTip} is not in the audit chain`);
  process.exit(1);
}
console.log(`${entries.length} entries, tip ${tip}`);
