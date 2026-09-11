import { expect, test } from "@playwright/test";

const storageKey = "wo-neng-da-zhi-ye:career:v1";

test.beforeEach(async ({ page }) => {
  await page.goto("/?qa=create");
  await page.evaluate((key) => {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(`${key}:recovery`);
  }, storageKey);
});

test("persists a direct-signing career, training, settings, purchases and calendar week", async ({ page }) => {
  await page.goto("/?qa=career-route&persist=1");
  await page.getByTestId("choose-direct").click();
  await page.getByTestId("team-lakers").click();
  await expect(page.getByTestId("career-home-screen")).toContainText("湖人");

  const threePoint = page.getByTestId("career-rating-threePoint").locator("strong");
  const rookieThree = Number(await threePoint.textContent());
  await page.getByTestId("open-training-center").click();
  await page.getByTestId("training-group-shooting").click();
  await page.getByTestId("training-primary-threePoint").click();
  await page.getByTestId("commit-training").click();
  await expect(page.getByTestId("training-count").last()).toContainText("1/2");
  await page.getByTestId("close-training-center").click();

  await page.getByTestId("calendar-settings").click();
  await page.getByTestId("career-volume").fill("15");
  await page.getByTestId("career-difficulty-all_star").click();
  await page.getByTestId("career-length-12").click();
  await page.getByTestId("close-calendar-settings").click();

  await page.waitForFunction((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    const save = JSON.parse(raw);
    return save.data.progression.sessionsUsedThisWeek === 1
      && save.data.progression.ratings.threePoint === save.data.profile.ratings.threePoint + 1
      && save.data.settings.volume === 15
      && save.data.settings.difficulty === "ALL_STAR"
      && save.data.settings.gameMinutes === 12;
  }, storageKey);

  await page.reload();
  await expect(page.getByTestId("career-home-screen")).toContainText("湖人");
  await expect(page.getByTestId("career-route-screen")).toHaveCount(0);
  await expect(page.getByTestId("training-count")).toContainText("1/2");
  await expect(threePoint).toHaveText(String(rookieThree + 1));
  await page.getByTestId("calendar-settings").click();
  await expect(page.getByTestId("career-volume")).toHaveValue("15");
  await expect(page.getByTestId("career-difficulty-all_star")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("career-length-12")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("close-calendar-settings").click();

  await page.evaluate((key) => {
    const save = JSON.parse(window.localStorage.getItem(key)!);
    save.data.progression.coins = 180;
    save.data.season.coins = 180;
    window.localStorage.setItem(key, JSON.stringify(save));
  }, storageKey);
  await page.reload();
  await expect(page.getByTestId("career-coins")).toContainText("180");
  await page.getByTestId("buy-rating-threePoint").click();
  await page.getByTestId("buy-rating-threePoint").click();
  await expect(page.getByTestId("career-coins")).toContainText("0");
  await expect(threePoint).toHaveText(String(rookieThree + 3));

  await page.getByTestId("calendar-day-2026-10-26").click();
  await page.getByTestId("simulate-to-date").click();
  await expect(page.getByTestId("career-home-screen")).toHaveAttribute("data-progression-week", "2");
  await expect(page.getByTestId("career-home-screen")).toHaveAttribute("data-sessions-used", "0");
  await page.waitForFunction((key) => JSON.parse(window.localStorage.getItem(key)!).data.season.currentDate === "2026-10-26", storageKey);
  await page.reload();
  await expect(page.getByTestId("career-home-screen")).toHaveAttribute("data-progression-week", "2");
  await expect(page.getByTestId("career-coins")).toContainText("0");
  await expect(threePoint).toHaveText(String(rookieThree + 3));
});

test("never rerolls a persisted first-year draft destination", async ({ page }) => {
  await page.goto("/?qa=career-route&persist=1");
  await page.getByTestId("choose-draft").click();
  await expect(page.getByTestId("draft-ceremony-screen")).toBeVisible();
  const expectedPick = await page.locator(".draft-progress > strong").textContent();
  await page.waitForFunction((key) => JSON.parse(window.localStorage.getItem(key)!).data.stage === "DRAFT_CEREMONY", storageKey);

  await page.reload();
  await expect(page.getByTestId("draft-ceremony-screen")).toBeVisible();
  await expect(page.locator(".draft-progress > strong")).toHaveText(expectedPick!);
  await expect(page.getByTestId("draft-current-pick")).toContainText("First pick");

  while (await page.getByTestId("draft-next").count()) await page.getByTestId("draft-next").click();
  await page.getByTestId("enter-career").click();
  await page.waitForFunction((key) => JSON.parse(window.localStorage.getItem(key)!).data.stage === "CAREER_HOME", storageKey);
  await page.reload();
  await expect(page.getByTestId("career-home-screen")).toBeVisible();
  await expect(page.getByTestId("career-home-screen")).toContainText(`首轮第${expectedPick?.replace("#", "")}顺位`);
  await expect(page.getByTestId("career-route-screen")).toHaveCount(0);
});

test("recovers a corrupt save to creation without inventing a team", async ({ page }) => {
  await page.evaluate((key) => window.localStorage.setItem(key, "not-json"), storageKey);
  await page.goto("/");
  await expect(page.getByTestId("player-creation-screen")).toBeVisible();
  await expect(page.getByTestId("career-save-status")).toContainText("旧存档已损坏");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(`${key}:recovery`), storageKey)).toBe("not-json");
  await expect(page.getByTestId("career-home-screen")).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), storageKey)).toBeNull();
});

test("rejects a career-game marker that is not paired with a final schedule result", async ({ page }) => {
  await page.goto("/?qa=career-route&persist=1");
  await page.getByTestId("choose-direct").click();
  await page.getByTestId("team-lakers").click();
  await page.waitForFunction((key) => window.localStorage.getItem(key) !== null, storageKey);
  await page.evaluate((key) => {
    const save = JSON.parse(window.localStorage.getItem(key)!);
    const scheduled = save.data.season.games.find((game: { status: string; awayTeamId: string; homeTeamId: string }) => game.status === "SCHEDULED" && (game.awayTeamId === "LAKERS" || game.homeTeamId === "LAKERS"));
    save.data.progression.processedRewardIds = [`career-game:${scheduled.id}:reward`];
    save.data.progression.processedChemistryEventIds = [];
    window.localStorage.setItem(key, JSON.stringify(save));
  }, storageKey);

  await page.goto("/");
  await expect(page.getByTestId("player-creation-screen")).toBeVisible();
  await expect(page.getByTestId("career-save-status")).toContainText("旧存档已损坏");
  await expect(page.getByTestId("career-home-screen")).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), storageKey)).toBeNull();
});
