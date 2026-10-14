/**
 * Dispatcher-side verifier interface (Stage 1c, Step 5). `Verifier.run`
 * is what the engine calls; `HttpVerifier` is the Stage 1
 * implementation. Stage 2b adds a second implementation. Engine tests
 * use `dispatcher/test/support/local-verifier.fake.ts`, which runs
 * `run-checks.ts` in a temporary repository.
 */
import type { CheckDef, CheckResult } from "../../verifier/src/run-checks.js";

export interface VerifyRequest {
  taskId: string;
  /** Worktree directory the checks run in. */
  dir: string;
  setup: string[];
  checks: CheckDef[];
}

export type VerifyReason =
  | "no-checks"
  | "setup"
  | "checks"
  | "unreachable"
  | "busy"
  | "outside-work";

export interface VerifyResponse {
  ok: boolean;
  reason?: VerifyReason;
  setup?: CheckResult;
  checks: CheckResult[];
}

export interface Verifier {
  run(req: VerifyRequest): Promise<VerifyResponse>;
}

export class VerifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifierError";
  }
}

export class HttpVerifier implements Verifier {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async run(req: VerifyRequest): Promise<VerifyResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          taskId: req.taskId,
          dir: req.dir,
          setup: req.setup,
          checks: req.checks,
        }),
      });
    } catch (err) {
      throw new VerifierError(`verifier unreachable: ${(err as Error).message}`);
    }
    if (res.status === 401) throw new VerifierError("verifier refused the token (401)");
    if (res.status === 503) return { ok: false, reason: "busy", checks: [] };
    let parsed: unknown;
    try {
      parsed = (await res.json()) as unknown;
    } catch {
      throw new VerifierError(`verifier returned non-JSON (status ${res.status})`);
    }
    const body = parsed as {
      ok?: unknown;
      reason?: VerifyReason;
      setup?: CheckResult;
      checks?: CheckResult[];
    };
    if (typeof body.ok !== "boolean" || !Array.isArray(body.checks))
      throw new VerifierError("verifier returned a malformed result");
    if (!res.ok && res.status !== 403 && res.status !== 400)
      throw new VerifierError(`verifier failed with status ${res.status}`);
    return { ok: body.ok, reason: body.reason, setup: body.setup, checks: body.checks };
  }
}
