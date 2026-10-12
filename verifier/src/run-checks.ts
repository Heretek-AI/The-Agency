import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { baseEnv } from "../../dispatcher/src/config.js";
import { execShell } from "../../dispatcher/src/util/exec.js";
import { sha256Hex } from "../../dispatcher/src/util/hash.js";
import { redactSecrets } from "../../dispatcher/src/util/redact.js";

/**
 * Non-LLM check runner: runs a repository's declared checks and reports
 * every result. There is no default check list and no budget gate.
 *
 * - A missing or empty `checks` list throws `NoChecksError`; callers map it
 *   to the reason `no-checks`, and nothing lands.
 * - `setup` commands run in order; the first failure ends the run with
 *   reason `setup`. Then every check runs, even after one fails, so the
 *   result lists them all.
 * - Each command runs through `execCmd` with the caller's explicit `env`.
 * - Full output goes to `<artifactsDir>/verify/<id>.log`. The result carries
 *   per check: `id`, `exit`, `durationMs`, `timedOut`, `logPath`,
 *   `outputHash`, and a redacted excerpt.
 */

export class NoChecksError extends Error {
  constructor() {
    super("no checks declared: refusing to verify (reason no-checks)");
    this.name = "NoChecksError";
  }
}

export interface CheckDef {
  readonly id: string;
  readonly run: string;
  readonly timeoutSec: number;
}

export interface RunChecksInput {
  readonly dir: string;
  readonly setup: string[];
  readonly checks: CheckDef[];
  readonly artifactsDir: string;
  readonly env: Record<string, string | undefined>;
}

export interface CheckResult {
  readonly id: string;
  readonly exit: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly logPath: string;
  readonly outputHash: string;
  readonly excerpt: string;
}

export interface RunChecksResult {
  readonly ok: boolean;
  /** `setup` when a setup command failed; `checks` when any check failed. */
  readonly reason?: "setup" | "checks";
  readonly setup?: CheckResult;
  readonly checks: CheckResult[];
}

async function runOne(
  dir: string,
  artifactsDir: string,
  env: Record<string, string | undefined>,
  id: string,
  cmd: string,
  timeoutSec: number,
): Promise<CheckResult> {
  const res = await execShell(cmd, { cwd: dir, env, timeoutMs: timeoutSec * 1000 });
  const combined = `${res.stdout}\n${res.stderr}`;
  const redacted = redactSecrets(combined);
  const logPath = path.join(artifactsDir, "verify", `${id}.log`);
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, redacted, "utf8");
  return {
    id,
    exit: res.timedOut ? 124 : res.exit,
    durationMs: res.durationMs,
    timedOut: res.timedOut,
    logPath,
    outputHash: `sha256:${sha256Hex(redacted)}`,
    excerpt: redacted.slice(0, 1000),
  };
}

export async function runChecks(input: RunChecksInput): Promise<RunChecksResult> {
  if (input.checks === undefined || input.checks.length === 0) throw new NoChecksError();
  for (const [i, cmd] of input.setup.entries()) {
    const setup = await runOne(input.dir, input.artifactsDir, input.env, `setup-${i}`, cmd, 300);
    if (setup.exit !== 0) return { ok: false, reason: "setup", setup, checks: [] };
  }
  const checks: CheckResult[] = [];
  for (const def of input.checks) {
    checks.push(
      await runOne(input.dir, input.artifactsDir, input.env, def.id, def.run, def.timeoutSec),
    );
  }
  const failed = checks.some((c) => c.exit !== 0);
  return failed ? { ok: false, reason: "checks", checks } : { ok: true, checks };
}

/** Base environment for checks to extend with their task variables. */
export { baseEnv };
