/**
 * Local verifier fake for engine tests: runs `run-checks.ts` in the
 * given directory (a temporary repository) instead of calling the
 * verifier service. Anything the engine asserts about verification
 * therefore exercises the real check runner.
 */
import { baseEnv, runChecks, NoChecksError } from "../../../verifier/src/run-checks.js";
import type { Verifier, VerifyRequest, VerifyResponse } from "../../src/verify.js";

export interface LocalVerifierOptions {
  artifactsDir: string;
  env?: Record<string, string | undefined>;
}

export function localVerifier(options: LocalVerifierOptions): Verifier {
  return {
    run: async (req: VerifyRequest): Promise<VerifyResponse> => {
      try {
        const result = await runChecks({
          dir: req.dir,
          setup: req.setup,
          checks: req.checks,
          artifactsDir: `${options.artifactsDir}/${req.taskId}`,
          env: options.env ?? { ...baseEnv(), CI: "1" },
        });
        return { ok: result.ok, reason: result.reason, setup: result.setup, checks: result.checks };
      } catch (err) {
        if (err instanceof NoChecksError) return { ok: false, reason: "no-checks", checks: [] };
        throw err;
      }
    },
  };
}
