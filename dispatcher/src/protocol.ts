import { z } from "zod";

/**
 * RESULT and VERDICT blocks (shared context 9.7, 9.8). One schema, used
 * everywhere; the salvaged pair of incompatible judge-report shapes is gone.
 *
 * Rules:
 * - Find the last `## RESULT` or `## VERDICT` heading in the final message
 *   and parse the first fenced JSON block after it. Always keep the raw text.
 * - A `pass` that contains a `blocker` finding is invalid. A `fail` with no
 *   `blocker` or `major` finding is invalid.
 * - `blocked` without a `question` is invalid.
 * - A missing, unparseable, or invalid block gets one automatic follow-up;
 *   a second failure fails the task with reason `no-block` (Stage 1c).
 */

export const ResultBlockSchema = z.object({
  status: z.enum(["done", "blocked", "needs-handoff", "needs-split"]),
  summary: z.string().min(1),
  changes: z.array(z.object({ commit: z.string().min(1), files: z.array(z.string()) })),
  verification: z.array(
    z.object({ command: z.string().min(1), exit: z.number().int(), observed: z.string() }),
  ),
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
  handoffs: z.array(z.object({ expert: z.string().min(1), request: z.string().min(1) })),
  artifacts: z.array(z.string()),
  question: z.string().nullable(),
});

export const VerdictBlockSchema = z.object({
  decision: z.enum(["pass", "fail"]),
  findings: z.array(
    z.object({
      severity: z.enum(["blocker", "major", "minor"]),
      where: z.string().min(1),
      what: z.string().min(1),
    }),
  ),
  evidence: z.array(
    z.object({
      command: z.string().min(1),
      exit: z.number().int(),
      observed: z.string(),
      artifact: z.string().optional(),
    }),
  ),
});

export type ResultBlock = z.infer<typeof ResultBlockSchema>;
export type VerdictBlock = z.infer<typeof VerdictBlockSchema>;

export type BlockKind = "RESULT" | "VERDICT";

export type ExtractedBlock =
  | { ok: true; value: ResultBlock | VerdictBlock; raw: string }
  | { ok: false; reason: string; raw: string };

const HEADING = /^##\s+(RESULT|VERDICT)\s*$/m;
const FENCE = /```(?:json)?\s*\n([\s\S]*?)```/;

function checkResult(value: ResultBlock): string | null {
  if (value.status === "blocked" && (value.question === null || value.question.trim() === "")) {
    return "blocked without a question";
  }
  return null;
}

function checkVerdict(value: VerdictBlock): string | null {
  const blockers = value.findings.filter((f) => f.severity === "blocker");
  const majors = value.findings.filter((f) => f.severity === "major");
  if (value.decision === "pass" && blockers.length > 0) return "a pass with a blocker is invalid";
  if (value.decision === "fail" && blockers.length + majors.length === 0) {
    return "a fail with no blocker or major finding is invalid";
  }
  return null;
}

/**
 * Extract and validate the last RESULT or VERDICT block. `raw` is always
 * returned: the fenced JSON text when a block is found, else the full input.
 */
export function extractBlock(text: string, kind: BlockKind): ExtractedBlock {
  const wanted = kind === "RESULT" ? "RESULT" : "VERDICT";
  const matches = [...text.matchAll(new RegExp(HEADING.source, "gm"))].filter(
    (m) => m[1] === wanted,
  );
  if (matches.length === 0) return { ok: false, reason: `missing ${wanted} heading`, raw: text };
  const last = matches[matches.length - 1]!;
  const after = text.slice((last.index ?? 0) + last[0].length);
  const fence = after.match(FENCE);
  if (!fence || fence[1] === undefined)
    return { ok: false, reason: `no fenced JSON block after ${wanted}`, raw: text };
  const raw = fence[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `malformed JSON after ${wanted}`, raw };
  }
  if (kind === "RESULT") {
    const result = ResultBlockSchema.safeParse(parsed);
    if (!result.success)
      return { ok: false, reason: `invalid RESULT: ${result.error.issues[0]?.message}`, raw };
    const problem = checkResult(result.data);
    if (problem) return { ok: false, reason: problem, raw };
    return { ok: true, value: result.data, raw };
  }
  const verdict = VerdictBlockSchema.safeParse(parsed);
  if (!verdict.success)
    return { ok: false, reason: `invalid VERDICT: ${verdict.error.issues[0]?.message}`, raw };
  const problem = checkVerdict(verdict.data);
  if (problem) return { ok: false, reason: problem, raw };
  return { ok: true, value: verdict.data, raw };
}
