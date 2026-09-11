import { expect, test } from "@playwright/test";

test("loads the repository-scoped build with working assets and controls", async ({ page }) => {
  const failedRequests: string[] = [];
  const failedResponses: string[] = [];
  const browserErrors: string[] = [];
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on("pageerror", (error) => {
    browserErrors.push(error.message);
    console.error(`[pageerror] ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    browserErrors.push(message.text());
    console.error(`[console] ${message.text()}`);
  });

  await page.goto("./", { waitUntil: "networkidle" });

  await expect(page).toHaveTitle("我能打职业｜玩家娱乐版开发预览");
  await expect(page.getByTestId("player-creation-screen")).toBeVisible();
  await expect(page.getByText("玩家娱乐版 · 非官方开发预览", { exact: false })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow,noarchive");
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);

  const assetChecks = await page.evaluate(async () => {
    const paths = [
      "assets/game/paper-court.webp",
      "assets/audio/court-dribble.mp3",
      "assets/audio/basket-swish.mp3",
      "assets/iphone/Bezel.png",
      "assets/android/Pixel10.png",
    ];
    return Promise.all(paths.map(async (path) => {
      const response = await fetch(new URL(path, document.baseURI), { cache: "no-store" });
      return { path, status: response.status, contentType: response.headers.get("content-type") ?? "" };
    }));
  });
  expect(assetChecks.every((entry) => entry.status === 200)).toBe(true);

  await page.getByTestId("start-tutorial").click();
  await expect(page.getByTestId("game-screen")).toBeVisible();
  await expect(page.getByTestId("scoreboard")).toContainText("UMich");

  expect(failedRequests).toEqual([]);
  expect(failedResponses).toEqual([]);
  expect(browserErrors).toEqual([]);
});
