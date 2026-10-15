import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("axe audit reports zero violations on every primary view", async ({ page }) => {
  await login(page, "admin");
  const routes = ["/", "/missions", "/missions/m-chat", "/fleet", "/audit", "/settings"];
  for (const route of routes) {
    await page.goto(route);
    await page.waitForTimeout(1500);
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations,
      `axe violations on ${route}: ${JSON.stringify(results.violations.map((v) => v.id))}`,
    ).toEqual([]);
  }
});
