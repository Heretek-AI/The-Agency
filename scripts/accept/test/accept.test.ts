import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.join(import.meta.dir, "..", "..", "..");
const ACCEPT_SH = path.join(REPO, "scripts", "accept.sh");
const LIB_SH = path.join(REPO, "scripts", "accept", "lib.sh");

interface RunResult {
  code: number;
  out: string;
}

function makeScript(kind: string, stage: string, name: string): string {
  const id = `${stage}/${name.replace(/\.sh$/, "")}`;
  switch (kind) {
    case "pass":
      return `#!/usr/bin/env bash\nsource "${LIB_SH}"\npass\n`;
    case "fail":
      return `#!/usr/bin/env bash\nsource "${LIB_SH}"\nfail "boom"\n`;
    case "skip":
      return `#!/usr/bin/env bash\nsource "${LIB_SH}"\nskip "later"\n`;
    case "mismatch":
      return `#!/usr/bin/env bash\necho "CHECK ${id}: PASS"\nexit 1\n`;
    case "silent":
      return `#!/usr/bin/env bash\nexit 0\n`;
    case "sleep":
      return `#!/usr/bin/env bash\nsleep 30\n`;
    default:
      throw new Error(`unknown fixture kind ${kind}`);
  }
}

function setupStage(specs: Record<string, string>, stage: string): { root: string; ev: string } {
  const root = mkdtempSync(path.join(tmpdir(), "accept-root-"));
  const ev = mkdtempSync(path.join(tmpdir(), "accept-ev-"));
  const dir = path.join(root, stage);
  mkdirSync(dir, { recursive: true });
  for (const [name, kind] of Object.entries(specs)) {
    const p = path.join(dir, name);
    writeFileSync(p, makeScript(kind, stage, name));
    chmodSync(p, 0o755);
  }
  return { root, ev };
}

function runAccept(stage: string, root: string, ev: string, timeoutS = "120"): RunResult {
  const proc = Bun.spawnSync(["bash", ACCEPT_SH, stage], {
    cwd: REPO,
    env: {
      ...process.env,
      ACCEPT_ROOT: root,
      EVIDENCE_ROOT: ev,
      ACCEPT_TIMEOUT: timeoutS,
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    },
  });
  const out = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
  return { code: proc.exitCode, out };
}

function logOf(ev: string, stage: string): string {
  const files = readdirSync(path.join(ev, stage)).filter((f) => f.startsWith("accept-"));
  expect(files.length).toBe(1);
  return readFileSync(path.join(ev, stage, files[0]!), "utf8");
}

describe("accept.sh", () => {
  test("all pass exits 0 with a full-pass table", () => {
    const { root, ev } = setupStage({ "01-a.sh": "pass", "02-b.sh": "pass" }, "fx-pass");
    const { code, out } = runAccept("fx-pass", root, ev);
    expect(code).toBe(0);
    expect(out).toContain("fx-pass/01-a");
    expect(out).toContain("2 pass, 0 skip, 0 fail");
    expect(logOf(ev, "fx-pass")).toContain("CHECK fx-pass/01-a: PASS");
  });

  test("one fail exits 1", () => {
    const { root, ev } = setupStage({ "01-a.sh": "pass", "02-b.sh": "fail" }, "fx-fail");
    const { code, out } = runAccept("fx-fail", root, ev);
    expect(code).toBe(1);
    expect(out).toContain("1 pass, 0 skip, 1 fail");
    expect(logOf(ev, "fx-fail")).toContain("CHECK fx-fail/02-b: FAIL boom");
  });

  test("pass plus skip exits 77", () => {
    const { root, ev } = setupStage({ "01-a.sh": "pass", "02-b.sh": "skip" }, "fx-skip");
    const { code, out } = runAccept("fx-skip", root, ev);
    expect(code).toBe(77);
    expect(out).toContain("1 pass, 1 skip, 0 fail");
  });

  test("fail plus skip exits 1, not 77", () => {
    const { root, ev } = setupStage({ "01-a.sh": "fail", "02-b.sh": "skip" }, "fx-failskip");
    const { code } = runAccept("fx-failskip", root, ev);
    expect(code).toBe(1);
  });

  test("PASS printed with exit 1 is a failure", () => {
    const { root, ev } = setupStage({ "01-bad.sh": "mismatch" }, "fx-mismatch");
    const { code, out } = runAccept("fx-mismatch", root, ev);
    expect(code).toBe(1);
    expect(out).toContain("result/exit mismatch");
  });

  test("exit 0 without a result line is a failure", () => {
    const { root, ev } = setupStage({ "01-quiet.sh": "silent" }, "fx-quiet");
    const { code, out } = runAccept("fx-quiet", root, ev);
    expect(code).toBe(1);
    expect(out).toContain("no result line");
  });

  test("an empty stage directory is a failure", () => {
    const { root, ev } = setupStage({}, "fx-empty");
    const { code } = runAccept("fx-empty", root, ev);
    expect(code).toBe(1);
  });

  test("a check past the timeout is a failure", () => {
    const { root, ev } = setupStage({ "01-slow.sh": "sleep" }, "fx-slow");
    const { code, out } = runAccept("fx-slow", root, ev, "1");
    expect(code).toBe(1);
    expect(out).toContain("timeout");
  });
});
