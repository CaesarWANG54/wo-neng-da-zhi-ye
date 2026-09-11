import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * True iPhone landscape layout (P2) — WebKit + touch emulation only.
 * Runs under playwright.native.config.ts at 844x390 (iPhone 13) and
 * 852x393 (iPhone 15 Pro). The production game must fill the physical
 * viewport without the rotated desktop preview frame, respect safe-area
 * insets, keep the board dominant, keep five contextual right-side actions
 * at >=44 CSS px touch targets, and keep dialogs, tutorial, creation,
 * calendar and settings fully inside the viewport.
 */
test.skip(
  ({ browserName, isMobile }) => browserName !== "webkit" || !isMobile,
  "Native-mode suite runs only under WebKit iPhone landscape projects.",
);

async function viewportSize(page: Page) {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

async function expectInsideViewport(page: Page, box: { x: number; y: number; width: number; height: number } | null) {
  expect(box).not.toBeNull();
  const viewport = await viewportSize(page);
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.y).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 0.5);
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight);
}

async function expectTouchTarget(page: Page, locator: Locator, minimum = 44) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(minimum);
  expect(box!.height).toBeGreaterThanOrEqual(minimum);
  await expectInsideViewport(page, box);
}

async function expectTouchTargets(page: Page, locator: Locator, minimum = 44) {
  const count = await locator.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await expectTouchTarget(page, locator.nth(index), minimum);
  }
}

async function expectMinimumFontSize(locator: Locator, minimum: number) {
  await expect(locator).toBeVisible();
  const fontSize = await locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(minimum);
}

test("renders the match full-viewport on a real iPhone with no preview frame", async ({ page }) => {
  await page.goto("/?qa=game");
  const appNative = page.getByTestId("app-native");
  await expect(appNative).toBeVisible();
  await expect(page.getByTestId("phone-frame")).toBeHidden();
  await expect(page.getByTestId("device-picker")).toBeHidden();

  const viewport = await viewportSize(page);
  // One of the two representative iPhone landscape sizes under test.
  expect([[844, 390], [852, 393]]).toContainEqual([viewport.width, viewport.height]);
  const box = await appNative.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.height - viewport.height)).toBeLessThanOrEqual(1);

  const game = await page.getByTestId("game-screen").boundingBox();
  await expectInsideViewport(page, game);
  const viewportContent = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewportContent).toContain("viewport-fit=cover");
  expect(viewportContent).not.toContain("maximum-scale");
  expect(viewportContent).not.toContain("user-scalable=no");
  await expectNoOverflow(page);
});

test("switches native canvas with live iPhone orientation changes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?qa=game");
  await expect(page.getByTestId("app-native")).toHaveAttribute("data-orientation", "portrait");
  await expect(page.getByTestId("phone-frame")).toBeHidden();
  await expect(page.getByTestId("portrait-guard")).toContainText("比赛已暂停");

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByTestId("app-native")).toBeVisible();
  await expect(page.getByTestId("app-native")).toHaveAttribute("data-orientation", "landscape");
  await expect(page.getByTestId("portrait-guard")).toHaveCount(0);
  await expect(page.getByTestId("phone-frame")).toBeHidden();
  await expectNoOverflow(page);

  await page.getByRole("button", { name: /暂停/ }).click();
  const game = page.getByTestId("game-screen");
  const phaseToken = await game.getAttribute("data-phase-token");
  const eventSequence = await game.getAttribute("data-event-sequence");
  await expect(page.getByRole("dialog", { name: "比赛暂停" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("portrait-guard")).toBeVisible();
  await expect(game).toHaveCount(1);
  await expect(game).toHaveAttribute("data-simulation-paused", "true");

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByTestId("portrait-guard")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "比赛暂停" })).toBeVisible();
  await expect(game).toHaveAttribute("data-phase-token", phaseToken ?? "");
  await expect(game).toHaveAttribute("data-event-sequence", eventSequence ?? "");
});

test("keeps creation, first-year route, direct signing and draft controls release-sized", async ({ page }) => {
  await page.goto("/?qa=create");
  const creation = page.getByTestId("player-creation-screen");
  await expect(creation).toBeVisible();
  await expectInsideViewport(page, await page.getByTestId("start-tutorial").boundingBox());
  await expectTouchTargets(page, creation.locator("button:enabled"));
  await expectTouchTarget(page, page.getByTestId("created-player-name"));
  await expectMinimumFontSize(page.getByTestId("start-tutorial"), 11);
  await expectMinimumFontSize(page.locator(".template-list button").first().locator("strong"), 11);
  await expectNoOverflow(page);

  await page.goto("/?qa=career-route");
  const route = page.getByTestId("career-route-screen");
  await expectTouchTargets(page, route.locator("button:enabled"));
  await expectMinimumFontSize(page.getByTestId("choose-draft").locator("h2"), 16);
  await page.getByTestId("choose-direct").click();

  const teamSelection = page.getByTestId("team-selection-screen");
  await expect(teamSelection).toBeVisible();
  await expectTouchTargets(page, teamSelection.locator("button:enabled"));
  await expectMinimumFontSize(page.locator(".team-grid button").first().locator("strong"), 11);
  await expectNoOverflow(page);

  await page.goto("/?qa=draft-ceremony");
  const draft = page.getByTestId("draft-ceremony-screen");
  await expect(draft).toBeVisible();
  await expectTouchTargets(page, draft.locator("button:enabled"));
  await expectMinimumFontSize(draft.locator("button:enabled").first(), 11);
  await expectNoOverflow(page);
});

test("keeps the board dominant with five right-side 44px+ actions and a readable scoreboard", async ({ page }) => {
  await page.goto("/?qa=game");
  await expect(page.getByTestId("game-screen")).toBeVisible();
  const viewport = await viewportSize(page);

  const board = await page.locator(".court-panel").boundingBox();
  expect(board).not.toBeNull();
  expect(board!.width).toBeGreaterThan(viewport.width * 0.5);
  expect(board!.height).toBeGreaterThan(viewport.height * 0.55);

  const buttons = page.locator(".action-rail > button");
  await expect(buttons).toHaveCount(5);
  const rail = await page.locator(".action-rail").boundingBox();
  await expectInsideViewport(page, rail);
  for (let index = 0; index < 5; index += 1) {
    const button = await buttons.nth(index).boundingBox();
    expect(button).not.toBeNull();
    expect(button!.width).toBeGreaterThanOrEqual(44);
    expect(button!.height).toBeGreaterThanOrEqual(44);
    await expectInsideViewport(page, button);
  }

  for (const testId of ["scoreboard", "shot-clock", "game-clock", "open-pause"]) {
    const element = await page.getByTestId(testId).boundingBox();
    expect(element, testId).not.toBeNull();
    await expectInsideViewport(page, element);
  }
});

test("keeps pause and help dialogs fully usable inside the native viewport", async ({ page }) => {
  await page.goto("/?qa=game");
  await expect(page.getByTestId("game-screen")).toBeVisible();

  await page.getByTestId("open-pause").click();
  const pause = page.getByRole("dialog", { name: "比赛暂停" });
  await expect(pause).toBeVisible();
  await expectInsideViewport(page, await pause.boundingBox());
  await pause.getByRole("button", { name: /玩法说明/ }).click();
  const help = page.getByRole("dialog", { name: "玩法说明" });
  await expect(help).toBeVisible();
  await expectInsideViewport(page, await help.boundingBox());
  await expect(help).toContainText("双击传球尝试空接");
  await help.getByRole("button", { name: "返回暂停" }).click();
  await expect(pause).toBeVisible();
  await pause.getByRole("button", { name: "继续比赛" }).click();
  await expect(pause).toHaveCount(0);
  await expectNoOverflow(page);
});

test("keeps the tutorial match controls actionable at native size", async ({ page }) => {
  await page.goto("/?qa=game");
  await expect(page.getByTestId("game-screen")).toBeVisible();
  const tutorialTracker = page.getByTestId("tutorial-tracker");
  await expect(tutorialTracker).toBeVisible();
  await expectInsideViewport(page, await tutorialTracker.boundingBox());
  await expect(tutorialTracker).toHaveAttribute("data-total-count", "6");
  // 挡拆 (screen) is the tutorial entry control; it must resolve visibly.
  await page.getByRole("button", { name: /挡拆，呼叫队友掩护/ }).click();
  await expect(page.locator(".paper-note")).toContainText("掩护正在形成");
  await expect(page.getByTestId("tutorial-task-screen")).toHaveAttribute("data-completed", "true");
  await expectNoOverflow(page);

  await page.goto("/?qa=final");
  const evaluationDialog = page.getByTestId("game-over-dialog");
  await expect(evaluationDialog).toBeVisible();
  await expectInsideViewport(page, await evaluationDialog.boundingBox());
  await expectInsideViewport(page, await page.getByTestId("tutorial-evaluation-breakdown").boundingBox());
  await expect(page.getByTestId("tutorial-evaluation-breakdown").locator("article")).toHaveCount(5);
  await expectNoOverflow(page);
});

test("keeps player creation, career calendar, training and settings inside the native viewport", async ({ page }) => {
  await page.goto("/?qa=create");
  const creation = page.locator(".creation-grid");
  await expect(creation).toBeVisible();
  await expectInsideViewport(page, await creation.boundingBox());
  await expectTouchTargets(page, page.getByTestId("player-creation-screen").locator("button:enabled"));
  await expectNoOverflow(page);

  await page.goto("/?qa=career-home");
  const calendar = page.locator(".career-calendar-grid");
  await expect(calendar).toBeVisible();
  await expectInsideViewport(page, await calendar.boundingBox());
  await expectTouchTargets(page, page.locator(".career-calendar-tools button:enabled"));
  await expectTouchTargets(page, page.locator(".calendar-month-bar button:enabled"));
  await expectTouchTarget(page, page.getByTestId("select-next-game"));
  await expectTouchTarget(page, page.getByTestId("open-training-center"));
  await expectTouchTarget(page, page.getByTestId("replay-tutorial"));
  // The fixture starts without enough coins, so verify the purchase target's
  // release geometry even while it is correctly disabled.
  const firstRatingPurchase = page.locator(".attribute-scroll button").first();
  await expectTouchTarget(page, firstRatingPurchase);
  await expectMinimumFontSize(page.getByTestId("calendar-settings"), 10);
  await expectMinimumFontSize(page.locator(".career-calendar-team strong"), 11);

  const selectableDay = page.locator(".calendar-days > button:enabled").nth(10);
  await expectTouchTarget(page, selectableDay, 24);
  const dayBox = await selectableDay.boundingBox();
  expect(dayBox!.width).toBeGreaterThanOrEqual(30);
  await selectableDay.click();
  await expect(selectableDay).toHaveClass(/selected/);
  const settingsButton = page.getByTestId("calendar-settings");
  await expect(settingsButton).toBeVisible();
  await expectInsideViewport(page, await settingsButton.boundingBox());
  await settingsButton.click();
  const settings = page.getByRole("dialog", { name: "日历设置" });
  await expect(settings).toBeVisible();
  await expectInsideViewport(page, await settings.boundingBox());
  await expectTouchTargets(page, settings.locator("button:enabled"));
  await expectTouchTarget(page, settings.locator('input[type="range"]'));
  await settings.getByTestId("close-calendar-settings").click();
  await expect(settings).toHaveCount(0);

  await page.getByTestId("open-training-center").click();
  const training = page.getByRole("dialog", { name: "训练中心" });
  await expect(training).toBeVisible();
  await expectInsideViewport(page, await training.boundingBox());
  await expect(training.locator(".training-group-list > button")).toHaveCount(8);
  await expect(training.getByTestId("commit-training")).toBeEnabled();
  await expectTouchTargets(page, training.locator("button:enabled"));
  await expectMinimumFontSize(training.locator(".training-group-list strong").first(), 10);
  await training.getByTestId("close-training-center").click();
  await expect(training).toHaveCount(0);
  await expectNoOverflow(page);
});

test("keeps a real career match, settlement dialog, and return-to-calendar flow inside iPhone landscape", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
  await page.goto("/?qa=career-home&persist=1&careerEnd=win");
  await page.getByTestId("select-next-game").click();
  await page.getByTestId("play-career-game").click();
  const confirmation = page.getByRole("dialog", { name: "确认进入比赛" });
  await expect(confirmation).toBeVisible();
  await expectInsideViewport(page, await confirmation.boundingBox());
  await page.getByTestId("confirm-career-game").click();

  const game = page.getByTestId("game-screen");
  await expect(game).toHaveAttribute("data-match-mode", "CAREER");
  await expectInsideViewport(page, await game.boundingBox());
  const board = page.locator(".court-panel");
  await expectInsideViewport(page, await board.boundingBox());
  const actions = page.locator(".action-rail > button");
  await expect(actions).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) {
    const box = await actions.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectInsideViewport(page, box);
  }

  await page.clock.runFor(400);
  const finalDialog = page.getByTestId("game-over-dialog");
  await expect(finalDialog).toBeVisible();
  await expectInsideViewport(page, await finalDialog.boundingBox());
  await expect(page.getByTestId("career-reward-preview")).toContainText("90 金币");
  const settleButton = page.getByTestId("settle-career-game");
  await expectInsideViewport(page, await settleButton.boundingBox());
  await settleButton.click();
  const calendar = page.locator(".career-calendar-grid");
  await expect(calendar).toBeVisible();
  await expectInsideViewport(page, await calendar.boundingBox());
  await expectNoOverflow(page);
});

test("keeps the postseason bracket and a manual play-in flow usable in native iPhone landscape", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
  await page.goto("/?qa=postseason&persist=1&careerEnd=win");
  await expect(page.getByTestId("app-native")).toBeVisible();
  await page.getByTestId("calendar-postseason").click();
  const freezeDialog = page.getByRole("dialog", { name: "季后赛中心" });
  await expect(freezeDialog).toBeVisible();
  await expectInsideViewport(page, await freezeDialog.boundingBox());
  const freezeButton = page.getByTestId("freeze-postseason");
  const freezeButtonBox = await freezeButton.boundingBox();
  expect(freezeButtonBox).not.toBeNull();
  expect(freezeButtonBox!.width).toBeGreaterThanOrEqual(44);
  expect(freezeButtonBox!.height).toBeGreaterThanOrEqual(44);
  await freezeButton.click();

  const panel = page.getByTestId("postseason-panel");
  await expect(panel).toBeVisible();
  await expectInsideViewport(page, await panel.boundingBox());
  await expectInsideViewport(page, await page.locator(".postseason-layout").boundingBox());
  await expectMinimumFontSize(panel.locator(".postseason-performance-strip"), 8);
  for (const testId of ["postseason-tab-east", "postseason-tab-west", "close-postseason"]) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box, testId).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectInsideViewport(page, box);
  }

  await page.getByTestId("postseason-tab-west").click();
  await expect(page.getByTestId("player-postseason-status")).toContainText("第7名");
  const playerGame = page.getByTestId("play-in-game-west-a");
  await expectInsideViewport(page, await playerGame.boundingBox());
  const playButton = page.getByTestId("play-play-in-west-a");
  const playButtonBox = await playButton.boundingBox();
  expect(playButtonBox).not.toBeNull();
  expect(playButtonBox!.width).toBeGreaterThanOrEqual(44);
  expect(playButtonBox!.height).toBeGreaterThanOrEqual(44);
  await expectTouchTargets(page, panel.locator("button:enabled"));
  await playButton.click();

  const confirmation = page.getByRole("dialog", { name: "确认进入附加赛" });
  await expectInsideViewport(page, await confirmation.boundingBox());
  const confirmButton = page.getByTestId("confirm-play-in-game");
  const confirmButtonBox = await confirmButton.boundingBox();
  expect(confirmButtonBox).not.toBeNull();
  expect(confirmButtonBox!.height).toBeGreaterThanOrEqual(44);
  await confirmButton.click();

  const game = page.getByTestId("game-screen");
  await expect(game).toHaveAttribute("data-career-context", "PLAY_IN");
  await expectInsideViewport(page, await game.boundingBox());
  await page.clock.runFor(400);
  await expectInsideViewport(page, await page.getByTestId("game-over-dialog").boundingBox());
  await page.getByTestId("settle-play-in-game").click();
  await expectInsideViewport(page, await page.getByTestId("career-home-screen").boundingBox());
  await expect(page.getByTestId("postseason-panel")).toBeVisible();
  await page.getByTestId("postseason-tab-west").click();
  await expect(page.getByTestId("player-postseason-status")).toContainText("锁定第7种子");
  await expectNoOverflow(page);
});

test("keeps playoff round controls, a playable Finals, and the champion readable in native iPhone landscape", async ({ page }) => {
  await page.goto("/?qa=playoffs&playoffStage=FINALS&careerEnd=win");
  await expect(page.getByTestId("app-native")).toBeVisible();
  await page.getByTestId("calendar-postseason").click();
  const panel = page.getByTestId("postseason-panel");
  await expect(panel).toBeVisible();
  await page.getByTestId("postseason-round-finals").click();
  const finalsView = page.getByTestId("postseason-view-finals");
  await expect(finalsView).toBeVisible();
  await expect(finalsView.locator(".playoff-series")).toHaveCount(1);
  await expectInsideViewport(page, await panel.boundingBox());
  await expectInsideViewport(page, await finalsView.boundingBox());

  const navigation = page.locator(".postseason-round-tabs > button");
  await expect(navigation).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) {
    const box = await navigation.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectInsideViewport(page, box);
  }

  for (const testId of ["postseason-tab-east", "postseason-tab-west", "close-postseason"]) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box, testId).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectInsideViewport(page, box);
  }

  const finalsActions = finalsView.locator(".playoff-series-actions button");
  await expect(finalsActions).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    const box = await finalsActions.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectInsideViewport(page, box);
  }
  await expectTouchTargets(page, panel.locator("button:enabled"));
  await expectMinimumFontSize(page.getByTestId("postseason-round-finals"), 10);
  await expectNoOverflow(page);

  // QA persistence is intentionally off for this second navigation so the
  // COMPLETE fixture cannot be replaced by the prior in-progress save.
  await page.goto("/?qa=playoffs&playoffStage=COMPLETE&careerEnd=win");
  await page.getByTestId("calendar-postseason").click();
  await page.getByTestId("postseason-round-finals").click();
  const completePanel = page.getByTestId("postseason-panel");
  await expect(completePanel).toHaveAttribute("data-playoff-status", "COMPLETE");
  const champion = page.getByTestId("playoff-champion");
  await expect(champion).toBeVisible();
  await expect(champion).toContainText("首年总冠军");
  await expect(champion).toContainText("赛季结果已唯一锁定");
  await expectInsideViewport(page, await completePanel.boundingBox());
  await expectInsideViewport(page, await champion.boundingBox());
  await expect(page.getByTestId("postseason-view-finals").locator(".playoff-series-actions")).toHaveCount(0);
  await expectNoOverflow(page);
});

test("keeps the M6B-3 season summary and projected second-season calendar inside iPhone landscape", async ({ page }) => {
  await page.clock.install({ time: new Date("2027-06-30T12:00:00Z") });
  await page.goto("/?qa=playoffs&playoffStage=COMPLETE&persist=1");
  await expect(page.getByTestId("app-native")).toBeVisible();
  await page.getByTestId("calendar-postseason").click();
  const settle = page.getByTestId("settle-career-season");
  await expect(settle).toBeVisible();
  const settleBox = await settle.boundingBox();
  expect(settleBox).not.toBeNull();
  expect(settleBox!.width).toBeGreaterThanOrEqual(44);
  expect(settleBox!.height).toBeGreaterThanOrEqual(44);
  await expectInsideViewport(page, settleBox);
  await settle.click();

  const summary = page.getByTestId("season-summary-dialog");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("20岁 → 21岁");
  await expectInsideViewport(page, await summary.boundingBox());
  await expectInsideViewport(page, await summary.locator(".season-summary-body").boundingBox());
  const nextSeason = page.getByTestId("begin-next-season");
  const nextSeasonBox = await nextSeason.boundingBox();
  expect(nextSeasonBox).not.toBeNull();
  expect(nextSeasonBox!.width).toBeGreaterThanOrEqual(44);
  expect(nextSeasonBox!.height).toBeGreaterThanOrEqual(44);
  await expectInsideViewport(page, nextSeasonBox);
  await expectTouchTargets(page, summary.locator("button:enabled"));
  await expectMinimumFontSize(nextSeason, 10);
  await expectNoOverflow(page);

  await nextSeason.click();
  const home = page.getByTestId("career-home-screen");
  await expect(home).toHaveAttribute("data-season-number", "2");
  await expect(home).toHaveAttribute("data-season-basis", "PROJECTED");
  const calendar = page.locator(".career-calendar-grid");
  await expect(calendar).toBeVisible();
  await expectInsideViewport(page, await home.boundingBox());
  await expectInsideViewport(page, await calendar.boundingBox());
  await expect(page.getByTestId("calendar-month-label")).toHaveText("2027年10月");
  await expect(page.getByTestId("career-save-status")).toContainText("本季为项目生成赛程");
  await page.getByTestId("calendar-awards").click();
  const history = page.getByTestId("career-history-dialog");
  await expect(history).toBeVisible();
  await expect(history).toContainText("第1季 · 2026-27");
  await expectInsideViewport(page, await history.boundingBox());
  const closeHistory = page.getByTestId("close-career-history");
  const closeHistoryBox = await closeHistory.boundingBox();
  expect(closeHistoryBox).not.toBeNull();
  expect(closeHistoryBox!.width).toBeGreaterThanOrEqual(44);
  expect(closeHistoryBox!.height).toBeGreaterThanOrEqual(44);
  await expectInsideViewport(page, closeHistoryBox);
  await expectTouchTargets(page, history.locator("button:enabled"));
  await expectMinimumFontSize(history.locator(".career-history-layout > nav strong").first(), 10);
  await expectNoOverflow(page);
});
