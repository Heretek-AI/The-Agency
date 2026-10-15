import { expect, test } from "@playwright/test";
import { login, screenshotEvidence } from "./helpers";

test("director chat sends a message and streams the SSE reply in place", async ({ page }) => {
  await login(page, "viewer");
  await page.goto("/missions/m-chat");
  await expect(page.getByTestId("mission-title")).toHaveText("m-chat");

  const marker = `hello-director-${Date.now()}`;
  await page.getByTestId("chat-input").fill(marker);
  await page.getByTestId("chat-send").click();

  // The user's own message renders from the transcript poll.
  await expect(page.getByTestId("chat-transcript").getByText(marker)).toBeVisible({
    timeout: 20_000,
  });
  // The scripted director reply arrives over SSE without a reload.
  await expect(
    page
      .getByTestId("chat-transcript")
      .getByText(/Director acknowledges hello-director/)
      .first(),
  ).toBeVisible({ timeout: 20_000 });

  // The SSE endpoint itself streams transcript frames: open a raw
  // EventSource in page context and assert the director reply arrives
  // as a `message` event. The endpoint replays the tail on connect,
  // so this holds even though the reply already rendered above.
  const streamed = await page.evaluate(async (missionId: string) => {
    const frames: string[] = [];
    const source = new EventSource(`/api/missions/${missionId}/chat/events`);
    try {
      await new Promise<void>((resolve, reject) => {
        const done = setTimeout(() => reject(new Error("sse timeout")), 15_000);
        source.addEventListener("message", (event) => {
          frames.push((event as MessageEvent).data);
          if (frames.some((f) => f.includes("Director acknowledges"))) {
            clearTimeout(done);
            resolve();
          }
        });
      });
    } finally {
      source.close();
    }
    return frames;
  }, "m-chat");
  expect(streamed.some((f) => f.includes("Director acknowledges"))).toBe(true);

  // The task graph tab reflects the live mission without a refresh.
  await page.getByTestId("tab-graph").click();
  await expect(page.getByTestId("task-graph")).toBeVisible();
  await expect(page.getByTestId("task-graph").getByText(/m-chat-t1/)).toBeVisible();
  await screenshotEvidence(page, "director-chat-streaming");
});
