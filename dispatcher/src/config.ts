/** Typed environment access. This is the only module under
 * `dispatcher/src` or `verifier/src` that may read `process.env`
 * (enforced by the `lint` target in the Makefile).
 *
 * `baseEnv()` returns only `PATH` and `LANG` for callers to extend
 * deliberately; every child process receives an explicit environment.
 */

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`refusing to start: ${name} is empty or unset`);
  }
  return value;
}

export function optionalEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

/** Minimal explicit environment: only PATH and LANG, nothing else. */
export function baseEnv(): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    LANG: process.env["LANG"] ?? "C.UTF-8",
  };
}
