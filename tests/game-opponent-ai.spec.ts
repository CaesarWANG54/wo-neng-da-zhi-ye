import { expect, test, type Locator, type Page } from "@playwright/test";

const awayPlayerIds = ["a7", "a8", "a9", "a11", "a23"];
const opponentOutcomeKinds = new Set([
  "AI_TURNOVER",
  "AI_SHOT_MISSED",
  "AI_SHOT_BLOCKED",
  "AI_OFFENSIVE_REBOUND",
  "MADE_BASKET",
]);

async function openDefenseFixture(page: Page) {
  await page.goto("/?qa=defense");
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
  await page.clock.runFor(80);
  await expect(page.getByTestId("ai-intent")).toBeVisible();
}

async function logicalPositions(page: Page, playerIds = awayPlayerIds) {
  return Object.fromEntries(
    await Promise.all(
      playerIds.map(async (id) => {
        const token = page.getByTestId(`court-token-${id}`);
        return [
          id,
          {
            x: Number(await token.getAttribute("data-x")),
            y: Number(await token.getAttribute("data-y")),
          },
        ] as const;
      }),
    ),
  );
}

function distance(first: { x: number; y: number }, second: { x: number; y: number }) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

async function advanceUntil(
  page: Page,
  predicate: () => Promise<boolean>,
  maximumMs: number,
  stepMs = 100,
) {
  for (let elapsed = 0; elapsed < maximumMs; elapsed += stepMs) {
    await page.clock.runFor(stepMs);
    if (await predicate()) return;
  }
  throw new Error(`Condition was not reached within ${maximumMs}ms of simulated match time`);
}

async function expectInside(inner: Locator, outer: Locator) {
  const [innerBox, outerBox] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);
  expect(innerBox).not.toBeNull();
  expect(outerBox).not.toBeNull();
  expect(innerBox!.x).toBeGreaterThanOrEqual(outerBox!.x - 1);
  expect(innerBox!.y).toBeGreaterThanOrEqual(outerBox!.y - 1);
  expect(innerBox!.x + innerBox!.width).toBeLessThanOrEqual(outerBox!.x + outerBox!.width + 1);
  expect(innerBox!.y + innerBox!.height).toBeLessThanOrEqual(outerBox!.y + outerBox!.height + 1);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
});

test("runs a visible multi-node opponent possession to an automatic outcome without input", async ({ page }) => {
  await openDefenseFixture(page);
  const game = page.getByTestId("game-screen");

  await expect(game).not.toHaveAttribute("data-ai-play", "");
  await expect(game).not.toHaveAttribute("data-ai-stage", "");
  await expect(game).not.toHaveAttribute("data-ai-action", "");
  await expect(page.getByTestId("ai-intent")).toContainText(/.+/);

  const initialToken = await game.getAttribute("data-ai-decision-token");
  expect(initialToken).toBeTruthy();
  const seenTokens = new Set<string>([initialToken!]);
  const seenStages = new Set<string>([await game.getAttribute("data-ai-stage") ?? ""]);
  let outcomeKind = "";

  await advanceUntil(page, async () => {
    const token = await game.getAttribute("data-ai-decision-token");
    const stage = await game.getAttribute("data-ai-stage");
    if (token) seenTokens.add(token);
    if (stage) seenStages.add(stage);
    outcomeKind = await game.getAttribute("data-last-event-kind") ?? "";
    return opponentOutcomeKinds.has(outcomeKind);
  }, 12_000);

  expect(opponentOutcomeKinds.has(outcomeKind)).toBe(true);
  expect(seenTokens.size).toBeGreaterThanOrEqual(2);
  expect(seenStages.size).toBeGreaterThanOrEqual(2);
  expect(await game.getAttribute("data-ai-decision-token")).not.toBe(initialToken);
  await expect(game).toHaveAttribute("data-controlled-player-id", "h1");
});

test("lets contest register inside the shot-preview window without forcing an instant result", async ({ page }) => {
  await openDefenseFixture(page);
  const game = page.getByTestId("game-screen");

  await advanceUntil(
    page,
    async () => (await game.getAttribute("data-ai-stage")) === "SHOT_PREP",
    8_000,
  );
  await expect(page.getByTestId("ai-intent")).toContainText("出手预告");

  const tokenBefore = await game.getAttribute("data-ai-decision-token");
  const phaseBefore = await game.getAttribute("data-phase");
  const homeScoreBefore = await page.getByTestId("home-score").textContent();
  const awayScoreBefore = await page.getByTestId("away-score").textContent();
  const decisionWindowBefore = Number(await game.getAttribute("data-ai-window-ms"));
  expect(decisionWindowBefore).toBeGreaterThan(0);

  await page.getByTestId("action-contest").click();

  await expect(game).toHaveAttribute("data-ai-response", "CONTEST");
  await expect(game).toHaveAttribute("data-ai-stage", "SHOT_PREP");
  await expect(game).toHaveAttribute("data-ai-decision-token", tokenBefore ?? "");
  await expect(game).toHaveAttribute("data-phase", phaseBefore ?? "");
  await expect(game).toHaveAttribute("data-last-event-kind", /CONTEST_(READY|CLOSEOUT)/);
  await expect(page.getByTestId("home-score")).toHaveText(homeScoreBefore ?? "");
  await expect(page.getByTestId("away-score")).toHaveText(awayScoreBefore ?? "");
  expect(Number(await game.getAttribute("data-ai-window-ms"))).toBeGreaterThan(0);
});

test("moves at least three opponent pieces while preserving the single thin h1 control ring", async ({ page }) => {
  await openDefenseFixture(page);
  const game = page.getByTestId("game-screen");
  const before = await logicalPositions(page);

  await page.clock.runFor(850);
  const after = await logicalPositions(page);
  const moved = awayPlayerIds.filter((id) => distance(before[id], after[id]) > 0.45);
  expect(moved.length).toBeGreaterThanOrEqual(3);

  await expect(game).toHaveAttribute("data-controlled-player-id", "h1");
  await expect(page.locator(".court-token.controlled")).toHaveCount(1);
  await expect(page.locator(".court-token.controlled")).toHaveAttribute("data-player-id", "h1");
  const ring = await page.getByTestId("court-token-h1").evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    return {
      color: style.borderTopColor,
      radius: style.borderRadius,
      width: Number.parseFloat(style.borderTopWidth),
      outline: style.outlineStyle,
    };
  });
  expect(ring.color).toBe("rgb(211, 52, 46)");
  expect(ring.radius).toBe("50%");
  expect(ring.width).toBeGreaterThanOrEqual(1);
  expect(ring.width).toBeLessThanOrEqual(1.5);
  expect(ring.outline).toBe("none");
});

test("keeps AI intent, score, shot clock and all five defensive actions visible on iPhone and Pixel", async ({ page }) => {
  await openDefenseFixture(page);

  for (const device of ["iphone", "pixel-10"] as const) {
    if (device === "pixel-10") {
      await page.getByTestId("device-picker").click();
      await page.getByTestId("device-option-pixel-10").click();
      await page.clock.runFor(80);
    }

    const screen = page.getByTestId("device-screen");
    await expect(page.getByTestId("phone-frame")).toHaveAttribute("data-device", device);
    await expect(screen).toHaveAttribute("data-device", device);
    await expect(page.getByTestId("ai-intent")).toBeVisible();
    await expect(page.getByTestId("ai-intent")).toContainText(/.+/);
    await expect(page.getByTestId("scoreboard")).toBeVisible();
    await expect(page.getByTestId("home-score")).toBeVisible();
    await expect(page.getByTestId("away-score")).toBeVisible();
    await expect(page.getByTestId("shot-clock")).toBeVisible();
    await expect(page.getByTestId("shot-clock")).not.toHaveText("");
    await expect(page.getByTestId("action-rail")).toBeVisible();
    const buttons = page.locator(".action-rail > button");
    await expect(buttons).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) await expect(buttons.nth(index)).toBeVisible();

    await expectInside(page.getByTestId("scoreboard"), screen);
    // The semantic AI span intentionally uses `display: contents`; its visible
    // paper-note parent owns the rendered box inside the court.
    await expectInside(page.getByTestId("phase-status"), screen);
    await expectInside(page.getByTestId("action-rail"), screen);
  }
});
