import type { Page } from "@playwright/test";

export async function login(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("login-username").fill(username);
  await page.getByTestId("login-password").fill(`pw-${username}`);
  await page.getByTestId("login-submit").click();
  await page.getByTestId("role-badge").waitFor({ timeout: 15_000 });
}

export async function screenshotEvidence(page: Page, name: string): Promise<void> {
  // Playwright runs with cwd dispatcher/web (see scripts/accept/1e/*.sh),
  // so two levels up is the repository root.
  await page.screenshot({
    path: `../../docs/evidence/1e/${name}.png`,
  });
}
