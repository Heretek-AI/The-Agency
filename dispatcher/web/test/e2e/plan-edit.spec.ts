import { expect, test } from "@playwright/test";
import { login, screenshotEvidence } from "./helpers";

test("approver edits a pending plan inline and the server persists it", async ({ page }) => {
  await login(page, "approver");
  await page.goto("/missions/m-wait-2");
  await expect(page.getByTestId("plan-editor")).toBeVisible({ timeout: 15_000 });

  const title = page.getByTestId("plan-title-m-wait-2-ta");
  await expect(title).toBeVisible();
  await title.fill("build alpha revised");
  const paths = page.getByTestId("plan-paths-m-wait-2-ta");
  await paths.fill("src/alpha/*");
  await page.getByTestId("plan-save").click();
  await expect(page.getByText("Plan saved.")).toBeVisible({ timeout: 15_000 });

  // Reload proves persistence: the edited values render again.
  await page.reload();
  await expect(page.getByTestId("plan-title-m-wait-2-ta")).toHaveValue("build alpha revised");
  await expect(page.getByTestId("plan-paths-m-wait-2-ta")).toHaveValue("src/alpha/*");
  await screenshotEvidence(page, "plan-edit-saved");
});
