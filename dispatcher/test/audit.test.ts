import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLog, auditFile, createEntry } from "../src/audit.js";

async function freshDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agency-audit-"));
}

describe("audit", () => {
  test("append and verify round-trip", async () => {
    const dir = await freshDir();
    const log = await AuditLog.open(dir);
    await log.append("mission.created", { missionId: "m-1" }, "tester");
    await log.append("task.started", { taskId: "t-1" });
    expect((await log.verify()).ok).toBe(true);
    const anchor = log.anchor();
    expect(anchor.seq).toBe(2);
    await log.close();
    const reopened = await AuditLog.open(dir);
    expect(reopened.anchor()).toEqual(anchor);
    expect((await reopened.verify()).ok).toBe(true);
    await reopened.close();
  });

  test("an edit to a middle line is reported with its line number", async () => {
    const dir = await freshDir();
    const log = await AuditLog.open(dir);
    await log.append("one");
    await log.append("two");
    await log.append("three");
    const raw = await readFile(auditFile(dir), "utf8");
    const lines = raw.split("\n");
    lines[1] = lines[1]!.replace("two", "two-forged");
    await writeFile(auditFile(dir), lines.join("\n"));
    await log.close();
    await expect(AuditLog.open(dir)).rejects.toThrow(/line 2/);
  });

  test("defect: a rewritten log of equal length is detected", async () => {
    const dir = await freshDir();
    const log = await AuditLog.open(dir);
    await log.append("mission.created", { missionId: "m-1" });
    await log.append("task.started", { taskId: "t-1" });
    const anchor = log.anchor();
    await log.close();
    // Wholesale rewrite: a different but internally valid chain, same length.
    const first = createEntry(
      "0".repeat(64),
      1,
      "mission.created",
      { missionId: "m-1" },
      "dispatcher",
    );
    const second = createEntry(
      first.hash,
      2,
      "task.started",
      { taskId: "t-1-FORGED" },
      "dispatcher",
    );
    await writeFile(auditFile(dir), `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
    const reopened = await AuditLog.open(dir);
    try {
      // The replacement chain verifies on its own: that must not be enough.
      expect((await reopened.verify()).ok).toBe(true);
      expect(reopened.checkAnchor(anchor)).toBe(false);
      expect(reopened.anchor().hash).not.toBe(anchor.hash);
    } finally {
      await reopened.close();
    }
  });

  test("append never changes earlier bytes", async () => {
    const dir = await freshDir();
    const log = await AuditLog.open(dir);
    await log.append("one", { n: 1 });
    const before = await readFile(auditFile(dir));
    await log.append("two", { n: 2 });
    await log.append("three", { n: 3 });
    const after = await readFile(auditFile(dir));
    expect(after.subarray(0, before.length).equals(before)).toBe(true);
    expect(after.length).toBeGreaterThan(before.length);
    await log.close();
  });

  test("a second writer is refused", async () => {
    const dir = await freshDir();
    const log = await AuditLog.open(dir);
    try {
      const probe = Bun.spawnSync(
        ["bun", path.join(import.meta.dir, "support", "lock-probe.ts"), dir],
        {
          env: { ...process.env },
        },
      );
      const out = probe.stdout.toString().trim();
      expect(out.startsWith("LOCKED:")).toBe(true);
      expect(out).toContain("audit.lock");
      expect(probe.exitCode).toBe(3);
    } finally {
      await log.close();
    }
  });

  test("secrets under sensitive keys are redacted before hashing", async () => {
    const dir = await freshDir();
    const log = await AuditLog.open(dir);
    await log.append("task.started", { password: "hunter2", nested: { token: "abc" } });
    const raw = await readFile(auditFile(dir), "utf8");
    expect(raw).not.toContain("hunter2");
    expect(raw).toContain("[redacted]");
    expect((await log.verify()).ok).toBe(true);
    await log.close();
  });

  test("a torn tail refuses to open with the byte offset", async () => {
    const dir = await freshDir();
    const log = await AuditLog.open(dir);
    await log.append("one");
    await log.append("two");
    const full = await readFile(auditFile(dir));
    await log.close();
    const cut = full.subarray(0, full.length - 7);
    await writeFile(auditFile(dir), cut);
    await expect(AuditLog.open(dir)).rejects.toThrow(/torn final line at byte offset/);
  });

  test("audit-repair moves the fragment aside and appends audit.repaired", async () => {
    const dir = await freshDir();
    const log = await AuditLog.open(dir);
    await log.append("one");
    await log.append("two");
    const full = await readFile(auditFile(dir));
    await log.close();
    await writeFile(auditFile(dir), full.subarray(0, full.length - 7));
    const proc = Bun.spawnSync(
      ["bun", path.join(import.meta.dir, "..", "..", "scripts", "audit-repair.ts"), dir],
      { env: { ...process.env } },
    );
    expect(proc.exitCode).toBe(0);
    const reopened = await AuditLog.open(dir);
    try {
      expect((await reopened.verify()).ok).toBe(true);
      expect(reopened.list().at(-1)!.event).toBe("audit.repaired");
    } finally {
      await reopened.close();
    }
  });
});
