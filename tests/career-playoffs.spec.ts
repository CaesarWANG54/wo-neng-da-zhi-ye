import { expect, test, type Page } from "@playwright/test";

const SAVE_KEY = "wo-neng-da-zhi-ye:career:v1";

type PlayoffGameSnapshot = {
  gameId: string;
  gameNumber: number;
  status: "SCHEDULED" | "FINAL";
  homeTeamId: string;
  awayTeamId: string;
  score: { homeScore: number; awayScore: number } | null;
};

type PlayoffSeriesSnapshot = {
  seriesId: string;
  round: "FIRST_ROUND" | "CONFERENCE_SEMIFINALS" | "CONFERENCE_FINALS" | "FINALS";
  conference: "EAST" | "WEST" | null;
  slot: string;
  teamAId: string;
  teamBId: string;
  teamASeed: number;
  teamBSeed: number;
  homeCourtTeamId: string;
  status: "ACTIVE" | "FINAL";
  revision: number;
  teamAWins: number;
  teamBWins: number;
  games: PlayoffGameSnapshot[];
  winnerTeamId: string | null;
  loserTeamId: string | null;
};

type CareerSaveSnapshot = {
  schemaVersion: number;
  revision: number;
  data: {
    destination: { team: { id: string; shortName: string } };
    progression: { coins: number; chemistryPercent: number; [key: string]: unknown };
    season: { playerStats: unknown; standings: unknown; [key: string]: unknown };
    postseason: {
      revision: number;
      eventIds: string[];
      playoffs: {
        revision: number;
        status: "WAITING_FOR_PLAY_IN" | "IN_PROGRESS" | "COMPLETE";
        eventIds: string[];
        series: PlayoffSeriesSnapshot[];
        championTeamId: string | null;
        championshipEventId: string | null;
        seasonCompletionEventId: string | null;
      };
    };
  };
};

function roundTestId(round: "PLAY_IN" | PlayoffSeriesSnapshot["round"]) {
  return round.toLowerCase().replaceAll("_", "-");
}

async function readSave(page: Page): Promise<CareerSaveSnapshot> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), SAVE_KEY);
}

async function waitForPersistedPlayoffs(page: Page) {
  await page.waitForFunction((key) => {
    try {
      return Boolean(JSON.parse(localStorage.getItem(key) ?? "null")?.data?.postseason?.playoffs);
    } catch {
      return false;
    }
  }, SAVE_KEY);
}

async function openPostseasonPanel(page: Page) {
  await expect(page.getByTestId("career-home-screen")).toBeVisible();
  await page.getByTestId("calendar-postseason").click();
  const panel = page.getByTestId("postseason-panel");
  await expect(panel).toBeVisible();
  return panel;
}

async function openPlayoffFixture(
  page: Page,
  options: { stage?: "FINALS" | "COMPLETE"; result?: "win" | "loss" } = {},
) {
  await page.clock.install({ time: new Date("2026-09-01T12:00:00Z") });
  const query = new URLSearchParams({
    qa: "playoffs",
    persist: "1",
    careerEnd: options.result ?? "win",
  });
  if (options.stage) query.set("playoffStage", options.stage);
  await page.goto(`/?${query.toString()}`);
  await waitForPersistedPlayoffs(page);
  return openPostseasonPanel(page);
}

async function selectConference(page: Page, conference: "EAST" | "WEST") {
  const tab = page.getByTestId(`postseason-tab-${conference.toLowerCase()}`);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

async function selectRound(page: Page, round: "PLAY_IN" | PlayoffSeriesSnapshot["round"]) {
  const suffix = roundTestId(round);
  const tab = page.getByTestId(`postseason-round-${suffix}`);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId(`postseason-view-${suffix}`)).toBeVisible();
}

function findPlayerSeries(save: CareerSaveSnapshot, round: PlayoffSeriesSnapshot["round"]) {
  const playerTeamId = save.data.destination.team.id;
  const series = save.data.postseason.playoffs.series.find((candidate) => (
    candidate.round === round
    && (candidate.teamAId === playerTeamId || candidate.teamBId === playerTeamId)
  ));
  expect(series, `created player's ${round} series`).toBeTruthy();
  return series!;
}

function nextGame(series: PlayoffSeriesSnapshot) {
  const game = series.games.find((candidate) => candidate.status === "SCHEDULED");
  expect(game, `next game for ${series.seriesId}`).toBeTruthy();
  return game!;
}

async function waitForPlayoffRevision(page: Page, expectedRevision: number) {
  await expect.poll(async () => (await readSave(page)).data.postseason.playoffs.revision).toBe(expectedRevision);
}

test("switches conferences and rounds while rendering the fixed 1v8 / 4v5 / 3v6 / 2v7 first round", async ({ page }) => {
  const panel = await openPlayoffFixture(page);
  await expect(panel).toHaveAttribute("data-playoff-status", "IN_PROGRESS");
  // Once both play-ins have generated the bracket, reopening the center
  // intentionally focuses the current FIRST_ROUND instead of historical play-in.
  await expect(page.getByTestId("postseason-view-first-round")).toBeVisible();

  const save = await readSave(page);
  const expectedPairings = [
    { slot: "F1", seeds: [1, 8] },
    { slot: "F2", seeds: [4, 5] },
    { slot: "F3", seeds: [3, 6] },
    { slot: "F4", seeds: [2, 7] },
  ];

  for (const conference of ["EAST", "WEST"] as const) {
    await selectConference(page, conference);
    await selectRound(page, "FIRST_ROUND");
    const view = page.getByTestId("postseason-view-first-round");
    await expect(view.locator(".playoff-series")).toHaveCount(4);
    await expect(view).toContainText("H-H-A-A-H-A-H");

    const series = save.data.postseason.playoffs.series.filter((candidate) => (
      candidate.conference === conference && candidate.round === "FIRST_ROUND"
    ));
    expect(series.map((candidate) => ({
      slot: candidate.slot,
      seeds: [candidate.teamASeed, candidate.teamBSeed],
    }))).toEqual(expectedPairings);

    for (const pairing of series) {
      const card = page.getByTestId(`playoff-series-${pairing.seriesId}`);
      await expect(card).toHaveAttribute("data-status", "ACTIVE");
      await expect(card).toHaveAttribute("data-series-score", "0-0");
      await expect(card).toContainText(`#${pairing.teamASeed}`);
      await expect(card).toContainText(`#${pairing.teamBSeed}`);
    }
  }

  await selectRound(page, "PLAY_IN");
  for (const conference of ["EAST", "WEST"] as const) {
    await selectConference(page, conference);
    await expect(page.locator(`[data-testid^="play-in-game-${conference.toLowerCase()}-"][data-status="FINAL"]`)).toHaveCount(3);
  }

  for (const round of ["CONFERENCE_SEMIFINALS", "CONFERENCE_FINALS", "FINALS"] as const) {
    await selectRound(page, round);
    await expect(page.getByTestId("playoff-round-waiting")).toContainText("等待前序系列赛");
  }
});

test("double-clicks settle only one game, persists it across refresh, and follows H-H-A-A hosting", async ({ page }) => {
  let panel = await openPlayoffFixture(page);
  await selectConference(page, "WEST");
  await selectRound(page, "FIRST_ROUND");

  const before = await readSave(page);
  const playerSeries = findPlayerSeries(before, "FIRST_ROUND");
  const firstGame = nextGame(playerSeries);
  const firstButton = page.getByTestId(`simulate-playoff-${playerSeries.seriesId}-g${firstGame.gameNumber}`);
  await firstButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await waitForPlayoffRevision(page, before.data.postseason.playoffs.revision + 1);
  await expect(panel).toHaveAttribute("data-postseason-revision", String(before.data.postseason.revision + 1));

  let after = await readSave(page);
  let updatedSeries = after.data.postseason.playoffs.series.find((candidate) => candidate.seriesId === playerSeries.seriesId)!;
  expect(updatedSeries.revision).toBe(1);
  expect(updatedSeries.games.filter((game) => game.status === "FINAL")).toHaveLength(1);
  expect(nextGame(updatedSeries).gameNumber).toBe(2);

  await page.reload();
  panel = await openPostseasonPanel(page);
  await selectConference(page, "WEST");
  await selectRound(page, "FIRST_ROUND");
  await expect(panel).toHaveAttribute("data-playoff-revision", String(after.data.postseason.playoffs.revision));
  await expect(page.getByTestId(`playoff-series-${playerSeries.seriesId}`)).toHaveAttribute(
    "data-series-score",
    `${updatedSeries.teamAWins}-${updatedSeries.teamBWins}`,
  );
  await expect(page.getByTestId(`simulate-playoff-${playerSeries.seriesId}-g2`)).toBeVisible();

  for (const gameNumber of [2, 3]) {
    const revision = (await readSave(page)).data.postseason.playoffs.revision;
    await page.getByTestId(`simulate-playoff-${playerSeries.seriesId}-g${gameNumber}`).click();
    await waitForPlayoffRevision(page, revision + 1);
  }

  after = await readSave(page);
  updatedSeries = after.data.postseason.playoffs.series.find((candidate) => candidate.seriesId === playerSeries.seriesId)!;
  const otherTeamId = updatedSeries.homeCourtTeamId === updatedSeries.teamAId
    ? updatedSeries.teamBId
    : updatedSeries.teamAId;
  expect(updatedSeries.games.map((game) => game.homeTeamId)).toEqual([
    updatedSeries.homeCourtTeamId,
    updatedSeries.homeCourtTeamId,
    otherTeamId,
    otherTeamId,
  ]);
  expect(updatedSeries.games.map((game) => game.status)).toEqual(["FINAL", "FINAL", "FINAL", "SCHEDULED"]);
  await expect(page.getByTestId(`playoff-series-${playerSeries.seriesId}`)).toContainText("下一场 G4");
});

test("cancels a playoff confirmation without changing the series", async ({ page }) => {
  const panel = await openPlayoffFixture(page);
  await selectConference(page, "WEST");
  await selectRound(page, "FIRST_ROUND");
  const save = await readSave(page);
  const series = findPlayerSeries(save, "FIRST_ROUND");
  const game = nextGame(series);
  const revision = await panel.getAttribute("data-playoff-revision");
  await page.getByTestId(`play-playoff-${series.seriesId}-g${game.gameNumber}`).click();
  await expect(page.getByRole("dialog", { name: "确认进入系列赛" })).toBeVisible();
  await page.getByTestId("cancel-playoff-game").click();
  await expect(page.getByRole("dialog", { name: "确认进入系列赛" })).toHaveCount(0);
  await expect(panel).toHaveAttribute("data-playoff-revision", revision ?? "0");
  await expect(page.getByTestId(`play-playoff-${series.seriesId}-g${game.gameNumber}`)).toBeVisible();
});

test("manually plays a series game with atomic storage retry and no career economy or regular-season mutation", async ({ page }) => {
  await openPlayoffFixture(page);
  await selectConference(page, "WEST");
  await selectRound(page, "FIRST_ROUND");
  const initial = await readSave(page);
  const playerSeries = findPlayerSeries(initial, "FIRST_ROUND");
  const game = nextGame(playerSeries);

  await page.getByTestId(`play-playoff-${playerSeries.seriesId}-g${game.gameNumber}`).click();
  const confirmation = page.getByRole("dialog", { name: "确认进入系列赛" });
  await expect(confirmation).toContainText("七场四胜");
  await expect(confirmation).toContainText("不增加常规赛统计、金币、默契");
  await expect(page.getByTestId("playoff-save-warning")).toContainText("系列赛结果不会被提前写入");
  await page.getByTestId("confirm-playoff-game").click();

  const match = page.getByTestId("game-screen");
  await expect(match).toHaveAttribute("data-match-mode", "CAREER");
  await expect(match).toHaveAttribute("data-career-context", "PLAYOFF_SERIES");
  await expect(match).toHaveAttribute("data-career-game-id", game.gameId);
  await page.clock.runFor(400);
  await expect(page.getByTestId("game-over-dialog")).toBeVisible();
  await expect(page.getByTestId("playoff-settlement-preview")).toContainText("不发放金币、不改变默契或常规赛统计");
  await expect(page.getByTestId("career-reward-preview")).toHaveCount(0);
  const before = await readSave(page);

  await page.evaluate(() => {
    const browserWindow = window as typeof window & { __playoffOriginalSetItem?: Storage["setItem"] };
    browserWindow.__playoffOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function blockedPlayoffWrite() {
      throw new DOMException("quota blocked for playoff test", "QuotaExceededError");
    };
  });
  await page.getByTestId("settle-playoff-game").click();
  await expect(page.getByTestId("game-over-dialog")).toBeVisible();
  await expect(page.getByTestId("playoff-settlement-error")).toContainText("系列赛结算失败");
  expect(await readSave(page)).toEqual(before);

  await page.evaluate(() => {
    const browserWindow = window as typeof window & { __playoffOriginalSetItem?: Storage["setItem"] };
    Storage.prototype.setItem = browserWindow.__playoffOriginalSetItem!;
    delete browserWindow.__playoffOriginalSetItem;
  });
  await page.getByTestId("settle-playoff-game").evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByTestId("postseason-panel")).toBeVisible();

  const after = await readSave(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.data.progression).toEqual(before.data.progression);
  expect(after.data.season).toEqual(before.data.season);
  expect(after.data.postseason.revision).toBe(before.data.postseason.revision + 1);
  expect(after.data.postseason.playoffs.revision).toBe(before.data.postseason.playoffs.revision + 1);
  expect(after.data.postseason.eventIds).toHaveLength(before.data.postseason.eventIds.length + 1);
  expect(after.data.postseason.playoffs.eventIds).toHaveLength(before.data.postseason.playoffs.eventIds.length + 1);

  await selectConference(page, "WEST");
  await selectRound(page, "FIRST_ROUND");
  const persistedSeries = after.data.postseason.playoffs.series.find((candidate) => candidate.seriesId === playerSeries.seriesId)!;
  await expect(page.getByTestId(`playoff-series-${playerSeries.seriesId}`)).toHaveAttribute(
    "data-series-score",
    `${persistedSeries.teamAWins}-${persistedSeries.teamBWins}`,
  );
  await expect(page.getByTestId(`simulate-playoff-${playerSeries.seriesId}-g2`)).toBeVisible();
});

test("keeps the remaining bracket simulatable after the created player is eliminated", async ({ page }) => {
  await openPlayoffFixture(page, { result: "loss" });
  await selectConference(page, "WEST");
  await selectRound(page, "FIRST_ROUND");
  const initial = await readSave(page);
  const playerTeamId = initial.data.destination.team.id;
  const playerSeriesId = findPlayerSeries(initial, "FIRST_ROUND").seriesId;

  for (let loss = 0; loss < 4; loss += 1) {
    const save = await readSave(page);
    const series = save.data.postseason.playoffs.series.find((candidate) => candidate.seriesId === playerSeriesId)!;
    const game = nextGame(series);
    await page.getByTestId(`play-playoff-${series.seriesId}-g${game.gameNumber}`).click();
    await page.getByTestId("confirm-playoff-game").click();
    await page.clock.runFor(400);
    await expect(page.getByTestId("game-over-dialog")).toBeVisible();
    await page.getByTestId("settle-playoff-game").click();
    await expect(page.getByTestId("postseason-panel")).toBeVisible();
    if (loss < 3) {
      await selectConference(page, "WEST");
      await selectRound(page, "FIRST_ROUND");
    }
  }

  let after = await readSave(page);
  const eliminatedSeries = after.data.postseason.playoffs.series.find((candidate) => candidate.seriesId === playerSeriesId)!;
  const playerWins = eliminatedSeries.teamAId === playerTeamId ? eliminatedSeries.teamAWins : eliminatedSeries.teamBWins;
  const opponentWins = eliminatedSeries.teamAId === playerTeamId ? eliminatedSeries.teamBWins : eliminatedSeries.teamAWins;
  expect(eliminatedSeries.status).toBe("FINAL");
  expect(eliminatedSeries.loserTeamId).toBe(playerTeamId);
  expect([playerWins, opponentWins]).toEqual([0, 4]);

  const panel = page.getByTestId("postseason-panel");
  await selectConference(page, "WEST");
  await selectRound(page, "FIRST_ROUND");
  await expect(page.getByTestId("player-postseason-status")).toContainText("首轮出局");
  await expect(page.locator('[data-testid^="play-playoff-"]')).toHaveCount(0);

  const otherSeries = after.data.postseason.playoffs.series.find((candidate) => (
    candidate.round === "FIRST_ROUND"
    && candidate.conference === "WEST"
    && candidate.seriesId !== playerSeriesId
    && candidate.status === "ACTIVE"
  ));
  expect(otherSeries).toBeTruthy();
  const otherGame = nextGame(otherSeries!);
  const revision = after.data.postseason.playoffs.revision;
  await page.getByTestId(`simulate-playoff-${otherSeries!.seriesId}-g${otherGame.gameNumber}`).click();
  await waitForPlayoffRevision(page, revision + 1);
  await expect(panel).toHaveAttribute("data-playoff-status", "IN_PROGRESS");
  after = await readSave(page);
  expect(after.data.postseason.playoffs.series.find((candidate) => candidate.seriesId === playerSeriesId)).toEqual(eliminatedSeries);
  await expect(page.getByTestId("player-postseason-status")).toContainText("首轮出局");
});

test("renders the generated Finals with one legal player game", async ({ page }) => {
  const panel = await openPlayoffFixture(page, { stage: "FINALS" });
  await selectRound(page, "FINALS");
  await expect(panel).toHaveAttribute("data-playoff-status", "IN_PROGRESS");
  const save = await readSave(page);
  const finals = findPlayerSeries(save, "FINALS");
  const card = page.getByTestId(`playoff-series-${finals.seriesId}`);
  await expect(page.getByTestId("postseason-view-finals").locator(".playoff-series")).toHaveCount(1);
  await expect(card).toHaveAttribute("data-status", "ACTIVE");
  await expect(card).toHaveAttribute("data-series-score", "0-0");
  await expect(card).toContainText("下一场 G1");
  await expect(page.getByTestId(`play-playoff-${finals.seriesId}-g1`)).toBeVisible();
  await expect(page.getByTestId(`simulate-playoff-${finals.seriesId}-g1`)).toBeVisible();

  await selectConference(page, "WEST");
  await expect(page.getByTestId(`playoff-series-${finals.seriesId}`)).toBeVisible();
  await selectConference(page, "EAST");
  await expect(page.getByTestId(`playoff-series-${finals.seriesId}`)).toBeVisible();
});

test("shows one persisted champion and no further playable Finals game", async ({ page }) => {
  let panel = await openPlayoffFixture(page, { stage: "COMPLETE" });
  await selectRound(page, "FINALS");
  await expect(panel).toHaveAttribute("data-playoff-status", "COMPLETE");
  const save = await readSave(page);
  const playoffs = save.data.postseason.playoffs;
  expect(playoffs.championTeamId).toBe(save.data.destination.team.id);
  expect(playoffs.championshipEventId).toBeTruthy();
  expect(playoffs.seasonCompletionEventId).toBeTruthy();
  expect(playoffs.eventIds).toContain(playoffs.championshipEventId);
  expect(playoffs.eventIds).toContain(playoffs.seasonCompletionEventId);

  const champion = page.getByTestId("playoff-champion");
  await expect(champion).toBeVisible();
  await expect(champion).toContainText("首年总冠军");
  await expect(champion).toContainText(save.data.destination.team.shortName);
  await expect(page.getByTestId("player-postseason-status")).toContainText("总冠军");
  await expect(page.getByTestId("postseason-view-finals").locator('[data-testid^="play-playoff-"]')).toHaveCount(0);
  await expect(page.getByTestId("postseason-view-finals").locator('[data-testid^="simulate-playoff-"]')).toHaveCount(0);

  await page.reload();
  panel = await openPostseasonPanel(page);
  await selectRound(page, "FINALS");
  await expect(panel).toHaveAttribute("data-playoff-status", "COMPLETE");
  await expect(page.getByTestId("playoff-champion")).toContainText(save.data.destination.team.shortName);
  const restored = await readSave(page);
  expect(restored.data.postseason.playoffs.championTeamId).toBe(playoffs.championTeamId);
  expect(restored.data.postseason.playoffs.championshipEventId).toBe(playoffs.championshipEventId);
  expect(restored.data.postseason.playoffs.seasonCompletionEventId).toBe(playoffs.seasonCompletionEventId);
});
