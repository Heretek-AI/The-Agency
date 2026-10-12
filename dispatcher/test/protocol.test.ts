import { describe, expect, test } from "bun:test";
import { extractBlock } from "../src/protocol.js";

const RESULT = `## RESULT
\`\`\`json
{
  "status": "done",
  "summary": "Added the endpoint with a test.",
  "changes": [{ "commit": "abc123", "files": ["src/health.ts"] }],
  "verification": [{ "command": "bun test", "exit": 0, "observed": "12 passed" }],
  "assumptions": [],
  "risks": [],
  "handoffs": [],
  "artifacts": ["/artifacts/t-1/report.md"],
  "question": null
}
\`\`\``;

const VERDICT_PASS = `## VERDICT
\`\`\`json
{
  "decision": "pass",
  "findings": [{ "severity": "minor", "where": "src/a.ts:1", "what": "typo in comment" }],
  "evidence": [{ "command": "bun test", "exit": 0, "observed": "12 passed" }]
}
\`\`\``;

describe("protocol", () => {
  test("a valid result parses with its raw text", () => {
    const out = extractBlock(`some chatter\n${RESULT}\n`, "RESULT");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value).toMatchObject({ status: "done" });
      expect(out.raw).toContain('"status": "done"');
    }
  });

  test("a valid verdict parses", () => {
    const out = extractBlock(VERDICT_PASS, "VERDICT");
    expect(out.ok).toBe(true);
  });

  test("a block after earlier code fences in a long message parses", () => {
    const text = [
      "tried this:",
      "```js",
      "const x = { not: 'json' };",
      "```",
      "more talk with ``` inline fences ```",
      RESULT,
    ].join("\n");
    const out = extractBlock(text, "RESULT");
    expect(out.ok).toBe(true);
  });

  test("two headings: the last wins", () => {
    const first = RESULT.replace('"status": "done"', '"status": "needs-handoff"').replace(
      '"handoffs": []',
      '"handoffs": [{"expert": "dba", "request": "add index"}]',
    );
    const out = extractBlock(`${first}\n\n${RESULT}`, "RESULT");
    expect(out.ok).toBe(true);
    if (out.ok && out.value && "status" in out.value) expect(out.value.status).toBe("done");
  });

  test("a pass with a blocker is invalid", () => {
    const verdict = VERDICT_PASS.replace('"decision": "pass"', '"decision": "pass"').replace(
      '"severity": "minor"',
      '"severity": "blocker"',
    );
    const out = extractBlock(verdict, "VERDICT");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("blocker");
    expect(out.raw.length).toBeGreaterThan(0);
  });

  test("fail with only minor findings is invalid", () => {
    const verdict = VERDICT_PASS.replace('"decision": "pass"', '"decision": "fail"');
    const out = extractBlock(verdict, "VERDICT");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("blocker or major");
  });

  test("blocked without a question is invalid", () => {
    const blocked = RESULT.replace('"status": "done"', '"status": "blocked"');
    const out = extractBlock(blocked, "RESULT");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("question");
  });

  test("missing heading returns the full text as raw", () => {
    const out = extractBlock("no blocks here", "RESULT");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toContain("missing RESULT heading");
      expect(out.raw).toBe("no blocks here");
    }
  });

  test("malformed JSON is reported with the raw block", () => {
    const out = extractBlock("## RESULT\n```json\n{nope\n```\n", "RESULT");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toContain("malformed JSON");
      expect(out.raw).toContain("{nope");
    }
  });

  test("a RESULT heading does not satisfy a VERDICT extraction", () => {
    const out = extractBlock(RESULT, "VERDICT");
    expect(out.ok).toBe(false);
  });
});
