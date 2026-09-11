import { expect, test } from "@playwright/test";

test("first gesture unlocks same-origin court audio and pause stops it", async ({ page }) => {
  await page.goto("/?qa=game");
  const game = page.getByTestId("game-screen");
  await expect(game).toHaveAttribute("data-audio-unlocked", "false");
  await expect(game).toHaveAttribute("data-audio-ambient-requested", "true");

  await page.getByTestId("action-tactic").click();
  await expect(game).toHaveAttribute("data-audio-unlocked", "true");
  await expect(game).toHaveAttribute("data-audio-ready", "true");
  await expect(game).toHaveAttribute("data-audio-error", "");
  await expect(game).toHaveAttribute("data-audio-ambient-playing", "true");

  await page.getByTestId("open-pause").click();
  await expect(game).toHaveAttribute("data-audio-ambient-requested", "false");
  await expect(game).toHaveAttribute("data-audio-ambient-playing", "false");

  await page.getByTestId("pause-resume").click();
  await expect(game).toHaveAttribute("data-audio-ambient-requested", "true");
  await expect(game).toHaveAttribute("data-audio-ambient-playing", "true");
});

test("dead ball, inbound preparation and automatic free throws request no ambience", async ({ page }) => {
  for (const fixture of ["made", "out", "free-throw"]) {
    await page.goto(`/?qa=${fixture}`);
    await expect(page.getByTestId("game-screen")).toHaveAttribute("data-audio-ambient-requested", "false");
  }
});

test("shows a safe silent fallback after a transient audio failure and retries on a later gesture", async ({ page }) => {
  let allowAudio = false;
  await page.route("**/assets/audio/court-dribble.mp3", async (route) => {
    if (!allowAudio) await route.fulfill({ status: 503, body: "temporarily unavailable" });
    else await route.continue();
  });

  await page.goto("/?qa=game");
  const game = page.getByTestId("game-screen");
  await page.getByTestId("action-tactic").click();
  await expect(game).toHaveAttribute("data-audio-ready", "false");
  await expect(game).toHaveAttribute("data-audio-error", /再次点击比赛区域可重试/);

  await page.getByTestId("open-pause").click();
  await page.getByRole("tab", { name: "设置" }).click();
  await expect(page.getByTestId("audio-warning")).toContainText("本场已保持静音");

  allowAudio = true;
  await page.getByTestId("pause-resume").click();
  await expect(game).toHaveAttribute("data-audio-ready", "true");
  await expect(game).toHaveAttribute("data-audio-error", "");
});
