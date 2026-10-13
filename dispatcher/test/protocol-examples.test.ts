import { describe, expect, test } from "bun:test";
import { extractBlock } from "../src/protocol.js";

describe("protocol examples in FLEET_PROTOCOL.md parse", () => {
  test("RESULT and VERDICT examples extract and validate", async () => {
    const file = Bun.file(new URL("../../shared/FLEET_PROTOCOL.md", import.meta.url));
    const text = await file.text();
    const result = extractBlock(text, "RESULT");
    expect(result.ok).toBe(true);
    const verdict = extractBlock(text, "VERDICT");
    expect(verdict.ok).toBe(true);
  });
});
