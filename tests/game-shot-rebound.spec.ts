import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
});

test("keeps a released shot visibly airborne without settling score or controls early", async ({ page }) => {
  await page.goto("/?qa=shot");

  const game = page.getByTestId("game-screen");
  const ball = page.locator(".ball-dot");
  const initialHomeScore = await page.getByTestId("home-score").textContent();
  const initialAwayScore = await page.getByTestId("away-score").textContent();

  await expect(game).toHaveAttribute("data-phase", "SHOT_FLIGHT");
  await expect(game).toHaveAttribute("data-pending-shot", "THREE");
  await expect(ball).toHaveAttribute("data-ball-state", "SHOT");
  await expect(page.locator(".action-rail > button:disabled")).toHaveCount(5);

  const releaseHeight = Number(await ball.getAttribute("data-ball-height-m"));
  const releaseProgress = Number(await ball.getAttribute("data-pass-progress"));
  expect(releaseHeight).toBeGreaterThan(2);
  expect(releaseProgress).toBeGreaterThanOrEqual(0);

  await page.clock.runFor(250);

  const airborneHeight = Number(await ball.getAttribute("data-ball-height-m"));
  const airborneProgress = Number(await ball.getAttribute("data-pass-progress"));
  expect(airborneHeight).toBeGreaterThan(releaseHeight);
  expect(airborneProgress).toBeGreaterThan(releaseProgress);
  await expect(ball).toHaveAccessibleName(/篮球，高度\d+\.\d米/);
  await expect(page.getByTestId("home-score")).toHaveText(initialHomeScore ?? "");
  await expect(page.getByTestId("away-score")).toHaveText(initialAwayScore ?? "");
  await expect(page.locator(".action-rail > button:disabled")).toHaveCount(5);
});

test("shows the rebound trajectory and resolves into a second chance or transition", async ({ page }) => {
  await page.goto("/?qa=rebound");

  const game = page.getByTestId("game-screen");
  const ball = page.locator(".ball-dot");

  await expect(game).toHaveAttribute("data-phase", "REBOUND");
  await expect(game).not.toHaveAttribute("data-rebound-winner", "");
  await expect(game).not.toHaveAttribute("data-rebound-collision", "");
  const collision = await game.getAttribute("data-rebound-collision");
  await expect(ball).toHaveAttribute("data-ball-state", /^(RIM_REBOUND|LOOSE_BALL)$/);
  await expect(page.getByTestId("shot-clock")).toHaveText("—");
  await expect(page.locator(".ball-height-label")).toBeVisible();
  await expect(page.locator(".action-rail > button:disabled")).toHaveCount(5);

  const initialHeight = Number(await ball.getAttribute("data-ball-height-m"));
  expect(initialHeight).toBeGreaterThan(1);
  await page.clock.runFor(180);
  const contestedHeight = Number(await ball.getAttribute("data-ball-height-m"));
  expect(contestedHeight).not.toBe(initialHeight);

  await page.clock.runFor(2_000);

  const resolvedPhase = await game.getAttribute("data-phase");
  const offensive = await game.getAttribute("data-rebound-offensive");
  expect(["SECOND_DECISION", "FASTBREAK", "SET_OFFENSE"]).toContain(resolvedPhase);
  await expect(game).not.toHaveAttribute("data-rebound-winner", "");
  await expect(game).not.toHaveAttribute("data-rebound-collision", "");

  if (offensive === "true") {
    expect(["SECOND_DECISION", "SET_OFFENSE"]).toContain(resolvedPhase);
    expect(Number(await game.getAttribute("data-second-chance-count"))).toBeGreaterThan(0);
    const shotClock = Number(await page.getByTestId("shot-clock").textContent());
    expect(shotClock).toBeGreaterThan(0);
    expect(shotClock).toBeLessThanOrEqual(collision === "AIRBALL" ? 24 : 14);
  } else {
    expect(["FASTBREAK", "SET_OFFENSE"]).toContain(resolvedPhase);
    await expect(page.getByTestId("phase-status")).toContainText(/快攻|推进|阵地|篮板/);
  }
});
