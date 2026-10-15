import { expect, test } from "@playwright/test";
import { login, screenshotEvidence } from "./helpers";

const CORE_12 = [
  "director",
  "scout",
  "architect",
  "product",
  "frontend",
  "backend",
  "dba",
  "platform",
  "security",
  "qa",
  "reviewer",
  "docs",
];

test("fleet view renders the core experts with live health", async ({ page }) => {
  await login(page, "viewer");
  await page.goto("/fleet");
  await expect(page.getByTestId("fleet-grid")).toBeVisible({ timeout: 15_000 });
  for (const name of CORE_12) {
    await expect(page.getByTestId(`expert-card-${name}`)).toBeVisible();
  }
  const pulse = await page.getByTestId("fleet-pulse").innerText();
  expect(pulse).toMatch(/Fleet \d+\/\d+/);
  await screenshotEvidence(page, "fleet-core-12");
});

test("ctrl+k opens the command palette for keyboard navigation", async ({ page }) => {
  await login(page, "viewer");
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("command-palette-input").fill("m-chat");
  await expect(page.getByTestId("command-palette").getByText(/m-chat/)).toBeVisible();
});
