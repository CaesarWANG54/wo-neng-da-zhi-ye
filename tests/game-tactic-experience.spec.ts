import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?qa=game");
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
});

test("turns a tactic call into a staged, readable and non-repeating live execution", async ({ page }) => {
  const screen = page.getByTestId("game-screen");
  await page.getByTestId("action-tactic").click();
  await page.getByRole("menuitem", { name: /牛角落位/ }).click();

  await expect(page.getByTestId("tactic-live-panel")).toBeVisible();
  await expect(page.getByTestId("tactic-live-panel")).toContainText("执行");
  const firstSignature = await screen.getAttribute("data-tactic-signature");
  expect(firstSignature).toBeTruthy();
  expect(await page.locator(".role-chip").count()).toBeGreaterThan(0);
  expect(await page.locator(".role-chip").count()).toBeLessThanOrEqual(3);
  await expect(page.locator('[data-route-primary="true"]')).toHaveCount(1);

  await page.getByTestId("action-tactic").click();
  await expect(page.locator(".tactic-menu-title")).toContainText("近3回合");
  await page.getByRole("menuitem", { name: /牛角落位/ }).click();
  const secondSignature = await screen.getAttribute("data-tactic-signature");
  expect(secondSignature).toBeTruthy();
  expect(secondSignature).not.toBe(firstSignature);
});

test("explains that rookie core ratings are starts while growth remains global to 99", async ({ page }) => {
  await page.goto("/?qa=create");
  await page.getByTestId("position-sg").click();
  await page.getByTestId("template-sg_engine").click();
  await expect(page.getByTestId("player-creation-screen")).toContainText("成长上限");
  await expect(page.getByTestId("player-creation-screen")).toContainText("99");
  await expect(page.getByTestId("player-creation-screen")).toContainText("中投 80");
  await expect(page.getByTestId("player-creation-screen")).toContainText("肘区接球 · 二次挡拆组织");
});
