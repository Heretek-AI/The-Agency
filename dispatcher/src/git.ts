/**
 * Git subprocesses (Stage 1c, Step 4). This is the only module that runs
 * a subprocess: it runs `git` and nothing else, through `execCmd` with
 * an explicit environment. The Dispatcher never executes a repository's
 * own commands; those run in the verifier. (Enforced by check
 * `1c/09-no-task-exec-in-dispatcher`.)
 */
import { baseEnv } from "./config.js";
import { execCmd } from "./util/exec.js";

const TIMEOUT_MS = 60_000;

/** Run `git <args>` in `cwd`. Anything else cannot be expressed here. */
export async function git(cwd: string, args: string[]): Promise<string> {
  const res = await execCmd(["git", ...args], { cwd, env: baseEnv(), timeoutMs: TIMEOUT_MS });
  if (res.exit !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr.trim().slice(0, 500)}`);
  return res.stdout.trim();
}

/** True when `ref` resolves in the repository at `cwd`. */
export async function gitRefExists(cwd: string, ref: string): Promise<boolean> {
  const res = await execCmd(["git", "rev-parse", "--verify", ref], {
    cwd,
    env: baseEnv(),
    timeoutMs: TIMEOUT_MS,
  });
  return res.exit === 0;
}
