import { expect, test, type Page } from "@playwright/test";

async function openTutorial(page: Page, fixture = "game") {
  await page.goto(`/?qa=${fixture}`);
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-match-mode", "TUTORIAL");
}

test("shows six non-blocking tasks and completes pause plus help as one guided step", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await openTutorial(page);
  const tracker = page.getByTestId("tutorial-tracker");
  await expect(tracker).toBeVisible();
  await expect(tracker).toHaveAttribute("data-total-count", "6");
  await expect(page.locator('[data-testid^="tutorial-task-"]')).toHaveCount(6);
  await expect(page.getByTestId("tutorial-progress-count")).toHaveText("0/6");

  await page.getByTestId("open-pause").click();
  await page.getByTestId("pause-help").click();
  await expect(page.getByTestId("tutorial-task-guide")).toHaveAttribute("data-completed", "true");
  await expect(page.getByTestId("tutorial-progress-count")).toHaveText("1/6");
  await page.getByTestId("help-return").click();
  await page.getByTestId("pause-resume").click();
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-simulation-paused", "false");
  expect(runtimeErrors).toEqual([]);
});

test("advances an accepted pass and an effective defense response from live match events", async ({ page }) => {
  await openTutorial(page);
  await page.getByTestId("action-pass").click();
  await expect(page.getByTestId("tutorial-task-connect")).toHaveAttribute("data-completed", "true");
  await expect(page.getByTestId("tutorial-feedback")).toContainText("传接阅读有效");

  await openTutorial(page, "defense");
  await page.getByTestId("action-contain").click();
  await expect(page.getByTestId("tutorial-task-defend")).toHaveAttribute("data-completed", "true");
  await expect(page.getByTestId("tutorial-feedback")).toContainText("防守指令已提交");
});

test("recovers from a mistimed double-tap without reload and later accepts a valid shot", async ({ page }) => {
  await openTutorial(page);
  const shoot = page.getByTestId("action-shoot");
  await shoot.click();
  await shoot.click();
  await expect(page.getByTestId("tutorial-feedback")).toContainText(/太远|快攻/);
  await expect(page.getByTestId("tutorial-tracker")).toHaveAttribute("data-feedback-kind", "RECOVER");
  await expect(page.getByTestId("tutorial-task-attack")).toHaveAttribute("data-completed", "false");

  await shoot.click();
  await expect(page.getByTestId("tutorial-task-attack")).toHaveAttribute("data-completed", "true");
  await expect(page.getByTestId("tutorial-tracker")).toHaveAttribute("data-feedback-kind", "SUCCESS");
});

test("recognizes a fastbreak double-tap and keeps outcome odds inside the match engine", async ({ page }) => {
  await openTutorial(page, "fastbreak");
  const shoot = page.getByTestId("action-shoot");
  await shoot.click();
  await shoot.click();
  await expect(page.getByTestId("tutorial-task-fastbreak-double")).toHaveAttribute("data-completed", "true");
  await expect(page.getByTestId("tutorial-task-attack")).toHaveAttribute("data-completed", "true");
  await expect(page.getByTestId("tutorial-feedback")).toContainText("快攻扣篮已正确发起");
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-phase", "SHOT_FLIGHT");
});

test("shows five explainable evaluation dimensions at the horn and carries them to the route screen", async ({ page }) => {
  await openTutorial(page, "final");
  const dialog = page.getByTestId("game-over-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("tutorial-evaluation-total")).toHaveText(/\d+/);
  await expect(page.getByTestId("tutorial-evaluation-breakdown").locator("article")).toHaveCount(5);
  await expect(page.getByTestId("tutorial-evaluation-decision")).toContainText("决策阅读");
  await expect(page.getByTestId("tutorial-evaluation-offense")).toContainText("进攻执行");
  await expect(page.getByTestId("tutorial-evaluation-defense")).toContainText("防守投入");
  await expect(page.getByTestId("tutorial-evaluation-transition")).toContainText("转换意识");
  await expect(page.getByTestId("tutorial-evaluation-team")).toContainText("团队纪律");

  await page.getByRole("button", { name: "完成教学" }).click();
  await expect(page.getByTestId("career-route-screen")).toBeVisible();
  await expect(page.getByTestId("career-evaluation-breakdown").locator(":scope > span")).toHaveCount(5);
});

test("does not mount tutorial state in a regular-season match", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
  await page.goto("/?qa=career-home&persist=1&careerEnd=win");
  await page.getByTestId("career-home-screen").waitFor({ state: "visible" });
  await page.getByTestId("select-next-game").click();
  await page.getByTestId("play-career-game").click();
  await page.getByTestId("confirm-career-game").click();
  const game = page.getByTestId("game-screen");
  await expect(game).toHaveAttribute("data-match-mode", "CAREER");
  await expect(game).toHaveAttribute("data-tutorial-progress", "");
  await expect(page.getByTestId("tutorial-tracker")).toHaveCount(0);
});
