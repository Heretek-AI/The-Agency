import { expect, test } from "@playwright/test";
import { login, screenshotEvidence } from "./helpers";

test("invalid login shows an error and stays on the login view", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("login-username").fill("viewer");
  await page.getByTestId("login-password").fill("wrong-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toBeVisible({ timeout: 15_000 });
});

test("viewer session shows role badge and gates approval actions", async ({ page }) => {
  await login(page, "viewer");
  await expect(page.getByTestId("role-badge")).toHaveText("Viewer");
  await page.goto("/missions/m-wait-1");
  await expect(page.getByTestId("mission-title")).toHaveText("m-wait-1");
  // Viewer sees the approve action only as a disabled, explained gate.
  const gated = page.getByTestId("role-gated");
  await expect(gated.first()).toBeVisible();
  await expect(gated.first()).toHaveAttribute("title", "Approver role required to approve plans");
  await screenshotEvidence(page, "auth-viewer-gated");
});

test("approver approval transitions a waiting mission to running", async ({ page }) => {
  await login(page, "approver");
  await expect(page.getByTestId("role-badge")).toHaveText("Approver");
  await page.goto("/missions/m-wait-1");
  await page.getByTestId("detail-reject-reason").fill("not needed");
  await page.getByTestId("detail-approve").click();
  await expect(page.getByText("Approved; mission is running.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("status-chip").first()).toHaveText(/running/);
  await screenshotEvidence(page, "auth-approver-approved");
});
