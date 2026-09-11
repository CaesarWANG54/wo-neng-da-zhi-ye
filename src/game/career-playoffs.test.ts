import { describe, expect, it } from "vitest";
import { leagueTeams, type Conference } from "./player-creation";
import {
  PLAYOFF_HOME_PATTERN,
  assertPlayoffBracketState,
  createWaitingPlayoffBracket,
  derivePlayoffSimulationSeed,
  initializePlayoffFirstRound,
  isPlayoffBracketState,
  nextPlayoffGame,
  playoffComplete,
  recordPlayoffGameResult,
  scheduledPlayoffGames,
  simulateNextPlayoffGame,
  type PlayoffBracketState,
  type PlayoffSeedField,
  type PlayoffSeedTeam,
  type PlayoffSeries,
  type PlayoffSeriesSlot,
} from "./career-playoffs";

const conferenceIds = (conference: Conference) => leagueTeams
  .filter((team) => team.conference === conference)
  .slice(0, 8)
  .map((team) => team.id);

function seedTeam(teamId: string, conference: Conference, seed: number, wins: number): PlayoffSeedTeam {
  return {
    teamId,
    conference,
    seed,
    wins,
    losses: 82 - wins,
    oppositeConferenceWins: 16,
    oppositeConferenceLosses: 14,
    headToHead: {},
  };
}

function seedField(): PlayoffSeedField {
  return {
    EAST: conferenceIds("EAST").map((id, index) => seedTeam(id, "EAST", index + 1, 64 - index)),
    WEST: conferenceIds("WEST").map((id, index) => seedTeam(id, "WEST", index + 1, 63 - index)),
  };
}

function initialized(seeds = seedField()) {
  const result = initializePlayoffFirstRound(createWaitingPlayoffBracket("freeze-fixture", 20_260_903), seeds);
  if (result.status !== "APPLIED") throw new Error(`Initialization failed: ${result.status}`);
  return result.state;
}

function seriesAt(state: PlayoffBracketState, conference: Conference | null, slot: PlayoffSeriesSlot) {
  const series = state.series.find((candidate) => candidate.conference === conference && candidate.slot === slot);
  if (!series) throw new Error(`Missing ${conference ?? "LEAGUE"} ${slot}`);
  return series;
}

function applyWinner(state: PlayoffBracketState, seriesId: string, winnerTeamId: string) {
  const game = nextPlayoffGame(state, seriesId);
  if (!game) throw new Error("Series has no scheduled frontier");
  const score = game.homeTeamId === winnerTeamId
    ? { homeScore: 112, awayScore: 101 }
    : { homeScore: 101, awayScore: 112 };
  const result = recordPlayoffGameResult(state, seriesId, game.gameNumber, score, { expectedRevision: state.revision });
  if (result.status !== "APPLIED") throw new Error(`Game application failed: ${result.status}`);
  return result.state;
}

function finishSeries(state: PlayoffBracketState, seriesId: string, winnerTeamId: string, loserWins = 0) {
  let next = state;
  const initial = next.series.find((series) => series.seriesId === seriesId)!;
  const loserTeamId = initial.teamAId === winnerTeamId ? initial.teamBId : initial.teamAId;
  for (let index = 0; index < loserWins; index += 1) next = applyWinner(next, seriesId, loserTeamId);
  for (let index = 0; index < 4; index += 1) next = applyWinner(next, seriesId, winnerTeamId);
  return next;
}

function advanceConference(state: PlayoffBracketState, conference: Conference) {
  let next = state;
  for (const slot of ["F1", "F2", "F3", "F4"] as const) {
    const series = seriesAt(next, conference, slot);
    next = finishSeries(next, series.seriesId, series.teamAId);
  }
  for (const slot of ["S1", "S2"] as const) {
    const series = seriesAt(next, conference, slot);
    next = finishSeries(next, series.seriesId, series.teamAId);
  }
  const final = seriesAt(next, conference, "C1");
  return finishSeries(next, final.seriesId, final.teamAId);
}

function allLegalSeriesPaths() {
  const paths: Array<Array<"A" | "B">> = [];
  const visit = (path: Array<"A" | "B">, aWins: number, bWins: number) => {
    if (aWins === 4 || bWins === 4) {
      paths.push(path);
      return;
    }
    visit([...path, "A"], aWins + 1, bWins);
    visit([...path, "B"], aWins, bWins + 1);
  };
  visit([], 0, 0);
  return paths;
}

describe("M6B-2 fixed best-of-seven domain", () => {
  it("creates an exact waiting state and initializes the eight fixed first-round series once", () => {
    const waiting = createWaitingPlayoffBracket("freeze-fixture", 20_260_903);
    expect(waiting.status).toBe("WAITING_FOR_PLAY_IN");
    expect(waiting.series).toEqual([]);
    expect(waiting.revision).toBe(0);
    expect(isPlayoffBracketState(waiting)).toBe(true);

    const result = initializePlayoffFirstRound(waiting, seedField());
    expect(result.status).toBe("APPLIED");
    if (result.status !== "APPLIED") return;
    expect(result.state.series).toHaveLength(8);
    expect(result.state.series.map((series) => `${series.conference}-${series.slot}-${series.teamASeed}v${series.teamBSeed}`)).toEqual([
      "EAST-F1-1v8", "EAST-F2-4v5", "EAST-F3-3v6", "EAST-F4-2v7",
      "WEST-F1-1v8", "WEST-F2-4v5", "WEST-F3-3v6", "WEST-F4-2v7",
    ]);
    expect(scheduledPlayoffGames(result.state)).toHaveLength(8);
    expect(initializePlayoffFirstRound(result.state, seedField()).status).toBe("NOOP");
    assertPlayoffBracketState(result.state);
  });

  it("uses H-H-A-A-H-A-H and exposes exactly one frontier per active series", () => {
    let state = initialized();
    const initial = seriesAt(state, "EAST", "F1");
    const winner = initial.teamAId;
    const loser = initial.teamBId;
    for (const winningTeam of [winner, loser, winner, loser, winner, loser, winner]) {
      state = applyWinner(state, initial.seriesId, winningTeam);
    }
    const complete = state.series.find((series) => series.seriesId === initial.seriesId)!;
    const venuePattern = complete.games.map((game) => game.homeTeamId === complete.homeCourtTeamId ? "HCA" : "OTHER");
    expect(venuePattern).toEqual(PLAYOFF_HOME_PATTERN);
    expect(complete.teamAWins).toBe(4);
    expect(complete.teamBWins).toBe(3);
    expect(complete.status).toBe("FINAL");
    expect(nextPlayoffGame(state, complete.seriesId)).toBeNull();
  });

  it("supports 4-0 through 4-3 and never creates a game after the clincher", () => {
    for (let loserWins = 0; loserWins <= 3; loserWins += 1) {
      let state = initialized();
      const series = seriesAt(state, "EAST", "F1");
      state = finishSeries(state, series.seriesId, series.teamAId, loserWins);
      const final = state.series.find((candidate) => candidate.seriesId === series.seriesId)!;
      expect(final.games).toHaveLength(4 + loserWins);
      expect(final.teamAWins).toBe(4);
      expect(final.teamBWins).toBe(loserWins);
      expect(final.revision).toBe(4 + loserWins);
    }
  });

  it("accepts all 70 legal best-of-seven result paths and only those paths", () => {
    const paths = allLegalSeriesPaths();
    expect(paths).toHaveLength(70);
    for (const path of paths) {
      let state = initialized();
      const initial = seriesAt(state, "EAST", "F1");
      for (const winner of path) {
        state = applyWinner(state, initial.seriesId, winner === "A" ? initial.teamAId : initial.teamBId);
      }
      const final = state.series.find((series) => series.seriesId === initial.seriesId)!;
      expect(final.status).toBe("FINAL");
      expect(Math.max(final.teamAWins, final.teamBWins)).toBe(4);
      expect(Math.min(final.teamAWins, final.teamBWins)).toBe(path.length - 4);
      expect(final.games).toHaveLength(path.length);
      expect(nextPlayoffGame(state, initial.seriesId)).toBeNull();
    }
  });

  it("enforces APPLIED, NOOP, CONFLICT, STALE, tie and out-of-order semantics", () => {
    const state = initialized();
    const series = seriesAt(state, "EAST", "F1");
    const game = nextPlayoffGame(state, series.seriesId)!;
    const score = { homeScore: 110, awayScore: 101 };
    const applied = recordPlayoffGameResult(state, series.seriesId, 1, score, { expectedRevision: 0 });
    expect(applied.status).toBe("APPLIED");
    if (applied.status !== "APPLIED") return;
    expect(recordPlayoffGameResult(applied.state, series.seriesId, 1, score, { expectedRevision: 0 }).status).toBe("NOOP");
    const conflict = recordPlayoffGameResult(applied.state, series.seriesId, 1, { homeScore: 111, awayScore: 101 });
    expect(conflict).toMatchObject({ status: "REJECTED", code: "CONFLICT" });
    const stale = recordPlayoffGameResult(applied.state, series.seriesId, 2, { homeScore: 111, awayScore: 101 }, { expectedRevision: 0 });
    expect(stale).toMatchObject({ status: "REJECTED", code: "STALE" });
    expect(recordPlayoffGameResult(state, series.seriesId, game.gameNumber, { homeScore: 100, awayScore: 100 })).toMatchObject({ status: "REJECTED", code: "TIED" });
    expect(recordPlayoffGameResult(state, series.seriesId, 2, score)).toMatchObject({ status: "REJECTED", code: "OUT_OF_ORDER" });
    expect(applied.state.revision).toBe(1);
  });

  it("materializes fixed feeder series once without reseeding", () => {
    let state = initialized();
    const f1 = seriesAt(state, "EAST", "F1");
    const f2 = seriesAt(state, "EAST", "F2");
    state = finishSeries(state, f1.seriesId, f1.teamBId);
    expect(state.series.some((series) => series.conference === "EAST" && series.slot === "S1")).toBe(false);
    state = finishSeries(state, f2.seriesId, f2.teamBId);
    const semi = seriesAt(state, "EAST", "S1");
    expect([semi.teamASeed, semi.teamBSeed]).toEqual([8, 5]);
    expect(semi.participantSources).toEqual([
      { kind: "WINNER", seriesId: f1.seriesId },
      { kind: "WINNER", seriesId: f2.seriesId },
    ]);
    expect(state.series.filter((series) => series.conference === "EAST" && series.slot === "S1")).toHaveLength(1);
  });

  it("allows conference interleaving without changing IDs or final state", () => {
    const base = initialized();
    const east = seriesAt(base, "EAST", "F1");
    const west = seriesAt(base, "WEST", "F1");
    const eastScore = nextPlayoffGame(base, east.seriesId)!;
    const westScore = nextPlayoffGame(base, west.seriesId)!;

    const firstEast = recordPlayoffGameResult(base, east.seriesId, 1, { homeScore: 110, awayScore: 100 });
    if (firstEast.status !== "APPLIED") throw new Error("east apply failed");
    const eastThenWest = recordPlayoffGameResult(firstEast.state, west.seriesId, 1, { homeScore: 108, awayScore: 99 });
    const firstWest = recordPlayoffGameResult(base, west.seriesId, 1, { homeScore: 108, awayScore: 99 });
    if (firstWest.status !== "APPLIED") throw new Error("west apply failed");
    const westThenEast = recordPlayoffGameResult(firstWest.state, east.seriesId, 1, { homeScore: 110, awayScore: 100 });
    expect(eastScore.gameId).toContain(":G1:");
    expect(westScore.gameId).toContain(":G1:");
    expect(eastThenWest.status).toBe("APPLIED");
    expect(westThenEast.status).toBe("APPLIED");
    if (eastThenWest.status === "APPLIED" && westThenEast.status === "APPLIED") {
      expect(eastThenWest.state).toEqual(westThenEast.state);
    }
  });

  it("creates the Finals only after both conference champions and closes one champion", () => {
    let state = initialized();
    state = advanceConference(state, "EAST");
    expect(state.conferenceChampionTeamIds.EAST).not.toBeNull();
    expect(state.series.some((series) => series.slot === "FINALS")).toBe(false);
    state = advanceConference(state, "WEST");
    const finals = seriesAt(state, null, "FINALS");
    expect(finals.homeCourtTeamId).toBe(finals.teamAId); // East fixture has the better record.
    state = finishSeries(state, finals.seriesId, finals.teamBId, 2);
    expect(playoffComplete(state)).toBe(true);
    expect(state.championTeamId).toBe(finals.teamBId);
    expect(state.championshipEventId).toBe(`freeze-fixture:championship:${finals.teamBId}`);
    expect(state.seasonCompletionEventId).toBe("freeze-fixture:season-complete");
    expect(new Set(state.eventIds).size).toBe(state.eventIds.length);
    expect(recordPlayoffGameResult(state, finals.seriesId, 6, { homeScore: 112, awayScore: 101 }).status).toBe("NOOP");
    assertPlayoffBracketState(state);
  });

  it("uses the frozen Finals home-court hierarchy and a reproducible final draw", () => {
    const cases: Array<{
      configure: (seeds: PlayoffSeedField) => void;
      reason: PlayoffSeries["homeCourtReason"];
      expectedConference?: Conference;
    }> = [
      {
        configure: (seeds) => {
          seeds.WEST[0].wins = seeds.EAST[0].wins;
          seeds.WEST[0].losses = seeds.EAST[0].losses;
          seeds.EAST[0].headToHead[seeds.WEST[0].teamId] = { wins: 2, losses: 0 };
          seeds.WEST[0].headToHead[seeds.EAST[0].teamId] = { wins: 0, losses: 2 };
        },
        reason: "HEAD_TO_HEAD",
        expectedConference: "EAST",
      },
      {
        configure: (seeds) => {
          seeds.WEST[0].wins = seeds.EAST[0].wins;
          seeds.WEST[0].losses = seeds.EAST[0].losses;
          seeds.EAST[0].headToHead[seeds.WEST[0].teamId] = { wins: 1, losses: 1 };
          seeds.WEST[0].headToHead[seeds.EAST[0].teamId] = { wins: 1, losses: 1 };
          seeds.EAST[0].oppositeConferenceWins = 18;
          seeds.EAST[0].oppositeConferenceLosses = 12;
        },
        reason: "OPPOSITE_CONFERENCE",
        expectedConference: "EAST",
      },
      {
        configure: (seeds) => {
          seeds.WEST[0].wins = seeds.EAST[0].wins;
          seeds.WEST[0].losses = seeds.EAST[0].losses;
          seeds.EAST[0].headToHead[seeds.WEST[0].teamId] = { wins: 1, losses: 1 };
          seeds.WEST[0].headToHead[seeds.EAST[0].teamId] = { wins: 1, losses: 1 };
        },
        reason: "DETERMINISTIC_DRAW",
      },
    ];
    for (const item of cases) {
      const seeds = seedField();
      item.configure(seeds);
      let first = initialized(seeds);
      first = advanceConference(first, "EAST");
      first = advanceConference(first, "WEST");
      const firstFinals = seriesAt(first, null, "FINALS");
      expect(firstFinals.homeCourtReason).toBe(item.reason);
      if (item.expectedConference) {
        expect(findSeedConference(seeds, firstFinals.homeCourtTeamId)).toBe(item.expectedConference);
      }
      let replay = initialized(seeds);
      replay = advanceConference(replay, "WEST");
      replay = advanceConference(replay, "EAST");
      expect(seriesAt(replay, null, "FINALS").homeCourtTeamId).toBe(firstFinals.homeCourtTeamId);
    }
  });

  it("derives stable per-game simulation seeds and rejects tampered replay chains", () => {
    const state = initialized();
    const series = seriesAt(state, "EAST", "F1");
    const game = nextPlayoffGame(state, series.seriesId)!;
    const firstSeed = derivePlayoffSimulationSeed(state, series.seriesId, game.gameNumber);
    const replaySeed = derivePlayoffSimulationSeed(state, series.seriesId, game.gameNumber);
    expect(firstSeed).toBe(replaySeed);
    const first = simulateNextPlayoffGame(state, series.seriesId);
    const replay = simulateNextPlayoffGame(state, series.seriesId);
    expect(first).toEqual(replay);
    if (first.status !== "APPLIED") throw new Error("simulation failed");
    const next = nextPlayoffGame(first.state, series.seriesId)!;
    expect(derivePlayoffSimulationSeed(first.state, series.seriesId, next.gameNumber)).not.toBe(firstSeed);

    const tampered = structuredClone(first.state);
    const changed: PlayoffSeries = { ...tampered.series[0], teamAWins: 3 };
    tampered.series[0] = changed;
    expect(isPlayoffBracketState(tampered)).toBe(false);

    // Preserve the original winner while changing only the persisted score.
    // The score-bound event ID and ledger must make this detectable.
    const scoreTampered = structuredClone(first.state);
    const finalGame = scoreTampered.series[0].games[0];
    if (!finalGame.score) throw new Error("fixture game is not final");
    finalGame.score.homeScore += finalGame.score.homeScore > finalGame.score.awayScore ? 1 : 0;
    finalGame.score.awayScore += finalGame.score.awayScore > finalGame.score.homeScore ? 1 : 0;
    expect(finalGame.winnerTeamId).toBe(first.state.series[0].games[0].winnerTeamId);
    expect(isPlayoffBracketState(scoreTampered)).toBe(false);
  });

  it("rejects malformed seed fields and multiple independent bracket corruptions", () => {
    const waiting = createWaitingPlayoffBracket("freeze-fixture", 20_260_903);
    const missing = seedField();
    missing.WEST.pop();
    expect(initializePlayoffFirstRound(waiting, missing)).toMatchObject({ status: "REJECTED", code: "INVALID_SEEDS" });
    const wrongOrder = seedField();
    wrongOrder.EAST[1].wins = 70;
    wrongOrder.EAST[1].losses = 12;
    expect(initializePlayoffFirstRound(waiting, wrongOrder)).toMatchObject({ status: "REJECTED", code: "INVALID_SEEDS" });

    // Seeds 7 and 8 are final play-in slots, not a re-sort by record. A #8
    // team may therefore own the better regular-season record without making
    // the field invalid; both must still have no better record than seed 6.
    const invertedPlayInSeeds = seedField();
    invertedPlayInSeeds.EAST[6].wins = 39;
    invertedPlayInSeeds.EAST[6].losses = 43;
    invertedPlayInSeeds.EAST[7].wins = 40;
    invertedPlayInSeeds.EAST[7].losses = 42;
    expect(initializePlayoffFirstRound(waiting, invertedPlayInSeeds).status).toBe("APPLIED");
    const illegalPlayInSeed = seedField();
    illegalPlayInSeed.EAST[6].wins = illegalPlayInSeed.EAST[5].wins + 1;
    illegalPlayInSeed.EAST[6].losses = 82 - illegalPlayInSeed.EAST[6].wins;
    expect(initializePlayoffFirstRound(waiting, illegalPlayInSeed)).toMatchObject({
      status: "REJECTED",
      code: "INVALID_SEEDS",
      reason: expect.stringContaining("final direct seed 6"),
    });

    const applied = simulateNextPlayoffGame(initialized(), seriesAt(initialized(), "EAST", "F1").seriesId);
    if (applied.status !== "APPLIED") throw new Error("fixture simulation failed");
    const wrongVenue = structuredClone(applied.state);
    [wrongVenue.series[0].games[1].homeTeamId, wrongVenue.series[0].games[1].awayTeamId] = [
      wrongVenue.series[0].games[1].awayTeamId,
      wrongVenue.series[0].games[1].homeTeamId,
    ];
    const duplicateEvent = structuredClone(applied.state);
    duplicateEvent.eventIds.push(duplicateEvent.eventIds[0]);
    const fakeWinner = structuredClone(applied.state);
    fakeWinner.series[0].winnerTeamId = fakeWinner.series[0].teamAId;
    expect(isPlayoffBracketState(wrongVenue)).toBe(false);
    expect(isPlayoffBracketState(duplicateEvent)).toBe(false);
    expect(isPlayoffBracketState(fakeWinner)).toBe(false);
  });
});

function findSeedConference(seeds: PlayoffSeedField, teamId: string): Conference | undefined {
  return (["EAST", "WEST"] as const).find((conference) => seeds[conference].some((team) => team.teamId === teamId));
}
