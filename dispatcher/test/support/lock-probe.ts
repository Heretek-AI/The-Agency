/** Spawned by audit.test.ts: tries to open a log dir and reports the outcome. */
import { AuditLog } from "../../src/audit.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: bun lock-probe.ts <audit-dir>");
  process.exit(2);
}
try {
  const log = await AuditLog.open(dir);
  console.log("OPENED");
  await log.close();
} catch (err) {
  console.log(`LOCKED: ${(err as Error).message}`);
  process.exit(3);
}
