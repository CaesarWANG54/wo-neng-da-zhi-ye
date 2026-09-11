import { expect, test } from "@playwright/test";

test("starts at creation and carries position, template and jersey into the tutorial", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("player-creation-screen")).toBeVisible();
  await expect(page.getByRole("button", { name: /PG.*控球后卫/ })).toHaveCount(1);
  await expect(page.getByTestId("jersey-number")).toHaveText("0");
  await expect(page.locator('.jersey-picker input[type="range"]')).toHaveCount(0);

  await page.getByRole("button", { name: /C.*中锋/ }).click();
  await expect(page.getByTestId("template-c_high_post_hub")).toContainText("高位全能策应轴（约基奇）");
  await page.getByTestId("jersey-decrement").click();
  await expect(page.getByTestId("jersey-number")).toHaveText("00");
  await page.getByTestId("start-tutorial").click();

  const game = page.getByTestId("game-screen");
  await expect(game).toBeVisible();
  await expect(game).toHaveAttribute("data-created-position", "C");
  await expect(game).toHaveAttribute("data-created-number", "00");
  await expect(page.getByTestId("scoreboard")).toContainText("UMich");
  await expect(page.getByTestId("scoreboard")).toContainText("UCoon");
  await expect(page.getByTestId("court-token-h1")).toHaveAttribute("data-position", "C");
  await expect(page.getByTestId("court-token-h1").locator("span")).toHaveText("00");
  await expect(page.getByTestId("court-token-h1")).toHaveAttribute("data-x", "16.00");
  await expect(page.getByTestId("court-token-h1")).toHaveAttribute("data-y", "49.00");
  await expect(game).toHaveAttribute("data-controlled-matchup", "a23");
  await expect(page.getByTestId("court-token-a23")).toHaveAttribute("data-position", "C");
});

test("cycles the plus and minus jersey controls through 0, 99 and 00", async ({ page }) => {
  await page.goto("/?qa=create");
  const output = page.getByTestId("jersey-number");
  const decrement = page.getByTestId("jersey-decrement");
  const increment = page.getByTestId("jersey-increment");

  await expect(output).toHaveText("0");
  await expect(decrement).toHaveAttribute("type", "button");
  await expect(increment).toHaveAttribute("type", "button");
  await increment.click();
  await expect(output).toHaveText("1");
  await decrement.click();
  await decrement.click();
  await expect(output).toHaveText("00");
  await decrement.click();
  await expect(output).toHaveText("99");
  await increment.click();
  await expect(output).toHaveText("00");
  await increment.click();
  await expect(output).toHaveText("0");
});

test("shows every requested player reference beside its position template", async ({ page }) => {
  await page.goto("/?qa=create");
  const references = {
    PG: ["亚历山大", "东契奇", "欧文", "莫兰特", "哈登", "哈里伯顿", "库里"],
    SG: ["马克西", "爱德华兹", "布克", "汤普森", "米切尔", "科比"],
    SF: ["伦纳德", "保罗乔治", "塔图姆", "詹姆斯", "布朗"],
    PF: ["字母哥", "锡安", "班凯罗", "杜兰特", "邓肯", "唐斯"],
    C: ["约基奇", "文班亚马", "霍姆格伦", "恩比德", "戈贝尔", "奥尼尔"],
  } as const;

  for (const [position, names] of Object.entries(references)) {
    await page.getByTestId(`position-${position.toLowerCase()}`).click();
    await expect(page.locator(".template-list > button")).toHaveCount(names.length);
    for (const name of names) await expect(page.locator(".template-list strong", { hasText: name })).toHaveCount(1);
  }
  await page.getByTestId("template-c_rim_anchor").click();
  await expect(page.getByTestId("template-c_rim_anchor")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".creation-summary h2")).toContainText("禁区防守屏障（戈贝尔）");
});

test("offers all 30 short-name teams for direct signing and records the choice", async ({ page }) => {
  await page.goto("/?qa=team-select");
  await expect(page.getByTestId("team-selection-screen")).toBeVisible();
  await expect(page.locator(".team-grid button")).toHaveCount(30);
  await page.getByRole("button", { name: /湖人/ }).click();
  await expect(page.getByTestId("career-home-screen")).toBeVisible();
  await expect(page.getByTestId("career-home-screen")).toContainText("湖人");
  await expect(page.getByTestId("career-home-screen")).toContainText("自主选择球队");
  await expect(page.getByTestId("career-home-screen").locator("img")).toHaveCount(0);
});

test("turns the one-time draft choice into a first-round destination", async ({ page }) => {
  await page.goto("/?qa=career-route");
  await expect(page.getByTestId("career-route-screen")).toBeVisible();
  await page.getByTestId("choose-draft").click();
  await expect(page.getByTestId("draft-ceremony-screen")).toBeVisible();
  await expect(page.getByTestId("draft-current-pick")).toContainText("First pick");
  while (await page.getByTestId("draft-next").count()) await page.getByTestId("draft-next").click();
  await page.getByTestId("enter-career").click();
  await expect(page.getByTestId("career-home-screen")).toBeVisible();
  await expect(page.getByTestId("career-home-screen")).toContainText(/首轮第\d+顺位/);
});

test("reveals the reviewed first-round order one selection at a time", async ({ page }) => {
  await page.goto("/?qa=draft-ceremony");
  const current = page.getByTestId("draft-current-pick");
  await expect(current).toContainText("First pick");
  await expect(current).toContainText("奇才");
  await expect(current).toContainText("AJ Dybantsa");
  await page.getByTestId("draft-next").click();
  await expect(current).toContainText("Second pick");
  await expect(current).toContainText("爵士");
  await expect(current).toContainText("Darryn Peterson");
  await expect(page.locator(".draft-history li")).toHaveCount(2);
});

test("persists an undrafted ceremony and shows all 30 unchanged picks before signing", async ({ page }) => {
  await page.goto("/?qa=career-route-undrafted&persist=1");
  await expect(page.getByTestId("career-route-screen")).toContainText("球探评价 45");
  await page.getByTestId("choose-draft").click();
  await expect(page.getByTestId("draft-current-pick")).toContainText("AJ Dybantsa");
  await page.waitForFunction(() => Boolean(localStorage.getItem("wo-neng-da-zhi-ye:career:v1")));
  await page.reload();
  await expect(page.getByTestId("draft-ceremony-screen")).toBeVisible();
  await expect(page.getByTestId("draft-current-pick")).toContainText("AJ Dybantsa");
  await expect(page.getByTestId("draft-undrafted-result")).toContainText("还需观看 29 个签位");

  while (await page.getByTestId("draft-next").count()) await page.getByTestId("draft-next").click();

  await expect(page.locator(".draft-history li")).toHaveCount(30);
  await expect(page.locator(".draft-history li.created")).toHaveCount(0);
  await expect(page.locator(".draft-history li").last()).toContainText("Koa Peat");
  const outcome = page.getByTestId("draft-undrafted-result");
  await expect(outcome).toContainText("首轮30签已全部公布");
  await expect(outcome).toContainText("落选新秀合同");
  const signedTeam = (await outcome.textContent())?.match(/。(.+?)向你提供/)?.[1];
  expect(signedTeam).toBeTruthy();

  await page.getByTestId("enter-career").click();
  const home = page.getByTestId("career-home-screen");
  await expect(home).toContainText("落选新秀签约");
  await expect(home).toContainText(signedTeam!);
});

test("opens the player-team calendar, shows all ratings and simulates to any selected future date", async ({ page }) => {
  await page.goto("/?qa=career-home");
  await expect(page.getByTestId("career-coins")).toContainText("0");
  await expect(page.getByTestId("career-attributes").locator("section > div")).toHaveCount(38);
  await expect(page.getByTestId("calendar-month-label")).toHaveText("2026年10月");

  await page.getByTestId("calendar-next-month").click();
  await page.getByTestId("calendar-prev-month").click();
  await expect(page.getByTestId("calendar-month-label")).toHaveText("2026年10月");
  await page.getByTestId("calendar-next-month").click();
  await page.getByTestId("calendar-next-month").click();
  await expect(page.getByTestId("calendar-month-label")).toHaveText("2026年12月");
  await expect(page.locator(".calendar-days button.cup-tbd")).toHaveCount(2);
  await page.getByTestId("calendar-day-2026-12-05").click();
  await expect(page.getByTestId("calendar-selection")).toContainText("杯赛对阵待定");
  await page.getByTestId("resolve-cup-schedule").click();
  await expect(page.getByTestId("career-home-screen")).toContainText("杯赛追加赛程已由游戏内战绩确定");
  await expect(page.getByTestId("calendar-day-2026-12-05")).not.toHaveClass(/cup-tbd/);

  for (let month = 0; month < 4; month += 1) await page.getByTestId("calendar-next-month").click();
  await expect(page.getByTestId("calendar-month-label")).toHaveText("2027年4月");
  await page.getByTestId("calendar-day-2027-04-11").click();
  await page.getByTestId("simulate-to-date").click();
  await expect(page.getByTestId("calendar-awards")).toBeEnabled();
  await page.getByTestId("calendar-awards").click();
  await expect(page.getByRole("dialog", { name: "赛季奖项" }).locator("article")).toHaveCount(8);
  await expect(page.getByRole("dialog", { name: "赛季奖项" })).toContainText("最佳教练");
  await page.getByTestId("close-calendar-awards").click();
});

test("calendar settings and next-game locator have observable effects", async ({ page }) => {
  await page.goto("/?qa=career-home");
  await page.getByTestId("select-next-game").click();
  await expect(page.getByTestId("calendar-selection")).toContainText(/主场|客场/);
  await page.getByTestId("calendar-settings").click();
  const dialog = page.getByRole("dialog", { name: "日历设置" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "全明星" }).click();
  await expect(dialog.getByRole("button", { name: "全明星" })).toHaveClass(/active/);
  await dialog.locator('input[type="range"]').fill("15");
  await expect(dialog).toContainText("音量 15%");
  await page.getByTestId("close-calendar-settings").click();
  await expect(dialog).toBeHidden();
});

test("keeps tutorial completion, back navigation, training controls and replay functional", async ({ page }) => {
  await page.goto("/?qa=final");
  await expect(page.getByTestId("game-over-dialog")).toBeVisible();
  await page.getByRole("button", { name: "完成教学" }).click();
  await expect(page.getByTestId("career-route-screen")).toBeVisible();

  await page.getByTestId("choose-direct").click();
  await expect(page.getByTestId("team-selection-screen")).toBeVisible();
  await page.getByTestId("team-selection-back").click();
  await expect(page.getByTestId("career-route-screen")).toBeVisible();
  await page.getByTestId("choose-direct").click();
  await page.getByTestId("team-lakers").click();
  await expect(page.getByTestId("career-home-screen")).toContainText("湖人");

  const threePoint = page.getByTestId("career-rating-threePoint").locator("strong");
  const before = Number(await threePoint.textContent());
  await page.getByTestId("open-training-center").click();
  await expect(page.getByTestId("training-center")).toBeVisible();
  await expect(page.locator(".training-group-list > button")).toHaveCount(8);
  await page.getByTestId("training-group-shooting").click();
  await page.getByTestId("training-primary-threePoint").click();
  await page.getByTestId("commit-training").click();
  await expect(page.getByTestId("training-count").last()).toContainText("1/2");
  await expect(threePoint).toHaveText(String(before + 1));
  await page.getByTestId("commit-training").click();
  await expect(page.getByTestId("training-count").last()).toContainText("2/2");
  await expect(page.getByTestId("commit-training")).toBeDisabled();
  await page.getByTestId("close-training-center").click();
  await expect(page.getByTestId("open-training-center")).toBeDisabled();

  await page.getByTestId("replay-tutorial").click();
  await expect(page.getByTestId("game-screen")).toBeVisible();
  await expect(page.getByTestId("game-screen")).toHaveAttribute("data-created-number", "0");
});

test("keeps the creation screen inside both landscape device safe areas", async ({ page }) => {
  await page.goto("/?qa=create");
  const assertInsideScreen = async () => {
    const screen = await page.getByTestId("device-screen").boundingBox();
    const creation = await page.getByTestId("player-creation-screen").boundingBox();
    expect(screen).not.toBeNull();
    expect(creation).not.toBeNull();
    expect(creation!.x).toBeGreaterThanOrEqual(screen!.x - 1);
    expect(creation!.y).toBeGreaterThanOrEqual(screen!.y - 1);
    expect(creation!.x + creation!.width).toBeLessThanOrEqual(screen!.x + screen!.width + 1);
    expect(creation!.y + creation!.height).toBeLessThanOrEqual(screen!.y + screen!.height + 1);
  };
  await assertInsideScreen();
  await page.getByTestId("device-picker").click();
  await page.getByTestId("device-option-pixel-10").click();
  await assertInsideScreen();
});
