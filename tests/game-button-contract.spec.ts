import { expect, test, type Page } from "@playwright/test";

async function openFixture(page: Page, fixture: string) {
  await page.goto(`/?qa=${fixture}`);
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
}

async function eventSequence(page: Page) {
  return Number(await page.getByTestId("game-screen").getAttribute("data-event-sequence"));
}

async function expectEventAfter(page: Page, before: number) {
  await expect.poll(() => eventSequence(page)).toBeGreaterThan(before);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-controlled-player-id", "h1");
}

test("serializes pass and shoot taps so the last input is never swallowed", async ({ page }) => {
  await openFixture(page, "game");
  const firstSequence = await eventSequence(page);
  await page.getByTestId("action-pass").click();
  await expect(page.getByTestId("action-pass")).toHaveClass(/pending/);
  await page.getByTestId("action-shoot").click();
  await expect(page.locator(".action-rail > button.pending")).toHaveCount(1);
  await expect(page.getByTestId("action-pass")).not.toHaveClass(/pending/);
  await expect(page.getByTestId("action-shoot")).toHaveClass(/pending/);
  await expect(page.getByTestId("phase-status")).toContainText("投篮首击已接收");
  await expectEventAfter(page, firstSequence);
  await expect(page.getByTestId("game-screen")).not.toHaveAttribute("data-pending-shot", "");

  await openFixture(page, "game");
  const secondSequence = await eventSequence(page);
  await page.getByTestId("action-shoot").click();
  await page.getByTestId("action-pass").click();
  await expect(page.locator(".action-rail > button.pending")).toHaveCount(1);
  await expect(page.getByTestId("action-shoot")).not.toHaveClass(/pending/);
  await expect(page.getByTestId("action-pass")).toHaveClass(/pending/);
  await expect(page.getByTestId("phase-status")).toContainText("传球首击已接收");
  await expectEventAfter(page, secondSequence);
  await expect(page.getByTestId("game-screen")).not.toHaveAttribute("data-ball-handler-id", "h1");
});

test("gives every half-court on-ball slot a visible rule or tactic result", async ({ page }) => {
  for (const action of ["pass", "drive", "shoot", "screen"] as const) {
    await openFixture(page, "game");
    const before = await eventSequence(page);
    await page.getByTestId(`action-${action}`).click();
    if (action === "pass" || action === "shoot") {
      await expect(page.getByTestId(`action-${action}`)).toHaveClass(/pending/);
    }
    await expectEventAfter(page, before);
    await expect(page.getByTestId("phase-status")).not.toContainText("等待操作");
  }

  for (const tactic of ["HORNS", "FIVE_OUT", "HANDOFF", "STAGGER"] as const) {
    await openFixture(page, "game");
    await page.getByTestId("action-tactic").click();
    await expect(page.getByTestId("action-tactic")).toHaveAttribute("aria-expanded", "true");
    await page.locator(`#tactic-menu [role="menuitem"]`).filter({ hasText: tactic === "HORNS" ? "牛角" : tactic === "FIVE_OUT" ? "五外" : tactic === "HANDOFF" ? "手递手" : "双重掩护" }).click();
    await expect(page.getByTestId("game-screen")).toHaveAttribute("data-active-tactic", tactic);
    await expect(page.locator("[data-route-owner]")).toHaveCount(5);
  }
});

test("gives every off-ball and fastbreak off-ball slot a result", async ({ page }) => {
  for (const fixture of ["offball", "fastbreak-offball"] as const) {
    for (const action of ["request", "cut", "spot", "screen"] as const) {
      await openFixture(page, fixture);
      const before = await eventSequence(page);
      await page.getByTestId(`action-${action}`).click();
      await expectEventAfter(page, before);
      await expect(page.getByTestId("phase-status")).not.toContainText("等待操作");
    }

    await openFixture(page, fixture);
    await page.getByTestId("action-tactic").click();
    await expect(page.getByRole("menu", { name: "选择进攻战术" })).toBeVisible();
    await page.getByRole("menuitem").first().click();
    await expect(page.getByTestId("game-screen")).not.toHaveAttribute("data-active-tactic", "");
  }
});

test("gives every on-ball fastbreak slot a result, including the double-tap dunk", async ({ page }) => {
  for (const action of ["pass", "drive", "shoot", "screen"] as const) {
    await openFixture(page, "fastbreak");
    const before = await eventSequence(page);
    await page.getByTestId(`action-${action}`).click();
    await expectEventAfter(page, before);
  }

  await openFixture(page, "fastbreak");
  await page.getByTestId("action-tactic").click();
  await page.getByRole("menuitem").first().click();
  await expect(page.getByTestId("game-screen")).not.toHaveAttribute("data-active-tactic", "");

  await openFixture(page, "fastbreak");
  const beforeDunk = await eventSequence(page);
  await page.getByTestId("action-shoot").click();
  await page.getByTestId("action-shoot").click();
  await expectEventAfter(page, beforeDunk);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-pending-shot", "DUNK");
});

test("keeps all ten moving pieces inspectable without transferring control", async ({ page }) => {
  await openFixture(page, "game");
  for (const id of ["h1", "h2", "h3", "h4", "h5", "a7", "a8", "a9", "a11", "a23"]) {
    await page.getByTestId(`court-token-${id}`).click();
    await expect(page.getByTestId("player-inspector")).toHaveAttribute("data-inspected-player-id", id);
    await expect(page.getByTestId(`court-token-${id}`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("game-screen")).toHaveAttribute("data-controlled-player-id", "h1");
  }
});

test("clears a defense response when the AI advances to a new decision token", async ({ page }) => {
  await openFixture(page, "defense");
  const game = page.getByTestId("game-screen");
  const firstToken = await game.getAttribute("data-ai-decision-token");
  await page.getByTestId("action-contest").click();
  await expect(page.getByTestId("action-contest")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("defense-feedback")).toBeVisible();
  await expect.poll(() => game.getAttribute("data-ai-decision-token")).not.toBe(firstToken);
  await expect(game).toHaveAttribute("data-ai-response", "");
  await expect(page.getByTestId("action-contest")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("defense-feedback")).toHaveCount(0);
});

test("returns from help and pause to a live game, and every pause control changes state", async ({ page }) => {
  await openFixture(page, "game");
  await page.getByTestId("open-help").click();
  await page.getByRole("dialog", { name: "玩法说明" }).getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("dialog", { name: "玩法说明" })).toHaveCount(0);
  await page.getByTestId("open-help").click();
  await page.getByTestId("help-return").click();
  await expect(page.getByRole("dialog", { name: "玩法说明" })).toHaveCount(0);
  const beforeDrive = await eventSequence(page);
  await page.getByTestId("action-drive").click();
  await expectEventAfter(page, beforeDrive);

  await page.getByTestId("open-pause").click();
  await page.getByRole("dialog", { name: "比赛暂停" }).getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("dialog", { name: "比赛暂停" })).toHaveCount(0);
  await page.getByTestId("open-pause").click();
  const pause = page.getByRole("dialog", { name: "比赛暂停" });
  await pause.getByRole("tab", { name: "对方5人" }).click();
  await expect(page.getByTestId("box-score-table-away")).toBeVisible();
  await pause.getByRole("tab", { name: "设置" }).click();
  await page.getByTestId("volume-control").fill("35");
  await expect(page.getByTestId("volume-value")).toHaveText("35%");
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-ui-volume", "35");
  for (const difficulty of ["rookie", "pro", "starter", "all_star", "hall_of_fame"]) {
    await page.getByTestId(`difficulty-${difficulty}`).click();
    await expect(page.getByTestId(`difficulty-${difficulty}`)).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByTestId("pause-help").click();
  await page.getByTestId("help-return").click();
  await expect(pause).toBeVisible();
  await page.getByTestId("pause-resume").click();
  await expect(pause).toHaveCount(0);

  await page.getByTestId("open-pause").click();
  await page.getByTestId("pause-reset").click();
  await expect(page.getByRole("dialog", { name: "比赛暂停" })).toHaveCount(0);
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-last-event-kind", "RESET");
  await expect(page.getByTestId("phase-status")).toContainText("已恢复到第4节3:00");
});

test("explains why all five action slots are temporarily locked", async ({ page }) => {
  for (const fixture of ["made", "shot", "free-throw"] as const) {
    await openFixture(page, fixture);
    await expect(page.locator(".action-rail > button:disabled")).toHaveCount(5);
    const reason = await page.getByTestId("action-rail").getAttribute("data-lock-reason");
    expect(reason).toBeTruthy();
    for (const button of await page.locator(".action-rail > button").all()) {
      await expect(button.locator("small")).not.toHaveText("");
    }
  }
});
