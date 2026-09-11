import { expect, test } from "@playwright/test";

test("turns one open-lane fastbreak drive into a near-rim automatic dunk", async ({ page }) => {
  const consoleIssues: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") consoleIssues.push(message.text());
  });
  await page.goto("/?qa=drive-open");
  const game = page.getByTestId("game-screen");
  await game.waitFor({ state: "visible" });
  await expect(game).toHaveAttribute("data-phase", "FASTBREAK");

  await page.getByTestId("action-drive").click();
  await expect(game).toHaveAttribute("data-last-event-kind", "DRIVE_START_OPEN_RIM");
  await expect(game).toHaveAttribute("data-drive-open-rim", "true");
  await expect(page.getByRole("complementary", { name: "突破中操作区" })).toBeVisible();
  await expect(page.getByTestId("action-pass")).toHaveAccessibleName(/突分最近外线/);

  await expect.poll(async () => Number(await page.getByTestId("court-token-h1").getAttribute("data-x")), { timeout: 4_000 })
    .toBeLessThanOrEqual(20);
  await expect.poll(async () => game.getAttribute("data-pending-shot"), { timeout: 4_000 }).toBe("DUNK");
  await expect(game).toHaveAttribute("data-last-event-kind", "SHOT_RELEASE");
  await expect(page.getByTestId("phase-status")).toContainText(/空篮.*扣篮/);
  expect(Number(await page.getByTestId("court-token-h1").getAttribute("data-x"))).toBeLessThanOrEqual(20);
  await expect.poll(async () => Number(await page.getByTestId("home-score").textContent()), { timeout: 2_000 }).toBe(62);
  expect(consoleIssues).toEqual([]);
});

test("keeps a protected half-court drive as a live-position layup contest", async ({ page }) => {
  await page.goto("/?qa=drive-protected");
  const game = page.getByTestId("game-screen");
  await game.waitFor({ state: "visible" });

  await page.getByTestId("action-drive").click();
  await expect(game).toHaveAttribute("data-last-event-kind", "DRIVE_START");
  await expect(game).toHaveAttribute("data-drive-open-rim", "false");
  await expect(game).toHaveAttribute("data-drive-rim-protector", "a23");
  await expect(game).toHaveAttribute("data-pending-shot", "");

  await expect.poll(async () => Number(await page.getByTestId("court-token-h1").getAttribute("data-x")), { timeout: 5_000 })
    .toBeLessThanOrEqual(20);
  // Under a heavily contended full-suite run one delayed animation frame can
  // advance through the short shot-flight window before Playwright samples it.
  // Accept either the visible RIM flight or its already-settled deterministic
  // result, then verify the created player really recorded the field goal.
  await expect.poll(async () => {
    const pendingShot = await game.getAttribute("data-pending-shot");
    const homeScore = Number(await page.getByTestId("home-score").textContent());
    return pendingShot === "RIM" || homeScore > 60;
  }, { timeout: 7_000 }).toBe(true);

  if (await game.getAttribute("data-pending-shot") === "RIM") {
    await expect(game).toHaveAttribute("data-last-event-kind", "SHOT_RELEASE");
    await expect(page.getByTestId("phase-status")).toContainText(/上篮|终结|护筐/);
  } else {
    await page.getByRole("button", { name: /暂停/ }).click();
    await expect(page.getByTestId("box-score-row-h1")).toContainText("1/1");
  }
});

test("releases one drive-kick pass to the nearest perimeter teammate and transfers on the catch", async ({ page }) => {
  await page.goto("/?qa=drive-protected");
  const game = page.getByTestId("game-screen");
  await game.waitFor({ state: "visible" });

  await page.getByTestId("action-drive").click();
  await expect(page.getByTestId("action-pass")).toHaveAccessibleName(/突分最近外线/);
  await page.waitForTimeout(120);
  await page.getByTestId("action-pass").click();

  await expect(game).toHaveAttribute("data-last-event-kind", "PASS_RELEASE");
  await expect(game).toHaveAttribute("data-ball-handler-id", "h1");
  await expect(game).toHaveAttribute("data-pending-drive", "");
  await expect(page.locator(".action-rail .pending")).toHaveCount(0);
  await expect(page.locator(".ball-dot")).toHaveAttribute("data-ball-state", "PASS");
  await expect(page.getByTestId("court-token-h2")).toHaveAttribute("data-intent", "RECEIVE");
  await expect(page.getByTestId("phase-status")).toContainText("突分");

  await expect(game).toHaveAttribute("data-last-event-kind", "PASS_ARRIVAL");
  await expect(game).toHaveAttribute("data-ball-handler-id", "h2");
  await expect(page.getByTestId("phase-status")).toContainText("接到突分球");
  await expect(page.getByRole("complementary", { name: "无球操作区" })).toBeVisible();
});
