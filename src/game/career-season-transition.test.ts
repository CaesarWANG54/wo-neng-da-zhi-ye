import { describe, expect, it } from "vitest";
import {
  createPostseasonPerformanceState,
  recordPostseasonPlayerGame,
  type CareerPostseasonPerformanceState,
} from "./career-postseason-performance";
import {
  freezeRegularSeason,
  legalPlayoffGames,
  nextPlayInGame,
  nextSeriesGame,
  playInComplete,
  simulateNextPlayInGame,
  simulatePostseasonPlayoffGame,
  type PostseasonState,
} from "./career-postseason";
import {
  assertCareerProgression,
  createCareerProgression,
  type CareerProgressionState,
} from "./career-progression";
import {
  CAREER_SCHEDULE_RULES_VERSION,
  createCareerSeason,
  getCareerSeasonDescriptor,
  simulateCareerToDate,
  type CareerAward,
  type CareerSeasonState,
  type PlayerSeasonLine,
} from "./career-season";
import {
  acknowledgeCareerRetirement,
  assertCareerLifecycleState,
  assertPostseasonPerformanceConsistency,
  beginNextCareerSeason,
  createCareerLifecycleState,
  finalPlayerPostseasonGames,
  settleCareerSeasonTransition,
  type ApprovedRetirementContentEvent,
  type CareerLifecycleState,
  type CareerSeasonSummary,
} from "./career-season-transition";
import { RATING_IDS } from "./ratings";
import type { Ratings } from "./types";

const emptyLine = (): PlayerSeasonLine => ({
  games: 0,
  points: 0,
  rebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  made: 0,
  attempts: 0,
  threesMade: 0,
  threesAttempted: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
});

function ratingsAt(value: number): Ratings {
  return Object.fromEntries(RATING_IDS.map((ratingId) => [ratingId, value])) as unknown as Ratings;
}

function awardSet(seasonNumber: number): CareerAward[] {
  const ids: CareerAward["id"][] = ["MVP", "DPOY", "MIP", "COY", "ALL_LEAGUE", "ALL_DEFENSE"];
  if (seasonNumber === 1) ids.push("ROOKIE", "ALL_ROOKIE");
  return ids.map((id) => ({
    id,
    label: `奖项-${id}`,
    winnerName: `Synthetic ${id}`,
    teamId: "WIZARDS",
    reason: "确定性测试奖项",
  }));
}

function historicalSummary(seasonNumber: number, teamId: string): CareerSeasonSummary {
  const descriptor = getCareerSeasonDescriptor(seasonNumber);
  const completionId = `history-season-${seasonNumber}-complete`;
  return {
    id: `${completionId}:summary`,
    seasonNumber,
    seasonId: descriptor.seasonId,
    startDate: descriptor.startDate,
    endDate: descriptor.endDate,
    scheduleBasis: descriptor.scheduleBasis,
    scheduleRulesVersion: CAREER_SCHEDULE_RULES_VERSION,
    teamId,
    wins: 41,
    losses: 41,
    ageBefore: seasonNumber + 19,
    ageAfter: seasonNumber + 20,
    retired: false,
    regularSeasonStats: emptyLine(),
    postseasonCoverage: "COMPLETE",
    playInStats: emptyLine(),
    playoffStats: emptyLine(),
    postseasonStats: emptyLine(),
    awards: awardSet(seasonNumber),
    postseasonFinish: "MISSED_POSTSEASON",
    eastChampionTeamId: "CELTICS",
    westChampionTeamId: "LAKERS",
    championTeamId: "CELTICS",
    seasonCompletionEventId: completionId,
    ageDeclines: [],
    retirementNotices: [{
      id: `${completionId}:synthetic-retirement`,
      playerName: `Synthetic Veteran ${seasonNumber}`,
      teamId: "WIZARDS",
      age: 36,
      kind: "LEAGUE",
      contentStatus: "SYNTHETIC",
      reason: "合成联盟老将退役",
    }],
  };
}

function progressionForSeason(seasonNumber: number, overrides: Partial<CareerProgressionState> = {}) {
  const history = Array.from({ length: seasonNumber - 1 }, (_, index) => historicalSummary(index + 1, "WIZARDS"));
  const state = createCareerProgression(ratingsAt(75), {
    age: seasonNumber + 19,
    season: seasonNumber,
    coins: 777,
    chemistryPercent: 42,
  });
  return {
    ...state,
    processedSeasonIds: history.map((summary) => summary.seasonCompletionEventId),
    ...overrides,
  };
}

function completePostseason(season: CareerSeasonState): PostseasonState {
  const frozen = freezeRegularSeason(season);
  if (frozen.status !== "FROZEN") throw new Error(`fixture freeze failed: ${frozen.status}`);
  let state = frozen.state;
  let guard = 0;
  while ((!playInComplete(state, "EAST") || !playInComplete(state, "WEST")) && guard < 12) {
    for (const conference of ["EAST", "WEST"] as const) {
      if (!nextPlayInGame(state, conference)) continue;
      const result = simulateNextPlayInGame(state, conference, season.seed + guard * 31 + (conference === "EAST" ? 1 : 2));
      if (result.status !== "APPLIED") throw new Error(`fixture play-in failed: ${result.status}`);
      state = result.state;
    }
    guard += 1;
  }
  if (!playInComplete(state, "EAST") || !playInComplete(state, "WEST")) throw new Error("fixture play-in guard expired");

  guard = 0;
  while (state.playoffs.status !== "COMPLETE" && guard < 200) {
    const legal = legalPlayoffGames(state);
    if (legal.length === 0) throw new Error("fixture has no legal playoff game");
    const scheduledIds = new Set(legal.map((game) => game.gameId));
    const series = state.playoffs.series.find((candidate) => {
      const game = nextSeriesGame(state, candidate.seriesId);
      return game !== null && scheduledIds.has(game.gameId);
    });
    if (!series) throw new Error("fixture cannot locate a legal playoff series");
    const result = simulatePostseasonPlayoffGame(state, series.seriesId);
    if (result.status !== "APPLIED") throw new Error(`fixture playoff failed: ${result.status}`);
    state = result.state;
    guard += 1;
  }
  if (state.playoffs.status !== "COMPLETE") throw new Error("fixture playoff guard expired");
  return state;
}

const completedFixtureCache = new Map<string, { season: CareerSeasonState; postseason: PostseasonState }>();

function completedFixture(seasonNumber: number, seed = 20_260_901) {
  const key = `${seasonNumber}:${seed}`;
  const cached = completedFixtureCache.get(key);
  if (cached) return cached;
  const progression = progressionForSeason(seasonNumber);
  const shell = createCareerSeason("WIZARDS", "测试球员", seed, seasonNumber);
  const season = simulateCareerToDate(shell, shell.endDate, progression.ratings);
  const fixture = { season, postseason: completePostseason(season) };
  completedFixtureCache.set(key, fixture);
  return fixture;
}

function trackedPerformance(postseason: PostseasonState, playerTeamId: string) {
  let performance = createPostseasonPerformanceState(playerTeamId);
  for (const game of finalPlayerPostseasonGames(postseason, playerTeamId)) {
    const teamIsHome = game.homeTeamId === playerTeamId;
    const result = recordPostseasonPlayerGame(performance, {
      gameId: game.gameId,
      eventId: game.eventId,
      competition: game.competition,
      ...(game.round === undefined ? {} : { round: game.round }),
      source: "SIMULATED",
      teamId: playerTeamId,
      opponentTeamId: teamIsHome ? game.awayTeamId : game.homeTeamId,
      venue: teamIsHome ? "HOME" : "AWAY",
      teamScore: teamIsHome ? game.homeScore : game.awayScore,
      opponentScore: teamIsHome ? game.awayScore : game.homeScore,
      won: (teamIsHome ? game.homeScore : game.awayScore) > (teamIsHome ? game.awayScore : game.homeScore),
      playerLine: {
        points: 3,
        rebounds: 1,
        assists: 1,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        made: 1,
        attempts: 1,
        threesMade: 1,
        threesAttempted: 1,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
      },
    });
    if (result.status !== "APPLIED") throw new Error(`fixture performance failed: ${result.status}`);
    performance = result.state;
  }
  return performance;
}

function lifecycleForSeason(
  seasonNumber: number,
  teamId: string,
  performance: CareerPostseasonPerformanceState,
) {
  const completedSeasons = Array.from({ length: seasonNumber - 1 }, (_, index) => historicalSummary(index + 1, teamId));
  const base = createCareerLifecycleState(teamId, seasonNumber);
  const lifecycle: CareerLifecycleState = {
    ...base,
    postseasonPerformance: performance,
    completedSeasons,
    acknowledgedSeasonSummaryIds: completedSeasons.map((summary) => summary.id),
  };
  assertCareerLifecycleState(lifecycle);
  return lifecycle;
}

function participantFixture(seasonNumber = 1) {
  const fixture = completedFixture(seasonNumber);
  const playerTeamId = fixture.postseason.playoffs.series[0].teamAId;
  const season = { ...fixture.season, playerTeamId };
  const progression = progressionForSeason(seasonNumber);
  const performance = trackedPerformance(fixture.postseason, playerTeamId);
  const lifecycle = lifecycleForSeason(seasonNumber, playerTeamId, performance);
  return { season, postseason: fixture.postseason, progression, lifecycle, playerTeamId };
}

describe("M6B-3 career season transition", () => {
  it("rejects settlement before a unique champion and leaves every input untouched", () => {
    const { season } = completedFixture(1);
    const frozen = freezeRegularSeason(season);
    if (frozen.status !== "FROZEN") throw new Error("fixture freeze failed");
    const progression = progressionForSeason(1);
    const lifecycle = lifecycleForSeason(1, season.playerTeamId, createPostseasonPerformanceState(season.playerTeamId));
    const before = JSON.stringify({ progression, lifecycle });

    const result = settleCareerSeasonTransition(season, progression, frozen.state, lifecycle);

    expect(result.status).toBe("NOT_READY");
    expect(JSON.stringify({ progression, lifecycle })).toBe(before);
    expect(result.progression).toBe(progression);
    expect(result.lifecycle).toBe(lifecycle);
  });

  it("settles once, makes the identical completion event a NOOP, and rejects a conflicting season event", () => {
    const fixture = participantFixture();
    const applied = settleCareerSeasonTransition(fixture.season, fixture.progression, fixture.postseason, fixture.lifecycle);
    expect(applied.status).toBe("APPLIED");
    if (applied.status !== "APPLIED") return;

    const replay = settleCareerSeasonTransition(fixture.season, applied.progression, fixture.postseason, applied.lifecycle);
    expect(replay.status).toBe("NOOP");
    expect(replay.lifecycle).toBe(applied.lifecycle);
    expect(replay.progression).toBe(applied.progression);

    const conflict = structuredClone(applied.lifecycle);
    const summary = conflict.completedSeasons.at(-1)!;
    summary.seasonCompletionEventId = "different-season-completion";
    summary.id = `${summary.seasonCompletionEventId}:summary`;
    conflict.pendingSeasonSummaryId = summary.id;
    const rejected = settleCareerSeasonTransition(fixture.season, fixture.progression, fixture.postseason, conflict);
    expect(rejected).toMatchObject({ status: "REJECTED", reason: expect.stringContaining("不同") });

    const splitProgression = {
      ...fixture.progression,
      processedSeasonIds: [fixture.postseason.playoffs.seasonCompletionEventId!],
    };
    const split = settleCareerSeasonTransition(fixture.season, splitProgression, fixture.postseason, fixture.lifecycle);
    expect(split).toMatchObject({ status: "REJECTED", reason: expect.stringContaining("缺少") });
  });

  it("advances 20→21 without decline and initializes one projected next season while preserving progression economy", () => {
    const fixture = participantFixture();
    const progression: CareerProgressionState = {
      ...fixture.progression,
      secondaryProgressUnits: { threePoint: 50 },
    };
    const settled = settleCareerSeasonTransition(fixture.season, progression, fixture.postseason, fixture.lifecycle);
    expect(settled.status).toBe("APPLIED");
    if (settled.status !== "APPLIED") return;
    expect(settled.progression).toMatchObject({ age: 21, season: 2, retired: false, coins: 777, chemistryPercent: 42 });
    expect(settled.summary.ageDeclines).toEqual([]);
    expect(settled.progression.ratings).toEqual(progression.ratings);
    expect(settled.progression.secondaryProgressUnits).toEqual({ threePoint: 50 });

    const next = beginNextCareerSeason(fixture.season, settled.progression, settled.lifecycle);
    expect(next.status).toBe("APPLIED");
    if (next.status !== "APPLIED") return;
    expect(next.season).toMatchObject({
      seasonNumber: 2,
      scheduleBasis: "PROJECTED",
      scheduleRulesVersion: CAREER_SCHEDULE_RULES_VERSION,
      coins: 777,
      cupResolved: false,
      awards: [],
      playerStats: emptyLine(),
    });
    expect(next.season.games).toHaveLength(1_200);
    expect(next.lifecycle).toMatchObject({ currentSeasonNumber: 2, pendingSeasonSummaryId: null });
    expect(next.lifecycle.postseasonPerformance.byCompetition.PLAY_IN.totals.games).toBe(0);
    expect(next.lifecycle.postseasonPerformance.byCompetition.PLAYOFF.totals.games).toBe(0);
    expect(next.lifecycle.acknowledgedSeasonSummaryIds).toContain(settled.summary.id);

    const replay = beginNextCareerSeason(fixture.season, next.progression, next.lifecycle);
    expect(replay.status).toBe("NOOP");
    expect(replay.lifecycle).toBe(next.lifecycle);
  });

  it("applies the first deterministic age decline exactly at 31→32", () => {
    const { season, postseason } = completedFixture(12, 12_120_012);
    const progression = progressionForSeason(12);
    const lifecycle = lifecycleForSeason(12, season.playerTeamId, trackedPerformance(postseason, season.playerTeamId));

    const result = settleCareerSeasonTransition(season, progression, postseason, lifecycle);

    expect(result.status).toBe("APPLIED");
    if (result.status !== "APPLIED") return;
    expect(result.progression).toMatchObject({ age: 32, season: 13, retired: false });
    expect(result.summary.ageDeclines).toHaveLength(1);
    const decline = result.summary.ageDeclines[0];
    expect(decline.previousValue - decline.nextValue).toBe(1);
    expect(result.progression.ledger.slice(progression.ledger.length)).toMatchObject([{
      source: "AGE",
      ratingId: decline.ratingId,
      previousValue: decline.previousValue,
      nextValue: decline.nextValue,
    }]);
  });

  it("forces 39→40 retirement once, persists the created-player notice, and never creates season 21", () => {
    const { season, postseason } = completedFixture(20, 20_200_020);
    const progression = progressionForSeason(20);
    const lifecycle = lifecycleForSeason(20, season.playerTeamId, trackedPerformance(postseason, season.playerTeamId));

    const result = settleCareerSeasonTransition(season, progression, postseason, lifecycle);

    expect(result.status).toBe("APPLIED");
    if (result.status !== "APPLIED") return;
    expect(result.progression).toMatchObject({ age: 40, season: 20, retired: true });
    expect(result.summary.retired).toBe(true);
    expect(result.summary.ageDeclines).toEqual([]);
    expect(result.summary.retirementNotices).toContainEqual(expect.objectContaining({
      kind: "CREATED_PLAYER",
      age: 40,
      teamId: season.playerTeamId,
    }));
    expect(beginNextCareerSeason(season, result.progression, result.lifecycle)).toMatchObject({
      status: "REJECTED",
      reason: expect.stringContaining("退役"),
    });
    const acknowledged = acknowledgeCareerRetirement(result.progression, result.lifecycle);
    expect(acknowledged.pendingSeasonSummaryId).toBeNull();
    expect(acknowledged.acknowledgedSeasonSummaryIds).toContain(result.summary.id);
    expect(acknowledgeCareerRetirement(result.progression, acknowledged)).toBe(acknowledged);
  });

  it("requires every player-team postseason final to be tracked or truthfully marked legacy", () => {
    const fixture = participantFixture();
    const finals = finalPlayerPostseasonGames(fixture.postseason, fixture.playerTeamId);
    expect(finals.length).toBeGreaterThan(0);

    const missing = lifecycleForSeason(1, fixture.playerTeamId, createPostseasonPerformanceState(fixture.playerTeamId));
    expect(settleCareerSeasonTransition(fixture.season, fixture.progression, fixture.postseason, missing)).toMatchObject({
      status: "REJECTED",
      reason: expect.stringContaining("not fully accounted"),
    });

    const complete = settleCareerSeasonTransition(
      fixture.season,
      fixture.progression,
      fixture.postseason,
      fixture.lifecycle,
    );
    expect(complete.status).toBe("APPLIED");
    if (complete.status === "APPLIED") {
      expect(complete.summary.postseasonCoverage).toBe("COMPLETE");
      expect(complete.summary.postseasonStats.games).toBe(finals.length);
    }

    const legacyBase = createCareerLifecycleState(fixture.playerTeamId, 1, { legacyPostseason: fixture.postseason });
    expect(legacyBase.postseasonPerformance.coverage).toBe("PARTIAL_LEGACY");
    expect(legacyBase.postseasonPerformance.legacyUntrackedGameIds).toHaveLength(finals.length);
    const legacy = settleCareerSeasonTransition(
      fixture.season,
      fixture.progression,
      fixture.postseason,
      legacyBase,
    );
    expect(legacy.status).toBe("APPLIED");
    if (legacy.status === "APPLIED") {
      expect(legacy.summary.postseasonCoverage).toBe("PARTIAL_LEGACY");
      expect(legacy.summary.postseasonStats.games).toBe(0);
    }

    const futureRevision = {
      ...fixture.lifecycle.postseasonPerformance,
      trackingStartRevision: fixture.postseason.revision + 1,
    };
    expect(() => assertPostseasonPerformanceConsistency(futureRevision, fixture.postseason)).toThrow(/starts after/i);
    const zeroRevisionLegacy = {
      ...legacyBase.postseasonPerformance,
      trackingStartRevision: 0,
    };
    expect(() => assertPostseasonPerformanceConsistency(zeroRevisionLegacy, fixture.postseason)).toThrow(/non-zero/i);
    expect(() => assertPostseasonPerformanceConsistency(
      { ...createPostseasonPerformanceState(fixture.playerTeamId), trackingStartRevision: 1 },
      null,
    )).toThrow(/without a current postseason/i);
  });

  it("accepts only valid unique APPROVED retirement content and never lets bad content abort settlement", () => {
    const fixture = participantFixture();
    const approved: ApprovedRetirementContentEvent[] = [
      { id: "approved-one", seasonNumber: 1, playerName: "Licensed Veteran", teamId: "CELTICS", age: 38, reason: "已批准的退役剧情", rightsStatus: "APPROVED" },
      { id: "approved-one", seasonNumber: 1, playerName: "Duplicate", teamId: "LAKERS", age: 37, reason: "重复 ID", rightsStatus: "APPROVED" },
      { id: "blank-name", seasonNumber: 1, playerName: "   ", teamId: "CELTICS", age: 38, reason: "空姓名", rightsStatus: "APPROVED" },
      { id: "blank-reason", seasonNumber: 1, playerName: "Blank Reason", teamId: "CELTICS", age: 38, reason: "   ", rightsStatus: "APPROVED" },
      { id: "bad-age", seasonNumber: 1, playerName: "Bad Age", teamId: "CELTICS", age: 41, reason: "非法年龄", rightsStatus: "APPROVED" },
      { id: "bad-team", seasonNumber: 1, playerName: "Bad Team", teamId: "UNKNOWN", age: 38, reason: "非法球队", rightsStatus: "APPROVED" },
      { id: "wrong-season", seasonNumber: 2, playerName: "Wrong Season", teamId: "CELTICS", age: 38, reason: "其他赛季", rightsStatus: "APPROVED" },
      { id: "review", seasonNumber: 1, playerName: "Review", teamId: "CELTICS", age: 38, reason: "待审核", rightsStatus: "REVIEW" },
      { id: "blocked", seasonNumber: 1, playerName: "Blocked", teamId: "CELTICS", age: 38, reason: "禁止", rightsStatus: "BLOCKED" },
    ];

    expect(() => settleCareerSeasonTransition(
      fixture.season,
      fixture.progression,
      fixture.postseason,
      fixture.lifecycle,
      approved,
    )).not.toThrow();
    const result = settleCareerSeasonTransition(
      fixture.season,
      fixture.progression,
      fixture.postseason,
      fixture.lifecycle,
      approved,
    );
    expect(result.status).toBe("APPLIED");
    if (result.status !== "APPLIED") return;
    const approvedNotices = result.summary.retirementNotices.filter((notice) => notice.contentStatus === "APPROVED");
    expect(approvedNotices).toEqual([expect.objectContaining({
      id: expect.stringContaining("approved-one"),
      playerName: "Licensed Veteran",
      reason: "已批准的退役剧情",
    })]);
    expect(result.summary.retirementNotices.filter((notice) => notice.contentStatus === "SYNTHETIC")).toHaveLength(2);
  });

  it("keeps lifecycle acknowledgements complete and rejects missing historical confirmation", () => {
    const valid = lifecycleForSeason(2, "WIZARDS", createPostseasonPerformanceState("WIZARDS"));
    const invalid = { ...valid, acknowledgedSeasonSummaryIds: [] };
    expect(() => assertCareerLifecycleState(invalid)).toThrow(/every non-pending summary/i);
  });

  it("SOAK-001 deterministically closes 20 full seasons at age 40 with compact replayable history", () => {
    let progression = createCareerProgression(ratingsAt(75), { coins: 777, chemistryPercent: 42 });
    let lifecycle = createCareerLifecycleState("WIZARDS");
    let season = createCareerSeason("WIZARDS", "耐久测试球员", 6_003_001);
    let maxSerializedBytes = 0;

    for (let seasonNumber = 1; seasonNumber <= 20; seasonNumber += 1) {
      season = simulateCareerToDate(season, season.endDate, progression.ratings);
      const postseason = completePostseason(season);
      lifecycle = {
        ...lifecycle,
        postseasonPerformance: trackedPerformance(postseason, season.playerTeamId),
      };
      const settled = settleCareerSeasonTransition(season, progression, postseason, lifecycle);
      expect(settled.status, `settle season ${seasonNumber}`).toBe("APPLIED");
      if (settled.status !== "APPLIED") throw new Error(`soak settlement ${seasonNumber} failed`);
      progression = settled.progression;
      lifecycle = settled.lifecycle;
      expect(lifecycle.completedSeasons).toHaveLength(seasonNumber);
      expect(new Set(lifecycle.completedSeasons.map((summary) => summary.seasonCompletionEventId)).size).toBe(seasonNumber);
      expect(Object.values(progression.ratings).every((rating) => rating >= 25 && rating <= 99)).toBe(true);
      maxSerializedBytes = Math.max(maxSerializedBytes, new TextEncoder().encode(JSON.stringify({ season, postseason, progression, lifecycle })).length);

      if (seasonNumber < 20) {
        const next = beginNextCareerSeason(season, progression, lifecycle);
        expect(next.status, `begin season ${seasonNumber + 1}`).toBe("APPLIED");
        if (next.status !== "APPLIED") throw new Error(`soak next season ${seasonNumber + 1} failed`);
        season = next.season;
        progression = next.progression;
        lifecycle = next.lifecycle;
      }
    }

    expect(progression).toMatchObject({ age: 40, season: 20, retired: true, coins: 777, chemistryPercent: 42 });
    expect(lifecycle.completedSeasons).toHaveLength(20);
    expect(lifecycle.pendingSeasonSummaryId).toBe(lifecycle.completedSeasons[19].id);
    expect(beginNextCareerSeason(season, progression, lifecycle).status).toBe("REJECTED");
    expect(maxSerializedBytes).toBeLessThan(2_000_000);

    const roundTrip = JSON.parse(JSON.stringify({ progression, lifecycle })) as {
      progression: CareerProgressionState;
      lifecycle: CareerLifecycleState;
    };
    expect(() => assertCareerProgression(roundTrip.progression)).not.toThrow();
    expect(() => assertCareerLifecycleState(roundTrip.lifecycle)).not.toThrow();
    expect(roundTrip).toEqual({ progression, lifecycle });
  }, 30_000);
});
