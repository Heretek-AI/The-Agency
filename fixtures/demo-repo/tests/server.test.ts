import { describe, expect, test } from "bun:test";
import { createResponse } from "../src/server.js";

function get(path: string): Response {
  return createResponse(new Request(`http://127.0.0.1${path}`));
}

describe("demo service", () => {
  test("/health reports ok", async () => {
    const response = get("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("/hello greets by name", async () => {
    const response = get("/hello?name=agency");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ greeting: "hello, agency" });
  });

  test("unknown paths 404", () => {
    expect(get("/missing").status).toBe(404);
  });
});
