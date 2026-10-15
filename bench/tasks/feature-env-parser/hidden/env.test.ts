import { expect, it } from "bun:test"
import { loadConfig } from "../src/config.ts"
import { parseEnv } from "../src/env.ts"

it("parses the supported forms", () => {
  const env = parseEnv(
    [
      "# comment",
      "",
      "A=plain value  # trailing",
      "export B=exported",
      "C='single # kept $literal'",
      'D="line1\\nline2\\t\\"q\\" \\\\"',
      "A=override",
      "EMPTY=",
    ].join("\n"),
  )
  expect(env).toEqual({
    A: "override",
    B: "exported",
    C: "single # kept $literal",
    D: 'line1\nline2\t"q" \\',
    EMPTY: "",
  })
})

it("reports the failing line number", () => {
  expect(() => parseEnv("OK=1\n9BAD=2")).toThrow(SyntaxError)
  expect(() => parseEnv("OK=1\n\nnot a pair")).toThrow("line 3")
})

it("config uses the parser", () => {
  expect(loadConfig('HOST="db.local"\nPORT=8080 # main\n')).toEqual({ port: 8080, host: "db.local" })
})
