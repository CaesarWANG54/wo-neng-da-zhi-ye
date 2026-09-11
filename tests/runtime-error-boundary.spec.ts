import { expect, test } from "@playwright/test";

test("recovers from an unexpected runtime failure without offering to erase the career save", async ({ page }) => {
  await page.goto("/?qa=fatal");

  const recovery = page.getByTestId("runtime-error-screen");
  await expect(recovery).toBeVisible();
  await expect(recovery).toBeFocused();
  await expect(recovery).toContainText("已提交的生涯存档不会被自动删除");
  await expect(page.getByTestId("runtime-error-reload")).toHaveAccessibleName("重新加载游戏");

  await page.evaluate(() => window.history.replaceState(null, "", "/"));
  await page.getByTestId("runtime-error-reload").click();
  await expect(page.getByTestId("player-creation-screen")).toBeVisible();
});

test("shows a readable boot fallback when the application module cannot load", async ({ page }) => {
  await page.route("**/src/main.tsx", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("正在加载《我能打职业》");
  await expect(page.getByRole("status")).toContainText("请检查网络后刷新页面");
});

test("keeps keyboard focus visible, closes help with Escape, and restores the opener", async ({ page }) => {
  await page.goto("/?qa=game");
  const help = page.getByRole("button", { name: "玩法" });
  await help.focus();
  const outline = await help.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);

  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "玩法说明" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(help).toBeFocused();
});
