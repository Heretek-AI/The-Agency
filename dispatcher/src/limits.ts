/**
 * Provider-error classification (Stage 1c, Step 8; spike Q8 shape). A
 * refusal that looks transient is retried with backoff by re-prompting
 * `Continue.` in the same session. A usage-limit refusal pauses every
 * running mission: tasks are left as they are, the mission becomes
 * `paused` with `pausedUntil`, and the Dispatcher probes on a timer
 * (the error shape carries no reset time, so the fallback is
 * treat-repeated-refusals-as-a-limit and probe).
 */
import type { ProviderFailure } from "./runner.js";

/** Pure backoff for `Continue.` retries: 5s, 15s, 45s, capped at 60s. */
export function backoffMs(consecutiveFailures: number): number {
  return Math.min(60_000, 5000 * 3 ** Math.max(0, consecutiveFailures - 1));
}

export type ProviderDisposition = "retry-continue" | "pause-missions" | "fail-task";

export function classifyProviderFailure(
  failure: ProviderFailure,
  consecutive: number,
): ProviderDisposition {
  if (failure.kind === "quota" || failure.status === 429) return "pause-missions";
  if (failure.kind === "auth") return consecutive >= 1 ? "pause-missions" : "fail-task";
  return consecutive >= 2 ? "pause-missions" : "retry-continue";
}
