import { expect, test } from "@playwright/test";
import { login, screenshotEvidence } from "./helpers";

test.use({ viewport: { width: 375, height: 667 } });

test("mobile parity: dock, chat, and approval work at 375px", async ({ page }) => {
  await login(page, "approver");

  // Sidebar collapses to a slide-over; the bottom dock carries navigation.
  await expect(page.getByTestId("mobile-dock")).toBeVisible();
  await expect(page.getByTestId("mobile-menu")).toBeVisible();
  await page.getByTestId("mobile-menu").click();
  await expect(page.getByTestId("mobile-sidebar")).toBeVisible();
  await page.getByTestId("mobile-sidebar").getByTestId("nav-missions").click();
  await expect(page.getByTestId("missions-kanban")).toBeVisible({ timeout: 15_000 });

  // Chat stays usable on the small viewport.
  await page.goto("/missions/m-chat");
  await page.getByTestId("chat-input").fill("hello-director-mobile");
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-transcript").getByText("hello-director-mobile")).toBeVisible({
    timeout: 20_000,
  });

  // Approval actions are reachable without clipping.
  await page.goto("/missions/m-wait-3");
  await expect(page.getByTestId("detail-approve")).toBeVisible();
  await page.getByTestId("detail-approve").click();
  await expect(page.getByText("Approved; mission is running.")).toBeVisible({
    timeout: 15_000,
  });
  await screenshotEvidence(page, "mobile-375-approved");
});
