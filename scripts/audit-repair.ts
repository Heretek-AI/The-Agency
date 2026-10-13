/** Human-run repair for a torn audit log tail. Not part of any service. */
import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLog, TornLogError, auditFile } from "../dispatcher/src/audit.js";

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: bun scripts/audit-repair.ts <audit-dir>");
    process.exit(2);
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(auditFile(dir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      console.log("audit-repair: no audit file; nothing to do");
      return;
    }
    throw err;
  }
  const complete = bytes.length > 0 && bytes[bytes.length - 1] === 0x0a;
  if (complete) {
    try {
      const log = await AuditLog.open(dir);
      const result = await log.verify();
      await log.close();
      console.log(
        result.ok ? "audit-repair: log is clean; nothing to do" : `audit-repair: ${result.reason}`,
      );
      if (!result.ok) process.exit(1);
      return;
    } catch (err) {
      if (!(err instanceof TornLogError)) throw err;
    }
  }
  const offset = complete ? 0 : bytes.lastIndexOf(0x0a) + 1;
  const fragment = bytes.subarray(offset);
  const scratch = await mkdtemp(path.join(tmpdir(), "audit-repair-"));
  const aside = path.join(scratch, `audit.jsonl.torn-${Date.now()}`);
  await writeFile(aside, fragment, { mode: 0o600 });
  await writeFile(auditFile(dir), bytes.subarray(0, offset));
  const log = await AuditLog.open(dir);
  try {
    await log.append("audit.repaired", {
      tornOffset: offset,
      fragmentBytes: fragment.length,
      fragmentPath: aside,
    });
  } finally {
    await log.close();
  }
  // Keep the fragment next to the log for inspection.
  const kept = path.join(dir, path.basename(aside));
  await rename(aside, kept);
  console.log(`audit-repair: moved ${fragment.length} torn byte(s) at offset ${offset} to ${kept}`);
}

await main();
