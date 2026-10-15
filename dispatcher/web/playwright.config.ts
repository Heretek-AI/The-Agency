import { defineConfig } from "@playwright/test";

// The backing server is started by scripts/accept/1e/*.sh (or by hand
// with `bun scripts/accept/1e/test-server.ts`) so specs stay hermetic
// and serial against one seeded engine.
const BASE_URL = process.env["ACCEPT_1E_URL"] ?? "http://127.0.0.1:4101";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
