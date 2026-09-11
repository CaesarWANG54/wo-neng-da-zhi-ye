import { expect, test, type Page } from "@playwright/test";

const SAVE_KEY = "wo-neng-da-zhi-ye:career:v1";

async function openCareer(page: Page, end: "win" | "loss" = "win") {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
  await page.goto(`/?qa=career-home&persist=1&careerEnd=${end}`);
  const career = page.getByTestId("career-home-screen");
  try {
    await career.waitFor({ state: "visible", timeout: 8_000 });
  } catch {
    // A saturated Windows loopback stack can occasionally deliver index.html
    // while dropping the first Vite module request. Retry one real navigation;
    // a persistent boot or application failure still fails the second wait.
    await page.reload({ waitUntil: "domcontentloaded" });
    await career.waitFor({ state: "visible", timeout: 15_000 });
  }
}

async function launchNextGame(page: Page) {
  await page.getByTestId("select-next-game").click();
  await expect(page.getByTestId("calendar-selection")).toContainText("2026-10-21");
  await page.getByTestId("play-career-game").click();
  await expect(page.getByRole("dialog", { name: "确认进入比赛" })).toBeVisible();
  await expect(page.getByTestId("career-match-save-warning")).toContainText("终场确认后结算保存");
  await expect(page.getByTestId("career-match-save-warning")).toContainText("刷新或关闭页面会回到赛前存档");
  await page.getByTestId("confirm-career-game").click();
  const game = page.getByTestId("game-screen");
  await expect(game).toHaveAttribute("data-match-mode", "CAREER");
  await expect(game).toHaveAttribute("data-career-game-id", "published-85");
  return game;
}

test("cancels a regular-season game confirmation without mutating the schedule", async ({ page }) => {
  await openCareer(page);
  await page.getByTestId("select-next-game").click();
  await page.getByTestId("play-career-game").click();
  await expect(page.getByRole("dialog", { name: "确认进入比赛" })).toBeVisible();
  await page.getByTestId("cancel-career-game").click();
  await expect(page.getByRole("dialog", { name: "确认进入比赛" })).toHaveCount(0);
  await expect(page.getByTestId("career-home-screen")).toBeVisible();
  await expect(page.getByTestId("play-career-game")).toBeVisible();
  await expect(page.getByTestId("calendar-day-2026-10-21")).not.toContainText(/胜|负/);
});

test("plays a real schedule game, settles once, persists, and returns to its calendar result", async ({ page }) => {
  await openCareer(page, "win");
  const game = await launchNextGame(page);
  await expect(page.getByTestId("scoreboard")).toContainText("老鹰");
  await expect(page.getByTestId("scoreboard")).toContainText("魔术");
  await expect(page.getByText("我方球权", { exact: true })).toBeVisible();
  await expect(page.getByText("主队球权", { exact: true })).toHaveCount(0);
  await expect(game).toHaveAttribute("data-regulation-period-seconds", "120");
  await expect(game).toHaveAttribute("data-overtime-period-seconds", "50");

  await page.clock.runFor(400);
  await expect(page.getByTestId("game-over-dialog")).toBeVisible();
  await expect(page.getByTestId("career-reward-preview")).toContainText("90 金币");
  const settle = page.getByTestId("settle-career-game");
  await settle.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });

  const career = page.getByTestId("career-home-screen");
  await expect(career).toBeVisible();
  await expect(page.getByTestId("career-coins")).toContainText("90");
  await expect(page.getByTestId("career-chemistry")).toContainText("默契11%");
  await expect(page.getByTestId("calendar-day-2026-10-21")).toContainText("胜 61-60");
  await expect(page.getByTestId("career-save-status")).toContainText("+90金币");
  await expect(page.getByTestId("play-career-game")).toHaveCount(0);

  await expect.poll(async () => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const save = JSON.parse(raw);
    const game = save.data.season.games.find((candidate: { id: string }) => candidate.id === "published-85");
    return {
      revision: save.revision,
      status: game?.status,
      result: game?.result,
      coins: save.data.progression.coins,
      mirrorCoins: save.data.season.coins,
      chemistry: save.data.progression.chemistryPercent,
      playerGames: save.data.season.playerStats.games,
      rewardIds: save.data.progression.processedRewardIds,
      outcomeIds: save.data.progression.processedChemistryEventIds,
    };
  }, SAVE_KEY)).toMatchObject({
    status: "FINAL",
    result: { awayScore: 61, homeScore: 60 },
    coins: 90,
    mirrorCoins: 90,
    chemistry: 11,
    playerGames: 1,
    rewardIds: ["career-game:published-85:reward"],
    outcomeIds: ["career-game:published-85:outcome"],
  });

  await page.reload();
  await expect(page.getByTestId("career-home-screen")).toBeVisible();
  await expect(page.getByTestId("career-coins")).toContainText("90");
  await expect(page.getByTestId("career-chemistry")).toContainText("默契11%");
  await expect(page.getByTestId("calendar-day-2026-10-21")).toContainText("胜 61-60");
});

test("a completed loss earns the same coins and only changes the outcome chemistry", async ({ page }) => {
  await openCareer(page, "loss");
  await launchNextGame(page);
  await page.clock.runFor(400);
  await page.getByTestId("settle-career-game").click();
  await expect(page.getByTestId("career-home-screen")).toBeVisible();
  await expect(page.getByTestId("career-coins")).toContainText("90");
  await expect(page.getByTestId("career-chemistry")).toContainText("默契9%");
  await expect(page.getByTestId("calendar-day-2026-10-21")).toContainText("负 60-61");
});

test("a simulated final has no manual-play entry and cannot become a coin claim", async ({ page }) => {
  await openCareer(page);
  await page.getByTestId("select-next-game").click();
  await expect(page.getByTestId("play-career-game")).toBeVisible();
  await page.getByTestId("simulate-to-date").click();
  await expect(page.getByTestId("career-coins")).toContainText("0");
  await expect(page.getByTestId("calendar-day-2026-10-21")).toContainText(/胜|负/);
  await expect(page.getByTestId("play-career-game")).toHaveCount(0);
});

test("freezes the reward and game length at launch while later difficulty changes affect only play and future settings", async ({ page }) => {
  await openCareer(page);
  await page.getByTestId("calendar-settings").click();
  await page.getByTestId("career-difficulty-hall_of_fame").click();
  await page.getByTestId("career-length-24").click();
  await page.getByTestId("close-calendar-settings").click();
  const game = await launchNextGame(page);
  await expect(game).toHaveAttribute("data-regulation-period-seconds", "360");
  await expect(game).toHaveAttribute("data-overtime-period-seconds", "150");
  await expect(game).toHaveAttribute("data-difficulty", "HALL_OF_FAME");

  await page.getByTestId("open-pause").click();
  await page.getByRole("tab", { name: "设置" }).click();
  await page.getByTestId("difficulty-rookie").click();
  await page.getByTestId("pause-resume").click();
  await expect(game).toHaveAttribute("data-difficulty", "ROOKIE");
  await page.clock.runFor(400);
  await expect(page.getByTestId("career-reward-preview")).toContainText("565 金币");
  await page.getByTestId("settle-career-game").click();
  await expect(page.getByTestId("career-coins")).toContainText("565");
});

test("resolves the Cup bracket before exposing either dynamic player game", async ({ page }) => {
  await openCareer(page);
  await page.getByTestId("calendar-next-month").click();
  await page.getByTestId("calendar-next-month").click();
  await page.getByTestId("calendar-day-2026-12-03").click();
  await page.getByTestId("simulate-to-date").click();
  await page.getByTestId("select-next-game").click();
  await expect(page.getByTestId("calendar-selection")).toContainText("2026-12-05");
  await expect(page.getByTestId("calendar-selection")).toContainText("杯赛对阵待定");
  await expect(page.getByTestId("play-career-game")).toHaveCount(0);

  await page.getByTestId("resolve-cup-schedule").click();
  await expect(page.locator(".calendar-days button.cup-tbd")).toHaveCount(0);
  await expect(page.getByTestId("play-career-game")).toBeVisible();
  await page.getByTestId("play-career-game").click();
  await page.getByTestId("confirm-career-game").click();
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-career-game-id", /^dynamic-cup-1-/);
});

test("keeps the final dialog open and commits nothing when root-save persistence fails", async ({ page }) => {
  await openCareer(page);
  await launchNextGame(page);
  await page.clock.runFor(400);
  await expect(page.getByTestId("game-over-dialog")).toBeVisible();
  await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key) !== null, SAVE_KEY)).toBe(true);

  await page.evaluate(() => {
    const browserWindow = window as typeof window & { __careerOriginalSetItem?: Storage["setItem"] };
    browserWindow.__careerOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function blockedCareerWrite() {
      throw new DOMException("quota blocked for test", "QuotaExceededError");
    };
  });
  await page.getByTestId("settle-career-game").click();
  await expect(page.getByTestId("game-over-dialog")).toBeVisible();
  await expect(page.getByTestId("career-settlement-error")).toContainText("结算失败");
  const unchanged = await page.evaluate((key) => {
    const save = JSON.parse(localStorage.getItem(key)!);
    const game = save.data.season.games.find((candidate: { id: string }) => candidate.id === "published-85");
    return { status: game.status, coins: save.data.progression.coins, chemistry: save.data.progression.chemistryPercent };
  }, SAVE_KEY);
  expect(unchanged).toEqual({ status: "SCHEDULED", coins: 0, chemistry: 10 });

  await page.evaluate(() => {
    const browserWindow = window as typeof window & { __careerOriginalSetItem?: Storage["setItem"] };
    Storage.prototype.setItem = browserWindow.__careerOriginalSetItem!;
    delete browserWindow.__careerOriginalSetItem;
  });
  await page.getByTestId("settle-career-game").click();
  await expect(page.getByTestId("career-home-screen")).toBeVisible();
  await expect(page.getByTestId("career-coins")).toContainText("90");
});
