import { expect, test, type Page } from "@playwright/test";

const SAVE_KEY = "wo-neng-da-zhi-ye:career:v1";

async function openFrozenPostseason(page: Page) {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
  await page.goto("/?qa=postseason&persist=1&careerEnd=win");
  await expect(page.getByTestId("career-home-screen")).toBeVisible();
  await expect(page.getByTestId("calendar-postseason")).toBeEnabled();
  await page.getByTestId("calendar-postseason").click();
  const empty = page.getByRole("dialog", { name: "季后赛中心" });
  await expect(empty).toContainText("全部 1,230 场常规赛结束后");
  await page.getByTestId("freeze-postseason").click();
  const panel = page.getByTestId("postseason-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-postseason-revision", "0");
  await page.waitForFunction((key) => Boolean(JSON.parse(localStorage.getItem(key) ?? "null")?.data?.postseason), SAVE_KEY);
  return panel;
}

test("freezes once, renders both conference top tens, and restores the same bracket", async ({ page }) => {
  const panel = await openFrozenPostseason(page);
  const freezeEventId = await panel.getAttribute("data-freeze-event-id");
  expect(freezeEventId).toMatch(/^postseason-freeze-2026-/);
  await expect(panel).toHaveAttribute("data-ranking-rules-version", "m6b1-tiebreak-v1");
  await expect(page.locator('[data-testid^="postseason-rank-east-"]')).toHaveCount(10);
  await expect(page.locator('[data-testid^="postseason-rank-east-"][data-outcome="DIRECT"]')).toHaveCount(6);
  await expect(page.locator('[data-testid^="postseason-rank-east-"][data-outcome="PLAY_IN"]')).toHaveCount(4);
  await expect(page.getByTestId("play-in-game-east-a")).toHaveAttribute("data-status", "SCHEDULED");
  await expect(page.getByTestId("play-in-game-east-b")).toHaveAttribute("data-status", "SCHEDULED");
  await expect(page.getByTestId("play-in-game-east-c")).toHaveAttribute("data-status", "LOCKED");

  await page.getByTestId("postseason-tab-west").click();
  await expect(page.getByTestId("postseason-tab-west")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-testid^="postseason-rank-west-"]')).toHaveCount(10);
  await expect(page.getByTestId("player-postseason-status")).toContainText("第7名 · 等待附加赛");
  await expect(page.getByTestId("play-play-in-west-a")).toBeVisible();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
  expect(saved.schemaVersion).toBe(4);
  expect(saved.data.postseason.eventIds).toEqual([freezeEventId]);
  expect(saved.data.postseason.east.teams).toHaveLength(15);
  expect(saved.data.postseason.west.teams).toHaveLength(15);

  await page.reload();
  await page.getByTestId("calendar-postseason").click();
  await expect(page.getByTestId("postseason-panel")).toHaveAttribute("data-freeze-event-id", freezeEventId!);
  await expect(page.getByTestId("postseason-panel")).toHaveAttribute("data-postseason-revision", "0");
  const afterReload = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
  expect(afterReload.data.postseason.eventIds).toEqual([freezeEventId]);
});

test("advances interleaved East and West games exactly once and creates both C matchups", async ({ page }) => {
  const panel = await openFrozenPostseason(page);
  await page.getByTestId("simulate-play-in-east-a").evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(panel).toHaveAttribute("data-postseason-revision", "1");
  await expect(page.getByTestId("play-in-game-east-a")).toHaveAttribute("data-status", "FINAL");
  await expect(page.getByTestId("play-in-game-east-b")).toHaveAttribute("data-status", "SCHEDULED");

  await page.getByTestId("postseason-tab-west").click();
  await page.getByTestId("simulate-play-in-west-a").click();
  await page.getByTestId("postseason-tab-east").click();
  await page.getByTestId("simulate-play-in-east-b").click();
  await expect(page.getByTestId("play-in-game-east-c")).toHaveAttribute("data-status", "SCHEDULED");
  await page.getByTestId("postseason-tab-west").click();
  await page.getByTestId("simulate-play-in-west-b").click();
  await expect(page.getByTestId("play-in-game-west-c")).toHaveAttribute("data-status", "SCHEDULED");
  await expect(panel).toHaveAttribute("data-postseason-revision", "4");

  const persisted = await page.evaluate((key) => {
    const save = JSON.parse(localStorage.getItem(key)!);
    return {
      revision: save.data.postseason.revision,
      eventIds: save.data.postseason.eventIds,
      eastC: save.data.postseason.playIn.EAST.gameC,
      westC: save.data.postseason.playIn.WEST.gameC,
    };
  }, SAVE_KEY);
  expect(persisted.revision).toBe(4);
  expect(persisted.eventIds).toHaveLength(5);
  expect(persisted.eastC.status).toBe("SCHEDULED");
  expect(persisted.westC.status).toBe("SCHEDULED");

  await page.reload();
  await page.getByTestId("calendar-postseason").click();
  await expect(page.getByTestId("postseason-panel")).toHaveAttribute("data-postseason-revision", "4");
  await expect(page.getByTestId("play-in-game-east-c")).toHaveAttribute("data-status", "SCHEDULED");
});

test("cancels a play-in confirmation without advancing the bracket", async ({ page }) => {
  const panel = await openFrozenPostseason(page);
  await page.getByTestId("postseason-tab-west").click();
  const revision = await panel.getAttribute("data-postseason-revision");
  await page.getByTestId("play-play-in-west-a").click();
  await expect(page.getByRole("dialog", { name: "确认进入附加赛" })).toBeVisible();
  await page.getByTestId("cancel-play-in-game").click();
  await expect(page.getByRole("dialog", { name: "确认进入附加赛" })).toHaveCount(0);
  await expect(panel).toHaveAttribute("data-postseason-revision", revision ?? "0");
  await expect(page.getByTestId("play-play-in-west-a")).toBeVisible();
});

test("plays the created player's play-in game with atomic failure recovery and no regular-season rewards", async ({ page }) => {
  await openFrozenPostseason(page);
  await page.getByTestId("postseason-tab-west").click();
  await page.getByTestId("play-play-in-west-a").click();
  const confirmation = page.getByRole("dialog", { name: "确认进入附加赛" });
  await expect(confirmation).toContainText("结果决定晋级去向");
  await expect(page.getByTestId("play-in-save-warning")).toContainText("晋级结果不会被提前写入");
  await page.getByTestId("confirm-play-in-game").click();

  const game = page.getByTestId("game-screen");
  await expect(game).toHaveAttribute("data-match-mode", "CAREER");
  await expect(game).toHaveAttribute("data-career-context", "PLAY_IN");
  await expect(game).toHaveAttribute("data-career-game-id", "playin-WEST-A");
  await page.clock.runFor(400);
  await expect(page.getByTestId("game-over-dialog")).toBeVisible();
  await expect(page.getByTestId("play-in-settlement-preview")).toContainText("不重复发放常规赛金币或默契奖励");
  await expect(page.getByTestId("career-reward-preview")).toHaveCount(0);

  const before = await page.evaluate((key) => {
    const save = JSON.parse(localStorage.getItem(key)!);
    return {
      coins: save.data.progression.coins,
      chemistry: save.data.progression.chemistryPercent,
      playerStats: JSON.stringify(save.data.season.playerStats),
      standings: JSON.stringify(save.data.season.standings),
      postseasonRevision: save.data.postseason.revision,
    };
  }, SAVE_KEY);

  await page.evaluate(() => {
    const browserWindow = window as typeof window & { __postseasonOriginalSetItem?: Storage["setItem"] };
    browserWindow.__postseasonOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function blockedPostseasonWrite() {
      throw new DOMException("quota blocked for postseason test", "QuotaExceededError");
    };
  });
  await page.getByTestId("settle-play-in-game").click();
  await expect(page.getByTestId("game-over-dialog")).toBeVisible();
  await expect(page.getByTestId("play-in-settlement-error")).toContainText("附加赛结算失败");

  await page.evaluate(() => {
    const browserWindow = window as typeof window & { __postseasonOriginalSetItem?: Storage["setItem"] };
    Storage.prototype.setItem = browserWindow.__postseasonOriginalSetItem!;
    delete browserWindow.__postseasonOriginalSetItem;
  });
  await page.getByTestId("settle-play-in-game").evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByTestId("career-home-screen")).toBeVisible();
  await expect(page.getByTestId("postseason-panel")).toBeVisible();
  await page.getByTestId("postseason-tab-west").click();
  await expect(page.getByTestId("player-postseason-status")).toContainText("锁定第7种子");

  const after = await page.evaluate((key) => {
    const save = JSON.parse(localStorage.getItem(key)!);
    return {
      coins: save.data.progression.coins,
      chemistry: save.data.progression.chemistryPercent,
      playerStats: JSON.stringify(save.data.season.playerStats),
      standings: JSON.stringify(save.data.season.standings),
      postseasonRevision: save.data.postseason.revision,
      postseasonEvents: save.data.postseason.eventIds.length,
      seed7: save.data.postseason.playIn.WEST.finalSeed7TeamId,
      playerTeamId: save.data.season.playerTeamId,
    };
  }, SAVE_KEY);
  expect(after.coins).toBe(before.coins);
  expect(after.chemistry).toBe(before.chemistry);
  expect(after.playerStats).toBe(before.playerStats);
  expect(after.standings).toBe(before.standings);
  expect(after.postseasonRevision).toBe(before.postseasonRevision + 1);
  expect(after.postseasonEvents).toBe(2);
  expect(after.seed7).toBe(after.playerTeamId);

  await page.reload();
  await page.getByTestId("calendar-postseason").click();
  await page.getByTestId("postseason-tab-west").click();
  await expect(page.getByTestId("player-postseason-status")).toContainText("锁定第7种子");
});
