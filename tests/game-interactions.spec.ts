import { expect, test } from "@playwright/test";

test("animates a pass over metric court distance instead of teleporting", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
  await page.goto("/?qa=game");
  const ball = page.locator(".ball-dot");
  await expect(ball).toHaveAttribute("data-ball-state", "CONTROLLED");

  await page.getByTestId("action-pass").click();
  await page.clock.runFor(280);
  await expect(ball).toHaveAttribute("data-ball-state", "PASS");
  const distance = Number(await ball.getAttribute("data-pass-distance-m"));
  const speed = Number(await ball.getAttribute("data-pass-speed-mps"));
  const firstProgress = Number(await ball.getAttribute("data-pass-progress"));
  expect(distance).toBeGreaterThan(1);
  expect(speed).toBeGreaterThan(8);
  expect(speed).toBeLessThan(13);

  await page.clock.runFor(100);
  const secondProgress = Number(await ball.getAttribute("data-pass-progress"));
  expect(secondProgress).toBeGreaterThan(firstProgress);
  await page.clock.runFor(2_000);
  await expect(ball).toHaveAttribute("data-ball-state", "CONTROLLED");
});

for (const action of ["contain", "contest", "switch", "zone"] as const) {
  test(`gives ${action} an immediate persistent defensive response`, async ({ page }) => {
    await page.goto("/?qa=defense");
    const game = page.getByTestId("game-screen");
    await expect(game).not.toHaveAttribute("data-ai-play", "");
    const button = page.getByTestId(`action-${action}`);
    await button.click();
    await expect(button).toHaveAttribute("data-feedback", "committed");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("defense-feedback")).toBeVisible();
    await expect(game).not.toHaveAttribute("data-ai-response", "");
  });
}

test("makes the steal button resolve to pressure, a live-ball win, or a deflection", async ({ page }) => {
  await page.goto("/?qa=defense");
  const game = page.getByTestId("game-screen");
  await expect(game).not.toHaveAttribute("data-ai-play", "");
  await page.getByTestId("action-steal").click();
  const response = await game.getAttribute("data-ai-response");
  const phase = await game.getAttribute("data-phase");
  const lastKind = await game.getAttribute("data-last-event-kind");
  expect(Boolean(response) || phase !== "SET_OFFENSE" || ["STEAL", "OUT_OF_BOUNDS"].includes(lastKind ?? "")).toBe(true);
});
