import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Clock / input fairness (P1) browser regressions.
 *
 * The authoritative match clock must be independent of the single/double-tap
 * arbitration: a pending double-tap decision is ordinary decision time, so
 * the game clock and shot clock keep running while it is open. Rapid
 * alternating taps must never freeze or extend a possession, and a queued
 * action must never fire after possession, phase or ball handler changed.
 */
async function openGame(page: Page, path = "/?qa=game") {
  await page.goto(path);
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
});

test("keeps both clocks running while a double-tap decision is pending", async ({ page }) => {
  await openGame(page);
  const screen = page.getByTestId("game-screen");
  await expect(screen).toHaveAttribute("data-phase", "SET_OFFENSE");

  const readSeconds = async (selector: string, attribute: string) =>
    Number((await page.getByTestId(selector).getAttribute(attribute)) ?? "0");

  const gameBefore = await readSeconds("scoreboard", "data-game-seconds");
  const shotBefore = await readSeconds("scoreboard", "data-shot-clock");

  // A single tap arms the 260ms double-tap decision.
  await page.getByTestId("action-pass").click();
  await expect(screen).toHaveAttribute("data-pending-tap", "pass");
  // Arbitration is not a pause: the simulation must not report as paused.
  await expect(screen).toHaveAttribute("data-simulation-paused", "false");

  // While the decision window is open both clocks keep draining.
  await page.clock.runFor(180);
  const gameDuring = await readSeconds("scoreboard", "data-game-seconds");
  const shotDuring = await readSeconds("scoreboard", "data-shot-clock");
  expect(shotDuring).toBeLessThan(shotBefore);
  expect(gameDuring).toBeLessThan(gameBefore);
  await expect(screen).toHaveAttribute("data-pending-tap", "pass");

  // The window expires and commits the single action; nothing is left queued.
  await page.clock.runFor(200);
  await expect(screen).toHaveAttribute("data-pending-tap", "");
  const shotAfter = await readSeconds("scoreboard", "data-shot-clock");
  expect(shotAfter).toBeLessThan(shotBefore - 0.3);
});

test("rapid alternating pass/shoot taps cannot freeze or extend the shot clock", async ({ page }) => {
  await openGame(page);
  const screen = page.getByTestId("game-screen");
  const scoreboard = page.getByTestId("scoreboard");
  const readShot = async () => Number((await scoreboard.getAttribute("data-shot-clock")) ?? "0");
  const shotBefore = await readShot();

  // Eight alternating taps, one every 150ms: the arbitration slot is replaced
  // continuously and must never pause the clock underneath it.
  for (let index = 0; index < 8; index += 1) {
    await page.getByTestId(index % 2 === 0 ? "action-pass" : "action-shoot").click();
    await page.clock.runFor(150);
    await expect(screen).toHaveAttribute("data-simulation-paused", "false");
  }

  // ~1.2s of real decision time must have drained the shot clock, no matter
  // how the arbitration resolves.
  const shotAfterSpam = await readShot();
  expect(shotAfterSpam).toBeLessThan(shotBefore - 1.0);

  // The final pending decision commits exactly one owned action; the pending
  // slot empties and the action belongs to the home handler h1.
  await page.clock.runFor(350);
  await expect(screen).toHaveAttribute("data-pending-tap", "");
  expect(["SET_OFFENSE", "SECOND_DECISION", "SHOT_FLIGHT", "FASTBREAK"]).toContain(
    (await screen.getAttribute("data-phase")) ?? "",
  );
  await expect(screen).toHaveAttribute("data-possession", "home");
});

test("a queued tap cannot hold off the shot-clock violation or fire into the new possession", async ({ page }) => {
  // Live home possession with 0.20s left: the violation happens inside a
  // single 260ms arbitration window.
  await openGame(page, "/?qa=tap-expiry");
  const screen = page.getByTestId("game-screen");
  await expect(screen).toHaveAttribute("data-phase", "SET_OFFENSE");
  await expect(screen).toHaveAttribute("data-possession", "home");

  // Stop wall time after mount, then drain the fixture to exactly the narrow
  // pre-violation window. This keeps slow CI startup out of the interaction
  // contract while preserving the 0.20s-vs-260ms ordering under test.
  // Pause at a near-future instant rather than replaying a just-read timestamp:
  // the clock can advance between two protocol messages on a busy runner.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  const mountedShotClock = Number(await page.getByTestId("scoreboard").getAttribute("data-shot-clock"));
  expect(mountedShotClock).toBeGreaterThan(0.26);
  await page.clock.runFor(Math.max(0, Math.round((mountedShotClock - 0.15) * 1_000)));
  let preparedShotClock = Number(await page.getByTestId("scoreboard").getAttribute("data-shot-clock"));
  // rAF advances the authoritative engine in bounded frames, so a single
  // runFor can stop one frame above the target. Advance explicit 50ms frames
  // while paused instead of polling a clock that cannot move on its own.
  for (let frame = 0; frame < 3 && preparedShotClock > 0.2; frame += 1) {
    await page.clock.runFor(50);
    preparedShotClock = Number(await page.getByTestId("scoreboard").getAttribute("data-shot-clock"));
  }
  expect(preparedShotClock).toBeLessThanOrEqual(0.2);
  expect(preparedShotClock).toBeGreaterThan(0);
  await expect(screen).toHaveAttribute("data-phase", "SET_OFFENSE");

  // One tap queues a pending pass decision whose deadline outlives the clock.
  await page.getByTestId("action-pass").click();
  await expect(screen).toHaveAttribute("data-pending-tap", "pass");

  // The shot clock expires first: violation, dead ball, away possession.
  await page.clock.runFor(400);
  await expect(screen).toHaveAttribute("data-phase", "DEAD_BALL");
  await expect(screen).toHaveAttribute("data-possession", "away");
  await expect(screen).toHaveAttribute("data-last-event-kind", "SHOT_CLOCK_VIOLATION");
  await expect(page.getByTestId("dead-ball-overlay")).toBeVisible();

  // The stale queued action must never fire into the away possession.
  await page.clock.runFor(400);
  await expect(screen).toHaveAttribute("data-pending-tap", "");
  await expect(screen).toHaveAttribute("data-possession", "away");
  // Automatic restart events are allowed to advance the sequence here
  // (DEAD_BALL -> INBOUND_READY). What must stay absent is an owned home
  // action from the stale pass tap.
  await page.clock.runFor(300);
  await expect(screen).toHaveAttribute("data-pending-tap", "");
  await expect(screen).toHaveAttribute("data-possession", "away");
  await expect(screen).toHaveAttribute("data-action-owner", "");
  expect(["DEAD_BALL", "INBOUND_READY", "BACKCOURT_ADVANCE"]).toContain(
    (await screen.getAttribute("data-phase")) ?? "",
  );
});

test("input during pause, dead ball and free throw cannot queue or commit actions", async ({ page }) => {
  // Pause: the modal freezes the clock and swallows every action tap.
  await openGame(page);
  const screen = page.getByTestId("game-screen");
  await page.clock.runFor(120);
  await page.getByTestId("open-pause").click();
  await expect(screen).toHaveAttribute("data-simulation-paused", "true");
  // The modal backdrop physically blocks taps; a forced click proves the
  // JS-level guard also swallows actions while the pause is open.
  await page.getByTestId("action-pass").click({ force: true });
  await expect(screen).toHaveAttribute("data-pending-tap", "");
  const pausedSequence = await screen.getAttribute("data-event-sequence");
  await page.clock.runFor(300);
  expect(await screen.getAttribute("data-event-sequence")).toBe(pausedSequence);
  await page.getByRole("button", { name: "继续比赛" }).click();

  // Dead ball: every action is disabled and taps queue nothing.
  await page.goto("/?qa=made");
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "DEAD_BALL");
  await expect(page.locator(".action-rail > button:disabled")).toHaveCount(5);
  await page.getByTestId("action-pass").click({ force: true }).catch(() => undefined);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-pending-tap", "");
  const deadSequence = await page.getByTestId("game-screen").getAttribute("data-event-sequence");
  await page.clock.runFor(200);
  const automaticDeadSequence = await page.getByTestId("game-screen").getAttribute("data-event-sequence");
  expect(Number(automaticDeadSequence)).toBeGreaterThanOrEqual(Number(deadSequence));
  expect(["DEAD_BALL", "INBOUND_READY", "BACKCOURT_ADVANCE"]).toContain(
    await page.getByTestId("game-screen").getAttribute("data-phase"),
  );
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-pending-tap", "");

  // Free throw: automatic phase, no queued tap survives.
  await page.goto("/?qa=free-throw");
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "FREE_THROW");
  await page.getByTestId("action-shoot").click({ force: true }).catch(() => undefined);
  await page.getByTestId("action-pass").click({ force: true }).catch(() => undefined);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-pending-tap", "");
  const freeThrowSequence = await page.getByTestId("game-screen").getAttribute("data-event-sequence");
  await page.clock.runFor(300);
  const automaticSequence = await page.getByTestId("game-screen").getAttribute("data-event-sequence");
  expect(Number(automaticSequence)).toBeGreaterThanOrEqual(Number(freeThrowSequence));
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-pending-tap", "");
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-action-owner", "");
});
