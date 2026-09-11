import { describe, expect, it } from "vitest";
import { applyTrainingSession, createCareerProgression, settleCareerGameReward } from "./career-progression";
import { CAREER_SEASON_END, createCareerSeason, simulateCareerToDate } from "./career-season";
import {
  beginNextCareerSeason,
  createCareerLifecycleState,
  settleCareerSeasonTransition,
} from "./career-season-transition";
import {
  freezeRegularSeason,
  recordPlayInResult,
  recordPostseasonPlayoffResult,
  type PostseasonState,
} from "./career-postseason";
import { createPlayerProfile, leagueTeams, resolveCareerDestination, type CareerDestination } from "./player-creation";
import {
  CAREER_SAVE_SCHEMA_VERSION,
  CAREER_SAVE_PLAYOFF_SCHEMA_VERSION,
  CAREER_SAVE_POSTSEASON_V1_SCHEMA_VERSION,
  createCareerSave,
  loadCareerSave,
  parseCareerSave,
  serializeCareerSave,
  updateCareerSave,
  type CareerSaveData,
} from "./career-save";

function data(overrides: Partial<Omit<CareerSaveData, "firstYearRouteResolved">> = {}): Omit<CareerSaveData, "firstYearRouteResolved"> {
  const profile = overrides.profile ?? createPlayerProfile({ displayName: "测试新秀", position: "PG", templateId: "PG_FLOOR_GENERAL", jerseyNumber: 0 });
  const team = leagueTeams.find((item) => item.id === "LAKERS")!;
  const destination = overrides.destination ?? { route: "DIRECT_SIGNING", team, seed: 20_260_901, explanation: "自主加入湖人" } satisfies CareerDestination;
  const season = overrides.season ?? createCareerSeason(destination.team.id, profile.displayName, destination.seed);
  const lifecycle = overrides.lifecycle ?? createCareerLifecycleState(destination.team.id, season.seasonNumber, {
    legacyPostseason: overrides.postseason,
  });
  return {
    stage: "CAREER_HOME",
    profile,
    destination,
    season,
    progression: createCareerProgression(profile.ratings),
    lifecycle,
    settings: { difficulty: "ROOKIE", volume: 42, gameMinutes: 8 },
    ...overrides,
  };
}

const fresh = () => createCareerSave("career-slot-1", data());

describe("career save root envelope", () => {
  it("creates and round-trips a complete resolved first-year career", () => {
    const save = fresh();
    expect(save).toMatchObject({ schemaVersion: 4, revision: 1, data: { firstYearRouteResolved: true } });
    expect(parseCareerSave(serializeCareerSave(save))).toEqual({ status: "VALID", save });
  });

  it("preserves non-trivial progression, season and settings transactionally", () => {
    const initial = fresh();
    let progression = applyTrainingSession(initial.data.progression, { sessionId: "w1-shot", groupId: "SHOOTING", primaryRatingId: "threePoint" });
    progression = settleCareerGameReward(progression, { rewardId: "g1", difficulty: "STARTER", gameMinutes: 8, mode: "PLAYED", completed: true });
    const season = { ...simulateCareerToDate(initial.data.season, "2026-10-20", progression.ratings), coins: progression.coins };
    const next = updateCareerSave(initial, { progression, season, settings: { difficulty: "STARTER", volume: 70, gameMinutes: 12 } });
    const loaded = loadCareerSave(serializeCareerSave(next));
    expect(loaded).toEqual({ status: "LOADED", save: next });
    expect(next.data.progression.ledger).toHaveLength(1);
    expect(next.revision).toBe(2);
  });

  it("returns safe empty recovery states for no save and corrupt saves", () => {
    expect(loadCareerSave(null)).toEqual({ status: "NO_SAVE", save: null });
    expect(loadCareerSave("not-json")).toMatchObject({ status: "RECOVERY_REQUIRED", reason: "CORRUPT_SAVE", save: null });
  });

  it("rejects a future version without replacing it", () => {
    const raw = { ...fresh(), schemaVersion: CAREER_SAVE_SCHEMA_VERSION + 1 };
    expect(loadCareerSave(JSON.stringify(raw))).toMatchObject({ status: "FUTURE_VERSION_REJECTED", foundVersion: CAREER_SAVE_SCHEMA_VERSION + 1, save: null });
  });

  it("rejects profile/template/jersey/baseline corruption", () => {
    const base = fresh();
    const template = { ...base, data: { ...base.data, profile: { ...base.data.profile, templateId: "C_PAINT_DOMINATOR" } } };
    const jersey = { ...base, data: { ...base.data, profile: { ...base.data.profile, jerseyNumber: 100 } } };
    const baseline = { ...base, data: { ...base.data, progression: { ...base.data.progression, rookieBaseline: { ...base.data.progression.rookieBaseline, threePoint: 25 } } } };
    expect(parseCareerSave(JSON.stringify(template)).status).toBe("INVALID");
    expect(parseCareerSave(JSON.stringify(jersey)).status).toBe("INVALID");
    expect(parseCareerSave(JSON.stringify(baseline)).status).toBe("INVALID");
  });

  it("rejects team, player and coin divergence across slices", () => {
    const base = fresh();
    const team = { ...base, data: { ...base.data, season: { ...base.data.season, playerTeamId: "BULLS" } } };
    const name = { ...base, data: { ...base.data, season: { ...base.data.season, playerName: "错误球员" } } };
    const coins = { ...base, data: { ...base.data, progression: { ...base.data.progression, coins: 90 } } };
    expect(parseCareerSave(JSON.stringify(team)).status).toBe("INVALID");
    expect(parseCareerSave(JSON.stringify(name)).status).toBe("INVALID");
    expect(parseCareerSave(JSON.stringify(coins)).status).toBe("INVALID");
  });

  it("rejects lifecycle, progression and postseason-stat cross-slice tampering", () => {
    const seasonNumber = structuredClone(fresh());
    seasonNumber.data.lifecycle.currentSeasonNumber = 2;
    const performanceTeam = structuredClone(fresh());
    performanceTeam.data.lifecycle.postseasonPerformance.playerTeamId = "BULLS";
    const progressionSeason = structuredClone(fresh());
    progressionSeason.data.progression.season = 2;
    const forgedAcknowledgement = structuredClone(fresh());
    forgedAcknowledgement.data.lifecycle.acknowledgedSeasonSummaryIds = ["unknown-summary"];
    for (const corrupt of [seasonNumber, performanceTeam, progressionSeason, forgedAcknowledgement]) {
      expect(parseCareerSave(JSON.stringify(corrupt)).status).toBe("INVALID");
    }
  });

  it("rejects season metadata, schedule source and game-ID namespace drift", () => {
    const metadata = structuredClone(fresh());
    metadata.data.season.seasonId = "2027-28";
    const source = structuredClone(fresh());
    source.data.season.games[0].source = "PROJECTED";
    const gameId = structuredClone(fresh());
    gameId.data.season.games[0].id = "season-2-projected-1";
    for (const corrupt of [metadata, source, gameId]) {
      expect(parseCareerSave(JSON.stringify(corrupt)).status).toBe("INVALID");
    }
  });

  it("rejects unpaired, unknown, scheduled, and non-player career-game settlement markers", () => {
    const base = fresh();
    const playerGame = base.data.season.games.find((game) => game.awayTeamId === "LAKERS" || game.homeTeamId === "LAKERS")!;
    const withMarkers = (save: typeof base, gameId: string, paired = true) => ({
      ...save,
      data: {
        ...save.data,
        progression: {
          ...save.data.progression,
          processedRewardIds: [`career-game:${gameId}:reward`],
          processedChemistryEventIds: paired ? [`career-game:${gameId}:outcome`] : [],
        },
      },
    });
    expect(parseCareerSave(JSON.stringify(withMarkers(base, playerGame.id, false))).status).toBe("INVALID");
    expect(parseCareerSave(JSON.stringify(withMarkers(base, "missing-game"))).status).toBe("INVALID");
    expect(parseCareerSave(JSON.stringify(withMarkers(base, playerGame.id))).status).toBe("INVALID");

    const simulatedSeason = simulateCareerToDate(base.data.season, "2026-10-20", base.data.progression.ratings);
    const nonPlayerFinal = simulatedSeason.games.find((game) => game.status === "FINAL" && game.awayTeamId !== "LAKERS" && game.homeTeamId !== "LAKERS")!;
    const simulatedSave = { ...base, data: { ...base.data, season: simulatedSeason } };
    expect(parseCareerSave(JSON.stringify(withMarkers(simulatedSave, nonPlayerFinal.id))).status).toBe("INVALID");
  });

  it("strictly checks 30-team standings, games/dates/scores and seed", () => {
    const missing = structuredClone(fresh());
    delete (missing.data.season.standings as Partial<typeof missing.data.season.standings>).BULLS;
    const date = structuredClone(fresh()); date.data.season.currentDate = "2026-02-30";
    const score = structuredClone(fresh()); score.data.season.games[0] = { ...score.data.season.games[0], status: "FINAL", result: { awayScore: 301, homeScore: 90 } };
    const seed = structuredClone(fresh()); seed.data.season.seed = -1;
    for (const corrupt of [missing, date, score, seed]) expect(parseCareerSave(JSON.stringify(corrupt)).status).toBe("INVALID");
  });

  it("requires valid settings and a permanently resolved route", () => {
    const base = fresh();
    const volume = { ...base, data: { ...base.data, settings: { ...base.data.settings, volume: 101 } } };
    const unresolved = { ...base, data: { ...base.data, firstYearRouteResolved: false } };
    expect(parseCareerSave(JSON.stringify(volume)).status).toBe("INVALID");
    expect(parseCareerSave(JSON.stringify(unresolved)).status).toBe("INVALID");
    expect(() => updateCareerSave(base, { destination: { ...base.data.destination, team: leagueTeams[0] } } as never)).toThrow(/cannot update destination/i);
  });

  it("allows draft ceremony completion but forbids rewinding", () => {
    const profile = data().profile;
    const team = leagueTeams.find((item) => item.id === "WIZARDS")!;
    const destination: CareerDestination = { route: "DRAFT", team, draftPick: 1, seed: 99, explanation: "首轮第一顺位" };
    const ceremony = createCareerSave("draft", data({ stage: "DRAFT_CEREMONY", profile, destination, season: createCareerSeason(team.id, profile.displayName, 99) }));
    const home = updateCareerSave(ceremony, { stage: "CAREER_HOME" });
    expect(home.data.stage).toBe("CAREER_HOME");
    expect(() => updateCareerSave(home, { stage: "DRAFT_CEREMONY" })).toThrow(/cannot return/i);
  });

  it("round-trips a first-year undrafted ceremony without admitting ordinary direct selection", () => {
    const profile = data().profile;
    const destination = resolveCareerDestination({ position: profile.position, evaluationScore: 45, seed: 20_260_901 });
    expect(destination.route).toBe("DIRECT_SIGNING");
    const season = createCareerSeason(destination.team.id, profile.displayName, destination.seed);
    const ceremony = createCareerSave("undrafted", data({
      stage: "DRAFT_CEREMONY",
      profile,
      destination,
      season,
      lifecycle: createCareerLifecycleState(destination.team.id),
    }));

    expect(loadCareerSave(serializeCareerSave(ceremony))).toEqual({ status: "LOADED", save: ceremony });
    expect(updateCareerSave(ceremony, { stage: "CAREER_HOME" }).data.stage).toBe("CAREER_HOME");

    const manuallySelected = data({
      stage: "DRAFT_CEREMONY",
      profile,
      destination: { ...destination, explanation: `已自主选择加入${destination.team.shortName}` },
      season,
      lifecycle: createCareerLifecycleState(destination.team.id),
    });
    expect(() => createCareerSave("invalid-direct-ceremony", manuallySelected)).toThrow(/drafted player or a first-round undrafted/i);
  });
});

describe("career save schema v4 lifecycle and postseason slices", () => {
  function seasonAtEnd() {
    const profile = createPlayerProfile({ displayName: "测试新秀", position: "PG", templateId: "PG_FLOOR_GENERAL", jerseyNumber: 0 });
    return simulateCareerToDate(createCareerSeason("LAKERS", profile.displayName, 20_260_901), CAREER_SEASON_END, profile.ratings);
  }

  function frozenSave() {
    const season = seasonAtEnd();
    const frozen = freezeRegularSeason(season);
    if (frozen.status !== "FROZEN") throw new Error("fixture freeze failed");
    const base = data({ season });
    const save = createCareerSave("career-slot-postseason", base);
    return updateCareerSave(save, {
      season,
      postseason: frozen.state,
      lifecycle: createCareerLifecycleState(season.playerTeamId, season.seasonNumber, { legacyPostseason: frozen.state }),
    });
  }

  function progressedSave() {
    const season = seasonAtEnd();
    const frozen = freezeRegularSeason(season);
    if (frozen.status !== "FROZEN") throw new Error("fixture freeze failed");
    let postseason = frozen.state;
    for (const [conference, slot] of [
      ["EAST", "A"],
      ["WEST", "A"],
      ["EAST", "B"],
      ["EAST", "C"],
    ] as const) {
      const applied = recordPlayInResult(postseason, conference, slot, { homeScore: 108, awayScore: 99 });
      if (applied.status !== "APPLIED") throw new Error(`${conference}-${slot} fixture failed`);
      postseason = applied.state;
    }
    return updateCareerSave(createCareerSave("career-slot-postseason-progressed", data({ season })), {
      season,
      postseason,
      lifecycle: createCareerLifecycleState(season.playerTeamId, season.seasonNumber, { legacyPostseason: postseason }),
    });
  }

  function completePlayIns(initial: PostseasonState) {
    let postseason = initial;
    for (const conference of ["EAST", "WEST"] as const) {
      for (const slot of ["A", "B", "C"] as const) {
        const applied = recordPlayInResult(postseason, conference, slot, { homeScore: 108, awayScore: 99 });
        if (applied.status !== "APPLIED") throw new Error(`${conference}-${slot} fixture failed`);
        postseason = applied.state;
      }
    }
    return postseason;
  }

  function playoffProgressedSave() {
    const season = seasonAtEnd();
    const frozen = freezeRegularSeason(season);
    if (frozen.status !== "FROZEN") throw new Error("fixture freeze failed");
    let postseason = completePlayIns(frozen.state);
    const firstSeries = postseason.playoffs.series[0];
    const applied = recordPostseasonPlayoffResult(postseason, firstSeries.seriesId, 1, { homeScore: 112, awayScore: 103 });
    if (applied.status !== "APPLIED") throw new Error("playoff fixture failed");
    postseason = applied.state;
    return updateCareerSave(createCareerSave("career-slot-playoff-progressed", data({ season })), {
      season,
      postseason,
      lifecycle: createCareerLifecycleState(season.playerTeamId, season.seasonNumber, { legacyPostseason: postseason }),
    });
  }

  function finishSeries(initial: PostseasonState, seriesId: string) {
    let postseason = initial;
    while (true) {
      const series = postseason.playoffs.series.find((candidate) => candidate.seriesId === seriesId);
      if (!series) throw new Error(`missing series ${seriesId}`);
      if (series.status === "FINAL") return postseason;
      const game = series.games.find((candidate) => candidate.status === "SCHEDULED");
      if (!game) throw new Error(`missing scheduled game in ${seriesId}`);
      const teamAIsHome = game.homeTeamId === series.teamAId;
      const applied = recordPostseasonPlayoffResult(
        postseason,
        seriesId,
        game.gameNumber,
        teamAIsHome ? { homeScore: 108, awayScore: 99 } : { homeScore: 99, awayScore: 108 },
      );
      if (applied.status !== "APPLIED") throw new Error(`cannot finish ${seriesId}: ${applied.reason}`);
      postseason = applied.state;
    }
  }

  function finishRound(
    initial: PostseasonState,
    round: PostseasonState["playoffs"]["series"][number]["round"],
  ) {
    let postseason = initial;
    const seriesIds = postseason.playoffs.series
      .filter((series) => series.round === round)
      .map((series) => series.seriesId);
    if (seriesIds.length === 0) throw new Error(`round ${round} is not ready`);
    for (const seriesId of seriesIds) postseason = finishSeries(postseason, seriesId);
    return postseason;
  }

  function completedFirstSeasonFixture() {
    const firstSeason = seasonAtEnd();
    const frozen = freezeRegularSeason(firstSeason);
    if (frozen.status !== "FROZEN") throw new Error("fixture freeze failed");
    let postseason = completePlayIns(frozen.state);
    postseason = finishRound(postseason, "FIRST_ROUND");
    postseason = finishRound(postseason, "CONFERENCE_SEMIFINALS");
    postseason = finishRound(postseason, "CONFERENCE_FINALS");
    postseason = finishRound(postseason, "FINALS");
    const base = data({ season: firstSeason });
    const lifecycle = createCareerLifecycleState(firstSeason.playerTeamId, 1, { legacyPostseason: postseason });
    return { firstSeason, postseason, base, lifecycle };
  }

  function nextSeasonSave() {
    const { firstSeason, postseason, base, lifecycle } = completedFirstSeasonFixture();
    const settled = settleCareerSeasonTransition(firstSeason, base.progression, postseason, lifecycle);
    if (settled.status !== "APPLIED") throw new Error(`season settlement failed: ${settled.reason}`);
    const begun = beginNextCareerSeason(firstSeason, settled.progression, settled.lifecycle);
    if (begun.status !== "APPLIED") throw new Error(`next season failed: ${begun.reason}`);
    return createCareerSave("career-slot-season-2", data({
      season: begun.season,
      progression: begun.progression,
      lifecycle: begun.lifecycle,
    }));
  }

  function legacyPostseasonV1(postseason: PostseasonState) {
    const legacy = structuredClone(postseason) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 1;
    delete legacy.playoffSeedPool;
    delete legacy.playoffs;
    return legacy;
  }

  function stripLegacySeasonMetadata(rawData: Record<string, unknown>) {
    const season = rawData.season as Record<string, unknown>;
    for (const field of ["seasonNumber", "seasonId", "scheduleRulesVersion", "startYear", "startDate", "endDate", "cupResolutionDate", "scheduleBasis"]) {
      delete season[field];
    }
  }

  it("uses postseason null as an explicit persisted clear operation", () => {
    const frozen = frozenSave();
    expect(frozen.data.postseason).toBeDefined();
    const cleared = updateCareerSave(frozen, { postseason: null });
    expect(cleared.revision).toBe(frozen.revision + 1);
    expect("postseason" in cleared.data).toBe(false);
    expect(loadCareerSave(serializeCareerSave(cleared))).toEqual({ status: "LOADED", save: cleared });
  });

  it("round-trips a projected second season with one archived first-season summary", () => {
    const save = nextSeasonSave();
    expect(save.data.season).toMatchObject({
      seasonNumber: 2,
      seasonId: "2027-28",
      scheduleBasis: "PROJECTED",
    });
    expect(save.data.season.games.every((game) => game.source === "PROJECTED" && game.id.startsWith("season-2-projected-"))).toBe(true);
    expect(save.data.lifecycle.completedSeasons).toHaveLength(1);
    expect(save.data.lifecycle.acknowledgedSeasonSummaryIds).toEqual([save.data.lifecycle.completedSeasons[0].id]);
    expect(loadCareerSave(serializeCareerSave(save))).toEqual({ status: "LOADED", save });
  });

  it("accepts paired reward markers from an archived season and rejects unarchived or live scheduled IDs", () => {
    const base = nextSeasonSave();
    const withMarkers = (gameId: string) => ({
      ...base,
      data: {
        ...base.data,
        progression: {
          ...base.data.progression,
          processedRewardIds: [...base.data.progression.processedRewardIds, `career-game:${gameId}:reward`],
          processedChemistryEventIds: [...base.data.progression.processedChemistryEventIds, `career-game:${gameId}:outcome`],
        },
      },
    });
    expect(parseCareerSave(JSON.stringify(withMarkers("published-5"))).status).toBe("VALID");
    expect(parseCareerSave(JSON.stringify(withMarkers("season-3-projected-1"))).status).toBe("INVALID");
    expect(parseCareerSave(JSON.stringify(withMarkers(base.data.season.games[0].id))).status).toBe("INVALID");
  });

  it("rejects pending season-summary, processed-season and completed-postseason drift", () => {
    const { firstSeason, postseason, base, lifecycle } = completedFirstSeasonFixture();
    const settled = settleCareerSeasonTransition(firstSeason, base.progression, postseason, lifecycle);
    if (settled.status !== "APPLIED") throw new Error(`settlement fixture failed: ${settled.reason}`);
    const save = createCareerSave("career-slot-pending-summary", {
      ...base,
      season: firstSeason,
      progression: settled.progression,
      lifecycle: settled.lifecycle,
      postseason,
    });
    expect(loadCareerSave(serializeCareerSave(save))).toEqual({ status: "LOADED", save });

    const summary = structuredClone(save);
    summary.data.lifecycle.completedSeasons[0].wins += 1;
    summary.data.lifecycle.completedSeasons[0].losses -= 1;
    const processed = structuredClone(save);
    processed.data.progression.processedSeasonIds = [];
    const bracket = structuredClone(save);
    bracket.data.postseason!.playoffs.seasonCompletionEventId = `${bracket.data.postseason!.playoffs.seasonCompletionEventId}:forged`;
    for (const corrupt of [summary, processed, bracket]) {
      expect(parseCareerSave(JSON.stringify(corrupt)).status).toBe("INVALID");
    }
  });

  it("migrates a legacy root v1 career to v4 without gameplay data loss", () => {
    const v4 = frozenSave();
    const raw = JSON.parse(JSON.stringify(v4)) as Record<string, unknown>;
    raw.schemaVersion = 1;
    const dataSlice = raw.data as Record<string, unknown>;
    delete dataSlice.postseason;
    delete dataSlice.lifecycle;
    stripLegacySeasonMetadata(dataSlice);
    const loaded = loadCareerSave(JSON.stringify(raw));
    expect(loaded.status).toBe("LOADED");
    if (loaded.status !== "LOADED") return;
    expect(loaded.save.schemaVersion).toBe(4);
    expect(loaded.save.data.postseason).toBeUndefined();
    expect(loaded.save.data.lifecycle).toEqual(createCareerLifecycleState(v4.data.season.playerTeamId));
    expect(loaded.save.data.season).toEqual(v4.data.season);
    expect(loaded.save.data.progression).toEqual(v4.data.progression);
    expect(loaded.save.data.profile).toEqual(v4.data.profile);
    expect(loaded.save.revision).toBe(v4.revision);
  });

  it("migrates an authentic root v3 save with no lifecycle or season metadata", () => {
    const source = fresh();
    const raw = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
    raw.schemaVersion = CAREER_SAVE_PLAYOFF_SCHEMA_VERSION;
    const rawData = raw.data as Record<string, unknown>;
    delete rawData.lifecycle;
    stripLegacySeasonMetadata(rawData);
    const loaded = loadCareerSave(JSON.stringify(raw));
    expect(loaded.status).toBe("LOADED");
    if (loaded.status !== "LOADED") return;
    expect(loaded.save.schemaVersion).toBe(4);
    expect(loaded.save.revision).toBe(source.revision);
    expect(loaded.save.data.season).toMatchObject({
      seasonNumber: 1,
      seasonId: "2026-27",
      startYear: 2026,
      scheduleBasis: "PUBLISHED_2026_27",
    });
    expect(loaded.save.data.lifecycle).toEqual(createCareerLifecycleState(source.data.season.playerTeamId));
    expect(loaded.save.data.progression).toEqual(source.data.progression);
  });

  it("migrates completed v3 postseason games as explicit partial legacy coverage", () => {
    const { firstSeason, postseason, base, lifecycle } = completedFirstSeasonFixture();
    const source = createCareerSave("career-slot-v3-complete", {
      ...base,
      season: firstSeason,
      postseason,
      lifecycle,
    });
    const raw = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
    raw.schemaVersion = CAREER_SAVE_PLAYOFF_SCHEMA_VERSION;
    delete (raw.data as Record<string, unknown>).lifecycle;
    const loaded = loadCareerSave(JSON.stringify(raw));
    expect(loaded.status).toBe("LOADED");
    if (loaded.status !== "LOADED") return;
    expect(loaded.save.revision).toBe(source.revision);
    expect(loaded.save.data.progression).toEqual(source.data.progression);
    expect(loaded.save.data.postseason).toEqual(postseason);
    expect(loaded.save.data.lifecycle.postseasonPerformance.coverage).toBe("PARTIAL_LEGACY");
    expect(loaded.save.data.lifecycle.postseasonPerformance.legacyUntrackedGameIds.length).toBeGreaterThan(0);
    expect(loaded.save.data.lifecycle.postseasonPerformance.trackingStartRevision).toBe(postseason.revision);
  });

  it("migrates root v2 plus nested M6B-1 v1 without changing gameplay revisions or events", () => {
    const current = progressedSave();
    const sourcePostseason = current.data.postseason!;
    const raw = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    raw.schemaVersion = CAREER_SAVE_POSTSEASON_V1_SCHEMA_VERSION;
    const rawData = raw.data as Record<string, unknown>;
    rawData.postseason = legacyPostseasonV1(sourcePostseason);
    delete rawData.lifecycle;
    stripLegacySeasonMetadata(rawData);

    const loaded = loadCareerSave(JSON.stringify(raw));
    expect(loaded.status).toBe("LOADED");
    if (loaded.status !== "LOADED") return;
    expect(loaded.save.schemaVersion).toBe(CAREER_SAVE_SCHEMA_VERSION);
    expect(loaded.save.revision).toBe(current.revision);
    expect(loaded.save.data.postseason).toMatchObject({
      schemaVersion: 2,
      revision: sourcePostseason.revision,
      eventIds: sourcePostseason.eventIds,
      playIn: sourcePostseason.playIn,
    });
    expect(loaded.save.data.postseason?.playoffs.status).toBe("WAITING_FOR_PLAY_IN");
    expect(loaded.save.data.season).toEqual(current.data.season);
    expect(loaded.save.data.progression).toEqual(current.data.progression);
  });

  it("rebuilds the fixed first round when a completed root-v2 play-in is migrated", () => {
    const season = seasonAtEnd();
    const frozen = freezeRegularSeason(season);
    if (frozen.status !== "FROZEN") throw new Error("fixture freeze failed");
    const sourcePostseason = completePlayIns(frozen.state);
    const current = updateCareerSave(createCareerSave("career-slot-v2-complete", data({ season })), {
      season,
      postseason: sourcePostseason,
      lifecycle: createCareerLifecycleState(season.playerTeamId, season.seasonNumber, { legacyPostseason: sourcePostseason }),
    });
    const raw = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    raw.schemaVersion = CAREER_SAVE_POSTSEASON_V1_SCHEMA_VERSION;
    const rawData = raw.data as Record<string, unknown>;
    rawData.postseason = legacyPostseasonV1(sourcePostseason);
    delete rawData.lifecycle;
    stripLegacySeasonMetadata(rawData);

    const loaded = loadCareerSave(JSON.stringify(raw));
    expect(loaded.status).toBe("LOADED");
    if (loaded.status !== "LOADED") return;
    const migrated = loaded.save.data.postseason!;
    expect(migrated.revision).toBe(sourcePostseason.revision);
    expect(migrated.eventIds).toEqual(sourcePostseason.eventIds);
    expect(migrated.playoffs.status).toBe("IN_PROGRESS");
    expect(migrated.playoffs.revision).toBe(0);
    expect(migrated.playoffs.eventIds).toEqual([]);
    expect(migrated.playoffs.series).toHaveLength(8);
  });

  it("accepts a transitional root-v2 envelope that already contains the current nested slice", () => {
    const current = playoffProgressedSave();
    const raw = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    raw.schemaVersion = CAREER_SAVE_POSTSEASON_V1_SCHEMA_VERSION;
    const loaded = loadCareerSave(JSON.stringify(raw));
    expect(loaded.status).toBe("LOADED");
    if (loaded.status !== "LOADED") return;
    expect(loaded.save.schemaVersion).toBe(CAREER_SAVE_SCHEMA_VERSION);
    expect(loaded.save.revision).toBe(current.revision);
    expect(loaded.save.data.postseason).toEqual(current.data.postseason);
  });

  it("round-trips at every play-in stage", () => {
    const season = seasonAtEnd();
    const frozen = freezeRegularSeason(season);
    if (frozen.status !== "FROZEN") throw new Error("freeze failed");
    let postseason = frozen.state;
    const stages: string[] = [];
    const stageSaves: Array<{ stage: string; save: ReturnType<typeof frozenSave> }> = [];
    stageSaves.push({ stage: "FROZEN", save: frozenSave() });
    for (const conference of ["EAST", "WEST"] as const) {
      for (const slot of ["A", "B"] as const) {
        const applied = recordPlayInResult(postseason, conference, slot, { homeScore: 108, awayScore: 99 });
        if (applied.status !== "APPLIED") throw new Error("apply failed");
        postseason = applied.state;
        stages.push(`${conference}-${slot}`);
        const save = updateCareerSave(createCareerSave("career-slot-postseason", data({ season })), {
          season,
          postseason,
          lifecycle: createCareerLifecycleState(season.playerTeamId, season.seasonNumber, { legacyPostseason: postseason }),
        });
        stageSaves.push({ stage: stages.at(-1)!, save });
      }
    }
    const cEast = recordPlayInResult(postseason, "EAST", "C", { homeScore: 111, awayScore: 104 });
    if (cEast.status !== "APPLIED") throw new Error("C failed");
    const final = updateCareerSave(createCareerSave("career-slot-postseason", data({ season })), {
      season,
      postseason: cEast.state,
      lifecycle: createCareerLifecycleState(season.playerTeamId, season.seasonNumber, { legacyPostseason: cEast.state }),
    });
    stageSaves.push({ stage: "EAST-C", save: final });
    expect(stageSaves).toHaveLength(6);
    for (const { stage, save } of stageSaves) {
      const loaded = loadCareerSave(serializeCareerSave(save));
      expect(loaded.status, stage).toBe("LOADED");
      if (loaded.status === "LOADED") expect(loaded.save).toEqual(save);
    }
  });

  it("round-trips a v4 save after a best-of-seven game", () => {
    const save = playoffProgressedSave();
    const loaded = loadCareerSave(serializeCareerSave(save));
    expect(loaded).toEqual({ status: "LOADED", save });
    expect(save.data.postseason?.playoffs.revision).toBe(1);
    expect(save.data.postseason?.revision).toBe(7);
    expect(save.data.postseason?.playoffs.eventIds).toHaveLength(1);
  });

  it("round-trips every generated playoff round, both conference champions, the Finals, and the unique champion", () => {
    const season = seasonAtEnd();
    const frozen = freezeRegularSeason(season);
    if (frozen.status !== "FROZEN") throw new Error("fixture freeze failed");
    let postseason = completePlayIns(frozen.state);
    const stages: Array<{ label: string; postseason: PostseasonState }> = [
      { label: "FIRST_ROUND_READY", postseason },
    ];
    postseason = finishRound(postseason, "FIRST_ROUND");
    stages.push({ label: "CONFERENCE_SEMIFINALS_READY", postseason });
    postseason = finishRound(postseason, "CONFERENCE_SEMIFINALS");
    stages.push({ label: "CONFERENCE_FINALS_READY", postseason });
    postseason = finishRound(postseason, "CONFERENCE_FINALS");
    stages.push({ label: "FINALS_READY_WITH_TWO_CONFERENCE_CHAMPIONS", postseason });
    const finalsId = postseason.playoffs.series.find((series) => series.round === "FINALS")?.seriesId;
    if (!finalsId) throw new Error("Finals fixture missing");
    const finalsGame = postseason.playoffs.series
      .find((series) => series.seriesId === finalsId)!
      .games.find((game) => game.status === "SCHEDULED")!;
    const finalsSeries = postseason.playoffs.series.find((series) => series.seriesId === finalsId)!;
    const firstFinalsResult = recordPostseasonPlayoffResult(
      postseason,
      finalsId,
      finalsGame.gameNumber,
      finalsGame.homeTeamId === finalsSeries.teamAId
        ? { homeScore: 108, awayScore: 99 }
        : { homeScore: 99, awayScore: 108 },
    );
    if (firstFinalsResult.status !== "APPLIED") throw new Error("Finals game fixture failed");
    postseason = firstFinalsResult.state;
    stages.push({ label: "FINALS_IN_PROGRESS", postseason });
    postseason = finishSeries(postseason, finalsId);
    stages.push({ label: "CHAMPION", postseason });

    for (const [index, stage] of stages.entries()) {
      const save = updateCareerSave(
        createCareerSave(`career-slot-round-trip-${index}`, data({ season })),
        {
          season,
          postseason: stage.postseason,
          lifecycle: createCareerLifecycleState(season.playerTeamId, season.seasonNumber, { legacyPostseason: stage.postseason }),
        },
      );
      const loaded = loadCareerSave(serializeCareerSave(save));
      expect(loaded.status, stage.label).toBe("LOADED");
      if (loaded.status === "LOADED") expect(loaded.save, stage.label).toEqual(save);
    }
    expect(postseason.playoffs.status).toBe("COMPLETE");
    expect(postseason.playoffs.championTeamId).not.toBeNull();
    expect(postseason.playoffs.conferenceChampionTeamIds.EAST).not.toBeNull();
    expect(postseason.playoffs.conferenceChampionTeamIds.WEST).not.toBeNull();
  }, 30_000);

  it("rejects every malformed postseason cross-reference", () => {
    const base = JSON.parse(JSON.stringify(progressedSave())) as Record<string, unknown>;
    const cloneWith = (mutate: (raw: Record<string, unknown>) => void) => {
      const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      mutate(raw);
      return raw;
    };
    const tampered: Array<Record<string, unknown>> = [];
    // Flip a recorded final score (A result) so replay drifts.
    tampered.push(cloneWith((raw) => {
      const east = (raw.data as Record<string, unknown>).postseason as Record<string, unknown>;
      const a = ((east.playIn as Record<string, unknown>).EAST as Record<string, unknown>).gameA as Record<string, unknown>;
      const score = a.score as Record<string, unknown>;
      score.homeScore = (score.homeScore as number) + 1;
    }));
    // Swap the top two EAST snapshot teams.
    tampered.push(cloneWith((raw) => {
      const east = ((raw.data as Record<string, unknown>).postseason as Record<string, unknown>).east as Record<string, unknown>;
      const teams = east.teams as Array<Record<string, unknown>>;
      const first = { ...teams[0], rank: 2 };
      teams[0] = { ...teams[1], rank: 1 };
      teams[1] = first;
    }));
    // Drop the freeze event from the ledger.
    tampered.push(cloneWith((raw) => {
      const postseason = (raw.data as Record<string, unknown>).postseason as Record<string, unknown>;
      postseason.eventIds = ((postseason.eventIds as string[]).filter((id) => !id.startsWith("postseason-freeze")));
    }));
    // Corrupt C home team after A and B are recorded.
    tampered.push(cloneWith((raw) => {
      const postseason = (raw.data as Record<string, unknown>).postseason as Record<string, unknown>;
      const bracket = (postseason.playIn as Record<string, unknown>).EAST as Record<string, unknown>;
      const gameC = bracket.gameC as Record<string, unknown> | null;
      const gameA = bracket.gameA as Record<string, unknown>;
      if (gameC) gameC.homeTeamId = gameA.winnerTeamId;
    }));
    // Corrupt nested conference/rules metadata.
    tampered.push(cloneWith((raw) => {
      const postseason = (raw.data as Record<string, unknown>).postseason as Record<string, unknown>;
      const east = postseason.east as Record<string, unknown>;
      east.conference = "WEST";
    }));
    tampered.push(cloneWith((raw) => {
      const postseason = (raw.data as Record<string, unknown>).postseason as Record<string, unknown>;
      const east = postseason.east as Record<string, unknown>;
      east.rankingRulesVersion = "tampered";
    }));
    tampered.push(cloneWith((raw) => {
      const postseason = (raw.data as Record<string, unknown>).postseason as Record<string, unknown>;
      const east = postseason.east as Record<string, unknown>;
      const teams = east.teams as Array<Record<string, unknown>>;
      teams[0].division = "PACIFIC";
    }));
    tampered.push(cloneWith((raw) => {
      const postseason = (raw.data as Record<string, unknown>).postseason as Record<string, unknown>;
      postseason.revision = 999;
    }));
    for (const [index, raw] of tampered.entries()) {
      const loaded = loadCareerSave(JSON.stringify(raw));
      expect(loaded.status, `tampered case ${index + 1}`).toBe("RECOVERY_REQUIRED");
    }
  });

  it("rejects tampered series games, series ledgers, revisions, and champion state", () => {
    const base = JSON.parse(JSON.stringify(playoffProgressedSave())) as Record<string, unknown>;
    const cloneWith = (mutate: (postseason: Record<string, unknown>, playoffs: Record<string, unknown>) => void) => {
      const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      const postseason = (raw.data as Record<string, unknown>).postseason as Record<string, unknown>;
      const playoffs = postseason.playoffs as Record<string, unknown>;
      mutate(postseason, playoffs);
      return raw;
    };
    const tampered = [
      cloneWith((_postseason, playoffs) => {
        const series = playoffs.series as Array<Record<string, unknown>>;
        const games = series[0].games as Array<Record<string, unknown>>;
        const score = games[0].score as Record<string, unknown>;
        score.homeScore = 1;
        score.awayScore = 299;
      }),
      cloneWith((postseason, playoffs) => {
        const events = playoffs.eventIds as string[];
        playoffs.eventIds = events.slice(1);
        postseason.eventIds = (postseason.eventIds as string[]).filter((eventId) => eventId !== events[0]);
      }),
      cloneWith((_postseason, playoffs) => { playoffs.revision = 99; }),
      cloneWith((_postseason, playoffs) => {
        playoffs.status = "COMPLETE";
        playoffs.championTeamId = "LAKERS";
      }),
      cloneWith((_postseason, playoffs) => {
        const series = playoffs.series as Array<Record<string, unknown>>;
        series[0].teamAId = series[1].teamAId;
      }),
      cloneWith((_postseason, playoffs) => {
        const series = playoffs.series as Array<Record<string, unknown>>;
        const games = series[0].games as Array<Record<string, unknown>>;
        const scheduled = games.find((game) => game.status === "SCHEDULED")!;
        [scheduled.homeTeamId, scheduled.awayTeamId] = [scheduled.awayTeamId, scheduled.homeTeamId];
      }),
      cloneWith((_postseason, playoffs) => {
        const series = playoffs.series as Array<Record<string, unknown>>;
        const games = series[0].games as Array<Record<string, unknown>>;
        games[0].gameNumber = 7;
      }),
      cloneWith((_postseason, playoffs) => {
        const series = playoffs.series as Array<Record<string, unknown>>;
        series[0].teamAWins = 3;
      }),
      cloneWith((_postseason, playoffs) => {
        const series = playoffs.series as Array<Record<string, unknown>>;
        const games = series[0].games as Array<Record<string, unknown>>;
        games[0].winnerTeamId = games[0].loserTeamId;
      }),
      cloneWith((_postseason, playoffs) => {
        const series = playoffs.series as Array<Record<string, unknown>>;
        const games = series[0].games as Array<Record<string, unknown>>;
        games[0].eventId = `${games[0].eventId as string}:tampered`;
      }),
    ];
    for (const [index, raw] of tampered.entries()) {
      expect(loadCareerSave(JSON.stringify(raw)).status, `playoff tamper ${index + 1}`).toBe("RECOVERY_REQUIRED");
    }
  });

  it("rejects a forged champion or championship event in an otherwise complete bracket", () => {
    const season = seasonAtEnd();
    const frozen = freezeRegularSeason(season);
    if (frozen.status !== "FROZEN") throw new Error("fixture freeze failed");
    let postseason = completePlayIns(frozen.state);
    postseason = finishRound(postseason, "FIRST_ROUND");
    postseason = finishRound(postseason, "CONFERENCE_SEMIFINALS");
    postseason = finishRound(postseason, "CONFERENCE_FINALS");
    postseason = finishRound(postseason, "FINALS");
    const complete = updateCareerSave(createCareerSave("career-slot-complete-tamper", data({ season })), {
      season,
      postseason,
      lifecycle: createCareerLifecycleState(season.playerTeamId, season.seasonNumber, { legacyPostseason: postseason }),
    });
    const raw = JSON.parse(JSON.stringify(complete)) as Record<string, unknown>;
    const storedPostseason = (raw.data as Record<string, unknown>).postseason as Record<string, unknown>;
    const playoffs = storedPostseason.playoffs as Record<string, unknown>;
    const realChampion = playoffs.championTeamId as string;
    playoffs.championTeamId = leagueTeams.find((team) => team.id !== realChampion)!.id;
    playoffs.championshipEventId = `${playoffs.freezeEventId as string}:championship:${playoffs.championTeamId as string}`;
    expect(loadCareerSave(JSON.stringify(raw)).status).toBe("RECOVERY_REQUIRED");
  });

  it("rejects an invalid nested legacy slice instead of fabricating a migrated bracket", () => {
    const current = progressedSave();
    const raw = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    raw.schemaVersion = CAREER_SAVE_POSTSEASON_V1_SCHEMA_VERSION;
    const rawData = raw.data as Record<string, unknown>;
    const legacy = legacyPostseasonV1(current.data.postseason!);
    const east = (legacy.east as Record<string, unknown>).teams as Array<Record<string, unknown>>;
    [east[0], east[1]] = [east[1], east[0]];
    rawData.postseason = legacy;
    expect(loadCareerSave(JSON.stringify(raw))).toMatchObject({
      status: "RECOVERY_REQUIRED",
      reason: "CORRUPT_SAVE",
      save: null,
    });
  });

  it("keeps future schema versions rejected and never overwrites them", () => {
    const raw = JSON.parse(JSON.stringify(frozenSave())) as Record<string, unknown>;
    raw.schemaVersion = 99;
    const loaded = loadCareerSave(JSON.stringify(raw));
    expect(loaded.status).toBe("FUTURE_VERSION_REJECTED");
    if (loaded.status === "FUTURE_VERSION_REJECTED") expect(loaded.foundVersion).toBe(99);
  });
});
