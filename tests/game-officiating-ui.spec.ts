import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
  await page.goto("/?qa=free-throw");
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
});

test("shows an automatic free-throw sequence with legal lane roles and frozen clocks", async ({ page }) => {
  const game = page.getByTestId("game-screen");
  await expect(game).toHaveAttribute("data-phase", "FREE_THROW");
  await expect(game).toHaveAttribute("data-free-throw-shooter", "h3");
  await expect(game).toHaveAttribute("data-free-throw-reason", "SHOOTING_FOUL");
  await expect(game).toHaveAttribute("data-free-throw-current", "1");
  await expect(game).toHaveAttribute("data-free-throw-total", "2");
  await expect(page.getByTestId("shot-clock")).toHaveText("—");
  await expect(page.getByTestId("free-throw-banner")).toContainText("投篮犯规");
  await expect(page.getByTestId("free-throw-banner")).toContainText("第1/2罚");

  await expect(page.locator('[data-free-throw-role="SHOOTER"]')).toHaveCount(1);
  await expect(page.locator('[data-free-throw-role="LANE_DEFENSE"]')).toHaveCount(3);
  await expect(page.locator('[data-free-throw-role="LANE_OFFENSE"]')).toHaveCount(2);
  await expect(page.locator('[data-free-throw-role="PERIMETER"]')).toHaveCount(4);
  await expect(page.getByTestId("court-token-h3")).toHaveAttribute("data-free-throw-shooter", "true");
  await expect(page.getByTestId("court-token-h1")).toHaveAttribute("data-controlled", "true");
  await expect(page.getByTestId("court-token-h1")).toHaveAttribute("data-free-throw-shooter", "false");

  const gameClock = await page.getByTestId("game-clock").textContent();
  await page.clock.runFor(900);
  await expect(page.getByTestId("game-clock")).toHaveText(gameClock ?? "");
  await expect(page.getByTestId("action-rail")).toHaveAttribute("data-controls-locked", "true");
  await expect(page.getByTestId("action-rail")).toHaveAttribute("data-lock-reason", "自动罚球");
  await expect(page.locator(".action-rail > button:disabled")).toHaveCount(5);
  await expect(page.locator(".action-rail > button").first()).toContainText("无需操作");
});

test("pause shows five-player box scores for both teams without ratings", async ({ page }) => {
  await page.getByRole("button", { name: /暂停/ }).click();
  const homeTable = page.getByTestId("box-score-table-home");
  await expect(homeTable).toBeVisible();
  await expect(homeTable).toHaveAttribute("data-player-count", "5");
  await expect(homeTable.locator("tbody tr")).toHaveCount(5);
  await expect(homeTable.locator("thead")).toContainText("得分");
  await expect(homeTable.locator("thead")).toContainText("犯规");
  await expect(homeTable.locator("thead")).toContainText("投篮");
  await expect(homeTable.locator("thead")).toContainText("三分");
  await expect(homeTable.locator("thead")).toContainText("罚球");

  await page.getByRole("tab", { name: "对方5人" }).click();
  const awayTable = page.getByTestId("box-score-table-away");
  await expect(awayTable).toBeVisible();
  await expect(awayTable).toHaveAttribute("data-player-count", "5");
  await expect(awayTable.locator("tbody tr")).toHaveCount(5);
});

test("shows a defensive goaltend as an awarded basket and referee restart", async ({ page }) => {
  await page.goto("/?qa=goaltend");
  const game = page.getByTestId("game-screen");
  await expect(game).toHaveAttribute("data-official-call", "DEFENSIVE_GOALTENDING");
  await expect(game).toHaveAttribute("data-official-offender", "a9");
  await expect(game).toHaveAttribute("data-phase", "DEAD_BALL");
  await expect(page.getByTestId("dead-ball-overlay")).toContainText("防守干扰球");
  await expect(page.getByTestId("scoreboard")).toContainText("63");
});
