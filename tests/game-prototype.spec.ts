import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?qa=game");
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
});

test("keeps the tactical board dominant and the five iPhone actions touch-safe", async ({ page }) => {
  const board = await page.locator(".court-panel").boundingBox();
  const rail = await page.locator(".action-rail").boundingBox();
  const screen = await page.getByTestId("device-screen").boundingBox();
  const buttons = page.locator(".action-rail > button");

  expect(board).not.toBeNull();
  expect(rail).not.toBeNull();
  expect(screen).not.toBeNull();
  expect(board!.width).toBeGreaterThanOrEqual(640);
  expect(rail!.x + rail!.width).toBeLessThanOrEqual(screen!.x + screen!.width - 52);
  await expect(buttons).toHaveCount(5);

  let previousBottom = -Infinity;
  for (let index = 0; index < 5; index += 1) {
    const box = await buttons.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(48);
    expect(box!.height).toBeGreaterThanOrEqual(48);
    expect(box!.y).toBeGreaterThanOrEqual(previousBottom);
    previousBottom = box!.y + box!.height;
  }
});

test("resolves the tutorial screen into visible coverage and exposes no special drawer", async ({ page }) => {
  await page.getByRole("button", { name: /挡拆，呼叫队友掩护/ }).click();
  await expect(page.locator(".paper-note")).toContainText("掩护正在形成");
  await expect(page.locator("[data-route-owner]")).toHaveCount(4);
  await page.waitForTimeout(1_400);
  await expect(page.locator(".paper-note")).toContainText(/夹击|防守换防|沉退|延误/);

  await page.getByRole("button", { name: /玩法/ }).click();
  const help = page.getByRole("dialog", { name: "玩法说明" });
  await expect(help).toContainText("双击传球尝试空接");
  await expect(help).toContainText("双击投篮在篮筐路线尝试扣篮");
  await expect(help).toContainText("细红圈是你的球员");
  await expect(help).toContainText("换防会改对位");
  await expect(help).toContainText("普通防守碰出界保留剩余进攻时间");
  await expect(help).toContainText("规则明确标记的前场续攻");
  await expect(help).not.toContainText("防守碰出后低于14秒回到14秒");
  await expect(page.getByText("展开特殊动作", { exact: true })).toHaveCount(0);
  await help.getByRole("button", { name: "返回比赛" }).click();
  await expect(help).toHaveCount(0);

  await page.getByRole("button", { name: /暂停/ }).click();
  const pause = page.getByRole("dialog", { name: "比赛暂停" });
  await pause.getByRole("button", { name: /玩法说明/ }).click();
  const pausedHelp = page.getByRole("dialog", { name: "玩法说明" });
  await pausedHelp.getByRole("button", { name: "返回暂停" }).click();
  await expect(pause).toBeVisible();
  await pause.getByRole("button", { name: "继续比赛" }).click();
  await expect(pause).toHaveCount(0);
});

test("changes to the off-ball rail after a pass and rejects an unavailable lob", async ({ page }) => {
  await page.getByRole("button", { name: /传球，选择最佳路线/ }).click();
  await expect(page.getByRole("complementary", { name: "无球操作区" })).toBeVisible();
  await expect(page.locator(".action-rail button strong")).toHaveText(["要球", "空切", "外弹", "挡拆", "战术"]);

  await page.reload();
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
  const pass = page.getByRole("button", { name: /传球，选择最佳路线/ });
  await pass.click();
  await pass.click();
  await expect(page.locator(".paper-note")).toContainText("当前没有通往篮筐的空接路线");
  await expect(page.getByRole("complementary", { name: "持球操作区" })).toBeVisible();
});

test("keeps double-shoot distinct and explicitly rejects a distant dunk", async ({ page }) => {
  const shoot = page.getByRole("button", { name: /投篮，读取外线干扰/ });
  await shoot.click();
  await shoot.click();
  await expect(page.locator(".paper-note")).toContainText("距离篮筐过远");
  await expect(page.getByRole("complementary", { name: "持球操作区" })).toBeVisible();
});

test("keeps all five off-ball fastbreak reads functional", async ({ page }) => {
  await page.goto("/?qa=fastbreak-offball");
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
  await expect(page.getByRole("complementary", { name: "快攻无球操作区" })).toBeVisible();
  await expect(page.locator(".action-rail button strong")).toHaveText(["拖后接应", "顺下", "站定三分", "拖曳挡拆", "落阵地"]);
  await expect(page.locator(".action-rail > button:enabled")).toHaveCount(5);
  await page.getByRole("button", { name: /站定三分，落位三分线外/ }).click();
  await expect(page.locator(".paper-note")).toContainText("三分点");
});

test("allows a fastbreak alley-oop without requiring a half-court screen", async ({ page }) => {
  await page.goto("/?qa=fastbreak");
  await page.getByTestId("game-screen").waitFor({ state: "visible" });
  const pass = page.getByRole("button", { name: /传球，选择最佳路线/ });
  await pass.click();
  await pass.click();
  await expect(page.locator(".paper-note")).toContainText("空接传给");
  await expect(page.locator(".paper-note")).not.toContainText("当前没有通往篮筐的空接路线");
});

test("reserves Pixel camera and navigation safe areas", async ({ page }) => {
  await page.getByTestId("device-picker").click();
  await page.getByTestId("device-option-pixel-10").click();

  const rail = await page.locator(".action-rail").boundingBox();
  const camera = await page.getByTestId("device-camera").boundingBox();
  const navigation = await page.getByTestId("android-navigation-bar").boundingBox();
  const shotClock = await page.locator(".shot-clock").boundingBox();

  expect(rail).not.toBeNull();
  expect(camera).not.toBeNull();
  expect(navigation).not.toBeNull();
  expect(shotClock).not.toBeNull();
  expect(rail!.x + rail!.width).toBeLessThanOrEqual(camera!.x);
  expect(navigation!.x + navigation!.width).toBeLessThanOrEqual(shotClock!.x);
  await expect(page.locator(".action-rail > button")).toHaveCount(5);
});
