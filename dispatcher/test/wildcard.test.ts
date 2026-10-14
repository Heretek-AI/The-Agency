/**
 * Wildcard dialect tests (shared context 9.5). The `match` cases port the
 * upstream usage in `review/opencode/packages/core/test/
 * shell-parse-syntax.test.ts` (a scanned command matches its own `... *`
 * save pattern) plus the dialect rules `*` crosses `/`, `?` is one char,
 * regex metacharacters are literal, backslashes normalize, and a trailing
 * ` *` also matches the bare prefix.
 */
import { describe, expect, test } from "bun:test";
import { literalPrefix, match, mayOverlap } from "../src/wildcard.js";

describe("wildcard", () => {
  test("upstream: a command matches its own save pattern", () => {
    expect(match("& $Command value", "& $Command *")).toBe(true);
    expect(match("git push origin main", "git push*")).toBe(true);
    expect(match("git push", "git push*")).toBe(true);
    expect(match("git status", "git push*")).toBe(false);
  });

  test("* matches any characters including /", () => {
    expect(match("src/a/b/c.ts", "src/*")).toBe(true);
    expect(match("src/a.ts", "src/*.ts")).toBe(true);
    expect(match("other/a.ts", "src/*")).toBe(false);
  });

  test("? matches exactly one character", () => {
    expect(match("src/ab.ts", "src/??.ts")).toBe(true);
    expect(match("src/a.ts", "src/??.ts")).toBe(false);
    expect(match("src/abc.ts", "src/??.ts")).toBe(false);
  });

  test("regex metacharacters in the pattern are literal", () => {
    expect(match("src/a.ts", "src/a.ts")).toBe(true);
    expect(match("src/aXts", "src/a.ts")).toBe(false);
    expect(match("src/a+ts", "src/a+.ts")).toBe(false);
    expect(match("src/a+.ts", "src/a+.ts")).toBe(true);
    expect(match("README.md", "README*")).toBe(true);
  });

  test("backslashes normalize to forward slashes", () => {
    expect(match("src\\a\\b.ts", "src/*")).toBe(true);
    expect(match("src/a/b.ts", "src\\*")).toBe(true);
  });

  test("a trailing ' *' also matches the bare prefix", () => {
    expect(match("/artifacts/t1", "/artifacts/*")).toBe(true);
    expect(match("/artifacts/t1/report.md", "/artifacts/*")).toBe(true);
    expect(match("/other/t1", "/artifacts/*")).toBe(false);
  });

  test("the match is anchored", () => {
    expect(match("src/a.ts", "src/a")).toBe(false);
    expect(match("xsrc/a.ts", "src/*")).toBe(false);
  });

  test("literalPrefix stops at the first wildcard", () => {
    expect(literalPrefix("src/*")).toBe("src/");
    expect(literalPrefix("src/?.ts")).toBe("src/");
    expect(literalPrefix("src/a.ts")).toBe("src/a.ts");
    expect(literalPrefix("*")).toBe("");
  });

  test("mayOverlap is conservative", () => {
    expect(mayOverlap("src/*", "src/a.ts")).toBe(true);
    expect(mayOverlap("src/a.ts", "src/*")).toBe(true);
    expect(mayOverlap("src/*", "tests/*")).toBe(false);
    expect(mayOverlap("*", "anything/at/all")).toBe(true);
    expect(mayOverlap("src-backup/*", "src/*")).toBe(false);
  });
});
