import { expect, test, type Page } from "@playwright/test";

const ids = ["h1", "h2", "h3", "h4", "h5", "a7", "a8", "a9", "a11", "a23"];

async function positions(page: Page) {
  return Object.fromEntries(
    await Promise.all(
      ids.map(async (id) => {
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

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function visualCenter(page: Page, id: string) {
  const box = await page.getByTestId(`court-token-${id}`).boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?qa=game");
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
});

test("moves AI pieces on both teams while an uncommanded h1 remains user-owned", async ({ page }) => {
  const excursions = await page.evaluate(async (playerIds) => {
    const read = () => Object.fromEntries(playerIds.map((id) => {
      const token = document.querySelector<HTMLElement>(`[data-testid='court-token-${id}']`)!;
      return [id, { x: Number(token.dataset.x), y: Number(token.dataset.y) }];
    }));
    const initial = read();
    const maximum = Object.fromEntries(playerIds.map((id) => [id, 0]));
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const sample = (now: number) => {
        const current = read();
        for (const id of playerIds) {
          maximum[id] = Math.max(
            maximum[id],
            Math.hypot(current[id].x - initial[id].x, current[id].y - initial[id].y),
          );
        }
        if (now - started >= 1_200) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return maximum;
  }, ids);

  expect(excursions.h1).toBeLessThan(0.05);
  expect(["h2", "h3", "h4", "h5"].filter((id) => excursions[id] > 0.5).length).toBeGreaterThanOrEqual(3);
  expect(["a7", "a8", "a9", "a11", "a23"].filter((id) => excursions[id] > 0.5).length).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-controlled-player-id", "h1");
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-created-player-id", "h1");
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-created-player-on-court", "true");

  const court = await page.getByTestId("court-panel").boundingBox();
  expect(court).not.toBeNull();
  for (const id of ids) {
    const token = await page.getByTestId(`court-token-${id}`).boundingBox();
    expect(token).not.toBeNull();
    expect(token!.x).toBeGreaterThanOrEqual(court!.x - 1);
    expect(token!.y).toBeGreaterThanOrEqual(court!.y - 1);
    expect(token!.x + token!.width).toBeLessThanOrEqual(court!.x + court!.width + 1);
    expect(token!.y + token!.height).toBeLessThanOrEqual(court!.y + court!.height + 1);
  }
});

test("uses one thin red circular ring and never transfers control when another piece is inspected", async ({ page }) => {
  const controlled = page.getByTestId("court-token-h1");
  await expect(page.locator(".court-token.controlled")).toHaveCount(1);
  const ring = await controlled.evaluate((element) => {
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

  await page.getByTestId("court-token-h2").click({ force: true });
  await page.getByTestId("court-token-a7").click({ force: true });
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-controlled-player-id", "h1");
  await expect(page.locator(".court-token.controlled")).toHaveAttribute("data-player-id", "h1");

  const before = await positions(page);
  await page.getByTestId("action-drive").click();
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-action-owner", "h1");
  await expect(controlled).toHaveAttribute("data-intent", "DRIVE");
  await page.waitForTimeout(650);
  const after = await positions(page);
  expect(distance(before.h1, after.h1)).toBeGreaterThan(1);
});

test("runs a selected tactic as multi-player movement with defenders following", async ({ page }) => {
  const before = await positions(page);
  await page.getByTestId("action-tactic").click();
  await page.getByRole("menuitem", { name: /五外拉开/ }).click();
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-active-tactic", "FIVE_OUT");
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-action-owner", "h1");
  await page.waitForTimeout(1_150);
  const after = await positions(page);
  expect(["h1", "h2", "h3", "h4", "h5"].filter((id) => distance(before[id], after[id]) > 0.7).length).toBeGreaterThanOrEqual(4);
  expect(["a7", "a8", "a9", "a11", "a23"].filter((id) => distance(before[id], after[id]) > 0.7).length).toBeGreaterThanOrEqual(3);
});

test("gives off-ball spacing, switching and zone buttons visible persistent effects", async ({ page }) => {
  await page.goto("/?qa=offball");
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
  await expect(page.locator(".action-rail > button:enabled")).toHaveCount(5);
  const offBallBefore = await positions(page);
  await page.getByTestId("action-spot").click();
  await expect(page.getByTestId("court-token-h1")).toHaveAttribute("data-intent", "SPACE");
  await page.waitForTimeout(650);
  expect(distance(offBallBefore.h1, (await positions(page)).h1)).toBeGreaterThan(1);

  await page.goto("/?qa=defense");
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
  await expect(page.locator(".action-rail > button:enabled")).toHaveCount(5);
  await page.getByTestId("action-zone").click();
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-defense-scheme", "ZONE_2_3");
  await expect(page.getByTestId("court-token-h1")).toHaveAttribute("data-intent", "ZONE_TOP");
  const zoneBefore = await positions(page);
  await page.waitForTimeout(750);
  const zoneAfter = await positions(page);
  expect(["h1", "h2", "h3", "h4", "h5"].filter((id) => distance(zoneBefore[id], zoneAfter[id]) > 0.5).length).toBeGreaterThanOrEqual(4);

  const matchupBeforeSwitch = await page.getByTestId("game-screen").getAttribute("data-controlled-matchup");
  await page.getByTestId("action-switch").click();
  await expect.poll(() => page.getByTestId("game-screen").getAttribute("data-controlled-matchup"))
    .not.toBe(matchupBeforeSwitch);
  expect(["a7", "a8", "a9", "a11", "a23"]).toContain(
    await page.getByTestId("game-screen").getAttribute("data-controlled-matchup"),
  );
  await expect(page.getByTestId("court-token-h1")).toHaveAttribute("data-intent", "SWITCH");
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-action-owner", "h1");
});

test("freezes both clock and movement while pause is open", async ({ page }) => {
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /暂停/ }).click();
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-simulation-paused", "true");
  await page.waitForTimeout(90);
  const paused = await positions(page);
  const pausedVisual = { h2: await visualCenter(page, "h2"), a7: await visualCenter(page, "a7") };
  const clock = await page.getByTestId("game-clock").textContent();
  await page.waitForTimeout(550);
  expect(await positions(page)).toEqual(paused);
  expect(distance(pausedVisual.h2, await visualCenter(page, "h2"))).toBeLessThanOrEqual(0.75);
  expect(distance(pausedVisual.a7, await visualCenter(page, "a7"))).toBeLessThanOrEqual(0.75);
  await expect(page.getByTestId("game-clock")).toHaveText(clock ?? "");

  const beforeResume = await visualCenter(page, "h2");
  await page.getByRole("button", { name: "继续比赛" }).click();
  await page.waitForTimeout(100);
  expect(distance(beforeResume, await visualCenter(page, "h2"))).toBeLessThanOrEqual(6);
});

test("renders 20Hz smooth movement with bounded frame steps and no severe overlap", async ({ page }) => {
  const consoleIssues: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") consoleIssues.push(message.text());
  });
  await page.waitForTimeout(350);
  const sample = await page.evaluate(async (playerIds) => {
    const screen = document.querySelector<HTMLElement>("[data-testid='game-screen']")!;
    const centers = () => playerIds.map((id) => {
      const box = document.querySelector<HTMLElement>(`[data-testid='court-token-${id}']`)!.getBoundingClientRect();
      return { id, x: box.left + box.width / 2, y: box.top + box.height / 2, diameter: box.width };
    });
    const started = performance.now();
    const frames = new Set<string>();
    const moving = { h2: 0, a7: 0 };
    let previous = Object.fromEntries(centers().map((point) => [point.id, point]));
    let samples = 0;
    let minimumGap = Number.POSITIVE_INFINITY;
    let maximumStep = 0;
    const frameIntervals: number[] = [];
    let lastFrame = started;

    await new Promise<void>((resolve) => {
      const read = (now: number) => {
        frameIntervals.push(now - lastFrame);
        lastFrame = now;
        const current = centers();
        frames.add(screen.dataset.motionFrame ?? "");
        for (const id of ["h2", "a7"] as const) {
          const point = current.find((entry) => entry.id === id)!;
          const step = Math.hypot(point.x - previous[id].x, point.y - previous[id].y);
          if (step > 0.03) moving[id] += 1;
          maximumStep = Math.max(maximumStep, step);
        }
        for (let first = 0; first < current.length; first += 1) {
          for (let second = first + 1; second < current.length; second += 1) {
            minimumGap = Math.min(minimumGap, Math.hypot(current[first].x - current[second].x, current[first].y - current[second].y));
          }
        }
        previous = Object.fromEntries(current.map((point) => [point.id, point]));
        samples += 1;
        if (now - started >= 1_100) resolve();
        else requestAnimationFrame(read);
      };
      requestAnimationFrame(read);
    });

    frameIntervals.sort((a, b) => a - b);
    return {
      stateFrames: frames.size,
      samples,
      moving,
      minimumGap,
      diameter: previous.h1.diameter,
      maximumStep,
      p95Frame: frameIntervals[Math.floor(frameIntervals.length * 0.95)] ?? 0,
    };
  }, ids);

  expect(sample.stateFrames).toBeGreaterThanOrEqual(17);
  expect(sample.moving.h2 / sample.samples).toBeGreaterThanOrEqual(0.72);
  expect(sample.moving.a7 / sample.samples).toBeGreaterThanOrEqual(0.72);
  expect(sample.minimumGap).toBeGreaterThanOrEqual(sample.diameter * 0.78);
  expect(sample.maximumStep).toBeLessThanOrEqual(6);
  expect(sample.p95Frame).toBeLessThanOrEqual(34);
  expect(consoleIssues).toEqual([]);
});

test("keeps the ball attached to the moving handler with the same interpolation", async ({ page }) => {
  await page.getByTestId("action-drive").click();
  await page.waitForTimeout(120);
  const errors = await page.evaluate(async () => {
    const court = document.querySelector<HTMLElement>("[data-testid='court-panel']")!;
    const handler = document.querySelector<HTMLElement>("[data-testid='court-token-h1']")!;
    const ball = document.querySelector<HTMLElement>(".ball-dot")!;
    const courtBox = court.getBoundingClientRect();
    const heightMeters = Number(ball.dataset.ballHeightM ?? "0.92");
    const visualLift = Math.min(26, Math.max(2, heightMeters * 5.2));
    const expected = { x: courtBox.width * 0.027, y: courtBox.height * 0.005 - visualLift };
    const samples: number[] = [];
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const read = (now: number) => {
        const handlerBox = handler.getBoundingClientRect();
        const ballBox = ball.getBoundingClientRect();
        const actual = {
          x: ballBox.left + ballBox.width / 2 - (handlerBox.left + handlerBox.width / 2),
          y: ballBox.top + ballBox.height / 2 - (handlerBox.top + handlerBox.height / 2),
        };
        samples.push(Math.hypot(actual.x - expected.x, actual.y - expected.y));
        if (now - started >= 850) resolve();
        else requestAnimationFrame(read);
      };
      requestAnimationFrame(read);
    });
    return samples.sort((a, b) => a - b);
  });
  expect(errors[Math.floor(errors.length * 0.95)]).toBeLessThanOrEqual(1.5);
  expect(errors.at(-1)).toBeLessThanOrEqual(3);
});

test("draws live route lines from each piece to its actual remaining waypoint", async ({ page }) => {
  await page.getByTestId("action-tactic").click();
  await page.getByRole("menuitem", { name: /牛角落位/ }).click();
  const routes = page.locator(".route-overlay [data-route-owner]");
  await expect(routes).toHaveCount(5);
  const path = page.locator("[data-route-owner='h2'] path");
  const startBefore = (await path.getAttribute("data-route-start"))!.split(",").map(Number);
  const tokenBefore = await positions(page);
  expect(distance({ x: startBefore[0], y: startBefore[1] }, tokenBefore.h2)).toBeLessThanOrEqual(0.05);
  expect(await path.getAttribute("d")).toContain(`M ${startBefore[0].toFixed(2)} ${startBefore[1].toFixed(2)}`);

  await page.waitForTimeout(300);
  const startAfter = (await path.getAttribute("data-route-start"))!.split(",").map(Number);
  expect(distance({ x: startBefore[0], y: startBefore[1] }, { x: startAfter[0], y: startAfter[1] })).toBeGreaterThan(0.2);
});

test("locks input while a screen approaches and resolves coverage only after contact time", async ({ page }) => {
  const matchupsBefore = await page.getByTestId("game-screen").getAttribute("data-controlled-matchup");
  await page.getByTestId("action-screen").click();
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "SCREEN_APPROACH");
  await expect(page.locator(".action-rail > button:enabled")).toHaveCount(0);
  await expect(page.locator("[data-route-owner]")).not.toHaveCount(0);
  await page.waitForTimeout(700);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-controlled-matchup", matchupsBefore ?? "");
  await page.waitForTimeout(750);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "SECOND_DECISION");
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-last-event-kind", "SCREEN_SET");
});
