import { expect, test } from "@playwright/test";
import { login, screenshotEvidence } from "./helpers";

test("pipeline chips and the diff viewer render with readable contrast", async ({ page }) => {
  await login(page, "viewer");
  await page.goto("/missions/m-diff");
  await expect(page.getByTestId("mission-title")).toHaveText("m-diff");

  await expect(page.getByTestId("pipeline-task-m-diff-t1")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTestId("tab-diff").click();
  await expect(page.getByTestId("diff-viewer-m-diff-t1")).toBeVisible();
  const stats = await page.getByTestId("diff-stats").innerText();
  expect(stats).toContain("+");

  // Added lines use the high-contrast diff palette, never a neon wash.
  const added = page.getByTestId("diff-added").first();
  await expect(added).toBeVisible();
  const colors = await added.evaluate((el) => {
    const style = getComputedStyle(el);
    return { bg: style.backgroundColor, fg: style.color };
  });
  expect(colors.bg).toBe("rgb(3, 58, 22)");
  expect(colors.fg).toBe("rgb(126, 231, 135)");

  // No horizontal page overflow at desktop width.
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);

  // Split mode renders the same change side by side.
  await page.getByTestId("diff-mode-split").click();
  await expect(page.getByTestId("diff-split")).toBeVisible();
  await screenshotEvidence(page, "pipeline-diff-readable");
});
