import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function openGame(page: Page, path = "/?qa=game") {
  await page.goto(path);
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
});

test("runs one real clock, freezes it in pause, and resumes without catch-up", async ({ page }) => {
  await openGame(page);
  const initialClock = await page.getByTestId("game-clock").textContent();
  const initialShotClock = Number(await page.getByTestId("shot-clock").textContent());
  expect(initialClock).toMatch(/^0[23]:\d{2}$/);
  expect(initialShotClock).toBeGreaterThan(20);
  expect(initialShotClock).toBeLessThanOrEqual(24);

  await page.clock.runFor(1_100);
  const runningGameClock = await page.getByTestId("game-clock").textContent();
  const runningShotClock = await page.getByTestId("shot-clock").textContent();
  expect(runningGameClock).not.toBe("03:00");
  expect(runningShotClock).not.toBe("24");

  await page.getByRole("button", { name: /暂停/ }).click();
  const pausedGameClock = await page.getByTestId("game-clock").textContent();
  const pausedShotClock = await page.getByTestId("shot-clock").textContent();
  await page.clock.runFor(5_000);
  await expect(page.getByTestId("game-clock")).toHaveText(pausedGameClock ?? "");
  await expect(page.getByTestId("shot-clock")).toHaveText(pausedShotClock ?? "");

  await page.getByRole("button", { name: "继续比赛" }).click();
  await page.clock.runFor(1_000);
  expect(await page.getByTestId("game-clock").textContent()).not.toBe(pausedGameClock);
  expect(await page.getByTestId("shot-clock").textContent()).not.toBe(pausedShotClock);
});

test("freezes elapsed time while the document is hidden", async ({ page }) => {
  await openGame(page);
  await page.clock.runFor(200);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const gameClock = await page.getByTestId("game-clock").textContent();
  const shotClock = await page.getByTestId("shot-clock").textContent();
  await page.clock.runFor(3_000);
  await expect(page.getByTestId("game-clock")).toHaveText(gameClock ?? "");
  await expect(page.getByTestId("shot-clock")).toHaveText(shotClock ?? "");

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(1_000);
  expect(await page.getByTestId("shot-clock").textContent()).not.toBe(shotClock);
});

test("shows the complete made-basket dead-ball, inbound, advance and half-court sequence", async ({ page }) => {
  await openGame(page, "/?qa=made");
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "DEAD_BALL");
  await expect(page.getByTestId("dead-ball-overlay")).toBeVisible();
  await expect(page.locator(".action-rail > button:disabled")).toHaveCount(5);
  await expect(page.getByTestId("home-score")).toHaveText("62");

  await page.clock.runFor(700);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "INBOUND_READY");
  await expect(page.getByTestId("inbound-indicator")).toBeVisible();

  await page.clock.runFor(800);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "BACKCOURT_ADVANCE");
  await expect(page.getByTestId("phase-status")).toContainText("推进前场");

  await page.clock.runFor(1_250);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "SET_OFFENSE");
  expect(Number(await page.getByTestId("court-token-a7").getAttribute("data-x"))).toBeGreaterThanOrEqual(50);
  await expect(page.getByTestId("home-score")).toHaveText("62");
  await expect(page.locator(".action-rail > button:enabled")).toHaveCount(5);
});

test("keeps possession and preserves the unused clock after an ordinary defensive deflection", async ({ page }) => {
  await openGame(page, "/?qa=out");
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "DEAD_BALL");
  await expect(page.getByTestId("phase-status")).toContainText("防守碰出");
  await expect(page.getByTestId("out-of-bounds-indicator")).toBeVisible();
  await expect(page.getByTestId("shot-clock")).toHaveText("13");

  await page.clock.runFor(1_410);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "SET_OFFENSE");
  expect(Number(await page.getByTestId("shot-clock").textContent())).toBeGreaterThanOrEqual(12);
  await expect(page.getByText("我方球权")).toBeVisible();
});

test("keeps fastbreak controls active and falls back to half court without a reset", async ({ page }) => {
  await openGame(page, "/?qa=fastbreak");
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "FASTBREAK");
  await expect(page.getByTestId("fastbreak-indicator")).toBeVisible();
  await expect(page.locator(".action-rail > button:enabled")).toHaveCount(5);

  await page.clock.runFor(6_100);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "SET_OFFENSE");
  await expect(page.getByTestId("shot-clock")).not.toHaveText("24");
  await expect(page.getByTestId("phase-status")).toContainText("快攻机会被化解");
});

test("routes a tied fourth quarter through an overtime break and tip-off", async ({ page }) => {
  await openGame(page, "/?qa=overtime");
  await page.clock.runFor(400);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "PERIOD_END");
  await expect(page.getByTestId("period-end-banner")).toContainText("准备进入加时");
  await expect(page.getByTestId("game-over-dialog")).toHaveCount(0);

  await page.clock.runFor(1_000);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "TIP_OFF");
  await expect(page.getByTestId("period-label")).toHaveText("加时");

  await page.clock.runFor(1_000);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "SET_OFFENSE");
  await expect(page.getByTestId("game-clock")).not.toHaveText("00:00.0");
});

test("locks a non-tied final exactly once and can start a fresh match", async ({ page }) => {
  await openGame(page, "/?qa=final");
  await page.clock.runFor(400);
  const dialog = page.getByTestId("game-over-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("比赛结束");
  await expect(page.getByTestId("settlement-home-score")).toHaveText("61");
  await expect(page.getByTestId("settlement-away-score")).toHaveText("60");
  await expect(page.locator(".action-rail > button:disabled")).toHaveCount(5);

  await page.clock.runFor(10_000);
  await expect(page.getByTestId("settlement-home-score")).toHaveText("61");
  await expect(page.getByTestId("settlement-away-score")).toHaveText("60");
  await page.getByRole("button", { name: "重新比赛" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "SET_OFFENSE");
  await expect(page.getByTestId("game-clock")).not.toHaveText("00:00.0");
});

test("keeps the final dialog and five fixed slots inside Pixel landscape safe areas", async ({ page }) => {
  await openGame(page, "/?qa=final");
  await page.getByTestId("device-picker").click();
  await page.getByTestId("device-option-pixel-10").click();
  await page.clock.runFor(400);

  const dialog = await page.getByTestId("game-over-dialog").boundingBox();
  const screen = await page.getByTestId("game-screen").boundingBox();
  const rail = await page.getByTestId("action-rail").boundingBox();
  expect(dialog).not.toBeNull();
  expect(screen).not.toBeNull();
  expect(rail).not.toBeNull();
  expect(dialog!.x).toBeGreaterThanOrEqual(screen!.x);
  expect(dialog!.y).toBeGreaterThanOrEqual(screen!.y);
  expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(screen!.x + screen!.width);
  expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(screen!.y + screen!.height);
  await expect(page.locator(".action-rail > button")).toHaveCount(5);
});
