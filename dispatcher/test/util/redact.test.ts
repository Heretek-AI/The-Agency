import { describe, expect, test } from "bun:test";
import { REDACTED, redactJson, redactSecrets } from "../../src/util/redact.js";

describe("redact", () => {
  test("redaction covers key names and token shapes", () => {
    expect(redactSecrets("token: abcdefgh")).toContain(REDACTED);
    expect(redactSecrets("token: abcdefgh")).not.toContain("abcdefgh");
    expect(redactSecrets("sk-secret-value-123")).toContain(REDACTED);
    expect(redactSecrets("Bearer abc.DEF_123")).toContain(REDACTED);
    expect(redactSecrets("nothing sensitive here")).toBe("nothing sensitive here");
  });

  test("redaction is idempotent", () => {
    const once = redactSecrets("password= hunter2 and sk-abcdef123456");
    expect(redactSecrets(once)).toBe(once);
  });

  test("redactJson redacts sensitive keys at any depth", () => {
    const out = redactJson({ user: "u", password: "hunter2", nested: { api_key: "k", ok: 1 } });
    expect(out).toEqual({ user: "u", password: REDACTED, nested: { api_key: REDACTED, ok: 1 } });
  });
});
