import { expect, test } from "@playwright/test";

const SAVE_KEY = "wo-neng-da-zhi-ye:career:v1";

test("records simulated created-player play-in statistics with the bracket result", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
  await page.goto("/?qa=postseason&persist=1");
  await expect(page.getByTestId("career-home-screen")).toBeVisible();
  await page.getByTestId("calendar-postseason").click();
  await page.getByTestId("freeze-postseason").click();
  await page.getByTestId("postseason-tab-west").click();
  await page.getByTestId("simulate-play-in-west-a").click();

  const stats = page.getByTestId("postseason-player-stats");
  await expect(stats).toContainText("附加赛 1场");
  await expect(stats).toContainText("完整");
  const persisted = await page.evaluate((key) => {
    const save = JSON.parse(localStorage.getItem(key)!);
    return {
      schemaVersion: save.schemaVersion,
      postseasonRevision: save.data.postseason.revision,
      records: save.data.lifecycle.postseasonPerformance.byCompetition.PLAY_IN.games,
      regularGames: save.data.season.playerStats.games,
    };
  }, SAVE_KEY);
  expect(persisted.schemaVersion).toBe(4);
  expect(persisted.postseasonRevision).toBe(1);
  expect(persisted.records).toHaveLength(1);
  expect(persisted.records[0]).toMatchObject({
    gameId: "playin-WEST-A",
    competition: "PLAY_IN",
    source: "SIMULATED",
    venue: "HOME",
  });
  expect(persisted.records[0].playerLine.points).toBeGreaterThanOrEqual(0);
  expect(persisted.regularGames).toBe(82);
});

test("records a played created-player play-in line without regular-season rewards", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
  await page.goto("/?qa=postseason&persist=1&careerEnd=win");
  await page.getByTestId("calendar-postseason").click();
  await page.getByTestId("freeze-postseason").click();
  await page.getByTestId("postseason-tab-west").click();
  await page.getByTestId("play-play-in-west-a").click();
  await page.getByTestId("confirm-play-in-game").click();
  await page.clock.runFor(450);
  await expect(page.getByTestId("game-over-dialog")).toBeVisible();
  await page.getByTestId("settle-play-in-game").click();
  await expect(page.getByTestId("career-home-screen")).toBeVisible();

  const persisted = await page.evaluate((key) => {
    const save = JSON.parse(localStorage.getItem(key)!);
    return {
      coins: save.data.progression.coins,
      chemistry: save.data.progression.chemistryPercent,
      regularGames: save.data.season.playerStats.games,
      records: save.data.lifecycle.postseasonPerformance.byCompetition.PLAY_IN.games,
    };
  }, SAVE_KEY);
  expect(persisted.records).toHaveLength(1);
  expect(persisted.records[0].source).toBe("PLAYED");
  expect(persisted.records[0].playerLine.points).toBeGreaterThanOrEqual(0);
  expect(persisted.coins).toBe(0);
  expect(persisted.chemistry).toBeGreaterThanOrEqual(10);
  expect(persisted.regularGames).toBe(82);
});

test("settles a completed season, shows the age summary, and starts a projected next season", async ({ page }) => {
  await page.clock.install({ time: new Date("2027-06-30T12:00:00Z") });
  await page.goto("/?qa=playoffs&playoffStage=COMPLETE&persist=1");
  const home = page.getByTestId("career-home-screen");
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute("data-season-number", "1");
  await page.getByTestId("calendar-postseason").click();
  await expect(page.getByTestId("playoff-champion")).toBeVisible();
  await page.getByTestId("settle-career-season").click();

  const summary = page.getByTestId("season-summary-dialog");
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("data-season-number", "1");
  await expect(summary).toContainText("20岁 → 21岁");
  await expect(summary).toContainText("32岁前不触发年龄衰退");
  await expect(summary).toContainText("旧档季后赛部分场次无可恢复数据");
  await expect(page.getByTestId("open-training-center")).toBeDisabled();

  await page.getByTestId("begin-next-season").click();
  await expect(home).toHaveAttribute("data-season-number", "2");
  await expect(home).toHaveAttribute("data-season-basis", "PROJECTED");
  await expect(page.getByTestId("calendar-month-label")).toHaveText("2027年10月");
  await expect(page.getByTestId("career-save-status")).toContainText("本季为项目生成赛程");
  await expect(page.getByTestId("calendar-postseason")).toHaveText("生成季后赛");
  await expect(page.getByTestId("calendar-awards")).toHaveText("奖项/履历");
  await page.getByTestId("calendar-awards").click();
  const history = page.getByTestId("career-history-dialog");
  await expect(history).toBeVisible();
  await expect(history).toContainText("第1季 · 2026-27");
  await expect(history).toContainText("联盟总冠军");
  await page.getByTestId("close-career-history").click();

  const persisted = await page.evaluate((key) => {
    const save = JSON.parse(localStorage.getItem(key)!);
    return {
      seasonNumber: save.data.season.seasonNumber,
      seasonBasis: save.data.season.scheduleBasis,
      progressionSeason: save.data.progression.season,
      age: save.data.progression.age,
      lifecycleSeason: save.data.lifecycle.currentSeasonNumber,
      completedSeasons: save.data.lifecycle.completedSeasons.length,
      pendingSummary: save.data.lifecycle.pendingSeasonSummaryId,
      acknowledged: save.data.lifecycle.acknowledgedSeasonSummaryIds.length,
      hasPostseason: Boolean(save.data.postseason),
    };
  }, SAVE_KEY);
  expect(persisted).toEqual({
    seasonNumber: 2,
    seasonBasis: "PROJECTED",
    progressionSeason: 2,
    age: 21,
    lifecycleSeason: 2,
    completedSeasons: 1,
    pendingSummary: null,
    acknowledged: 1,
    hasPostseason: false,
  });

  await page.reload();
  await expect(page.getByTestId("career-home-screen")).toHaveAttribute("data-season-number", "2");
  await expect(page.getByTestId("calendar-month-label")).toHaveText("2027年10月");
  await page.getByTestId("calendar-awards").click();
  await expect(page.getByTestId("career-history-dialog")).toContainText("第1季 · 2026-27");
});
