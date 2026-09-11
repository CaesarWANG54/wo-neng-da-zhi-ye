import { describe, expect, it } from "vitest";
import { advanceCareerCalendar } from "./career-calendar-progression";
import {
  careerMatchTiming,
  nextPlayableCareerGame,
  prepareCareerGame,
  settlePlayedCareerGame,
  type CareerPlayerGameLine,
} from "./career-game-settlement";
import { createCareerProgression, effectiveRatings } from "./career-progression";
import { createCareerSeason, simulateCareerToDate, type CareerSeasonState } from "./career-season";
import { createPlayerProfile } from "./player-creation";

const profile = createPlayerProfile({
  displayName: "林远",
  position: "PG",
  templateId: "PG_FLOOR_GENERAL",
  jerseyNumber: 1,
});

const playerLine: CareerPlayerGameLine = {
  points: 20,
  rebounds: 5,
  assists: 7,
  steals: 2,
  blocks: 1,
  turnovers: 3,
  made: 7,
  attempts: 15,
  threesMade: 2,
  threesAttempted: 5,
  freeThrowsMade: 4,
  freeThrowsAttempted: 5,
};

function start(teamId = "HAWKS", seasonNumber = 1) {
  return {
    season: createCareerSeason(teamId, profile.displayName, 101, seasonNumber),
    progression: createCareerProgression(profile.ratings, { season: seasonNumber, age: 19 + seasonNumber }),
  };
}

function prepared(teamId = "HAWKS", difficulty: "ROOKIE" | "STARTER" = "ROOKIE", gameMinutes: 8 | 12 | 24 = 8) {
  const initial = start(teamId);
  const game = nextPlayableCareerGame(initial.season)!;
  return {
    initial,
    result: prepareCareerGame(initial.season, initial.progression, game.id, { difficulty, gameMinutes }),
  };
}

function settle(preparation: ReturnType<typeof prepared>["result"], controlledTeamScore = 108, opponentScore = 101) {
  return settlePlayedCareerGame(preparation.season, preparation.progression, preparation.launch, {
    completed: true,
    controlledTeamScore,
    opponentScore,
    playerLine,
  });
}

function advanceUntilVenue(teamId: string, venue: "HOME" | "AWAY") {
  let { season, progression } = start(teamId);
  for (let index = 0; index < 20; index += 1) {
    const game = nextPlayableCareerGame(season)!;
    const actualVenue = game.homeTeamId === teamId ? "HOME" : "AWAY";
    if (actualVenue === venue) return prepareCareerGame(season, progression, game.id, { difficulty: "STARTER", gameMinutes: 12 });
    ({ season, progression } = advanceCareerCalendar(season, progression, game.date));
  }
  throw new Error(`No ${venue} game found`);
}

describe("played career game transaction", () => {
  it("maps total game length to four regulation periods and scaled overtime", () => {
    expect(careerMatchTiming(8)).toEqual({ regulationPeriodSeconds: 120, overtimePeriodSeconds: 50 });
    expect(careerMatchTiming(12)).toEqual({ regulationPeriodSeconds: 180, overtimePeriodSeconds: 75 });
    expect(careerMatchTiming(24)).toEqual({ regulationPeriodSeconds: 360, overtimePeriodSeconds: 150 });
  });

  it("prepares the real next game without simulating it while advancing the rest of the league", () => {
    const { initial, result } = prepared();
    expect(result.launch.gameId).toBe("published-85");
    expect(result.launch.date).toBe("2026-10-21");
    expect(result.season.currentDate).toBe(result.launch.date);
    expect(result.season.games.find((game) => game.id === result.launch.gameId)?.status).toBe("SCHEDULED");
    expect(result.season.games.filter((game) => game.date <= result.launch.date && game.id !== result.launch.gameId).every((game) => game.status === "FINAL")).toBe(true);
    expect(result.launch.effectiveRatings).toEqual(effectiveRatings(result.progression.ratings, result.progression.chemistryPercent));
    expect(initial.season.currentDate).toBe("2026-10-19");
    expect(initial.season.games.find((game) => game.id === result.launch.gameId)?.status).toBe("SCHEDULED");
  });

  it("blocks later published games until both dynamic Cup games become playable", () => {
    const initial = start();
    const throughGroupPlay = advanceCareerCalendar(initial.season, initial.progression, "2026-12-03");
    expect(throughGroupPlay.season.cupResolved).toBe(false);
    expect(nextPlayableCareerGame(throughGroupPlay.season)).toBeUndefined();

    const bracketReady = advanceCareerCalendar(throughGroupPlay.season, throughGroupPlay.progression, "2026-12-04");
    const cupGame = nextPlayableCareerGame(bracketReady.season);
    expect(bracketReady.season.cupResolved).toBe(true);
    expect(cupGame).toMatchObject({ date: "2026-12-05", source: "DYNAMIC_CUP", status: "SCHEDULED" });
    const laterPublished = bracketReady.season.games
      .filter((game) => game.source === "PUBLISHED" && game.status === "SCHEDULED" && (game.awayTeamId === "HAWKS" || game.homeTeamId === "HAWKS"))
      .sort((first, second) => first.date.localeCompare(second.date))[0];
    expect(laterPublished.date).toBe("2026-12-12");
    expect(() => prepareCareerGame(bracketReady.season, bracketReady.progression, laterPublished.id, { difficulty: "ROOKIE", gameMinutes: 8 })).toThrow(/next scheduled/i);

    const preparation = prepareCareerGame(bracketReady.season, bracketReady.progression, cupGame!.id, { difficulty: "ROOKIE", gameMinutes: 8 });
    expect(preparation.launch.gameId).toBe(cupGame!.id);
    expect(preparation.season.games.find((game) => game.id === cupGame!.id)?.status).toBe("SCHEDULED");
  });

  it("uses projected IDs and descriptor-derived Cup gates in season two", () => {
    const initial = start("HAWKS", 2);
    const openingGame = nextPlayableCareerGame(initial.season)!;
    expect(openingGame).toMatchObject({
      id: "season-2-projected-85",
      date: "2027-10-21",
      source: "PROJECTED",
    });
    const openingPreparation = prepareCareerGame(initial.season, initial.progression, openingGame.id, {
      difficulty: "ROOKIE",
      gameMinutes: 8,
    });
    expect(openingPreparation.launch.gameId).toBe(openingGame.id);

    const throughGroupPlay = advanceCareerCalendar(initial.season, initial.progression, "2027-12-03");
    expect(throughGroupPlay.season.cupResolved).toBe(false);
    expect(nextPlayableCareerGame(throughGroupPlay.season)).toBeUndefined();
    const bracketReady = advanceCareerCalendar(throughGroupPlay.season, throughGroupPlay.progression, "2027-12-04");
    expect(nextPlayableCareerGame(bracketReady.season)).toMatchObject({
      id: expect.stringMatching(/^season-2-dynamic-cup-/),
      date: "2027-12-05",
      source: "DYNAMIC_CUP",
    });
  });

  it("rejects unknown, non-player, later, and already-final games", () => {
    const initial = start();
    const next = nextPlayableCareerGame(initial.season)!;
    const nonPlayer = initial.season.games.find((game) => game.awayTeamId !== "HAWKS" && game.homeTeamId !== "HAWKS")!;
    const later = initial.season.games
      .filter((game) => (game.awayTeamId === "HAWKS" || game.homeTeamId === "HAWKS") && game.id !== next.id)
      .sort((first, second) => first.date.localeCompare(second.date))[0];
    expect(() => prepareCareerGame(initial.season, initial.progression, "missing", { difficulty: "ROOKIE", gameMinutes: 8 })).toThrow(/unknown/i);
    expect(() => prepareCareerGame(initial.season, initial.progression, nonPlayer.id, { difficulty: "ROOKIE", gameMinutes: 8 })).toThrow(/player's team/i);
    expect(() => prepareCareerGame(initial.season, initial.progression, later.id, { difficulty: "ROOKIE", gameMinutes: 8 })).toThrow(/next scheduled/i);
    const final = advanceCareerCalendar(initial.season, initial.progression, next.date);
    expect(() => prepareCareerGame(final.season, final.progression, next.id, { difficulty: "ROOKIE", gameMinutes: 8 })).toThrow(/already final/i);
  });

  it("atomically records an away win, standings, player line, reward, chemistry, and coin mirror", () => {
    const preparation = prepared("HAWKS", "STARTER", 12).result;
    expect(preparation.launch.venue).toBe("AWAY");
    const beforeAway = preparation.season.standings.HAWKS;
    const beforeHome = preparation.season.standings[preparation.launch.opponentTeamId];
    const result = settle(preparation, 108, 101);
    const game = result.season.games.find((candidate) => candidate.id === preparation.launch.gameId)!;
    expect(result.status).toBe("APPLIED");
    expect(result.won).toBe(true);
    expect(game.status).toBe("FINAL");
    expect(game.result).toEqual({ awayScore: 108, homeScore: 101 });
    expect(result.season.standings.HAWKS).toMatchObject({ wins: beforeAway.wins + 1, losses: beforeAway.losses });
    expect(result.season.standings[preparation.launch.opponentTeamId]).toMatchObject({ wins: beforeHome.wins, losses: beforeHome.losses + 1 });
    expect(result.season.playerStats).toMatchObject({ games: 1, ...playerLine });
    expect(result.rewardCoins).toBe(360);
    expect(result.chemistryDelta).toBe(1);
    expect(result.progression.coins).toBe(360);
    expect(result.season.coins).toBe(result.progression.coins);
    expect(result.progression.processedRewardIds).toContain(`career-game:${game.id}:reward`);
    expect(result.progression.processedChemistryEventIds).toContain(`career-game:${game.id}:outcome`);
  });

  it("maps a home loss correctly and awards the same completed-game coins", () => {
    const preparation = advanceUntilVenue("HAWKS", "HOME");
    const priorCoins = preparation.progression.coins;
    const result = settlePlayedCareerGame(preparation.season, preparation.progression, preparation.launch, {
      completed: true,
      controlledTeamScore: 94,
      opponentScore: 99,
      playerLine,
    });
    const game = result.season.games.find((candidate) => candidate.id === preparation.launch.gameId)!;
    expect(game.result).toEqual({ awayScore: 99, homeScore: 94 });
    expect(result.won).toBe(false);
    expect(result.rewardCoins).toBe(360);
    expect(result.progression.coins - priorCoins).toBe(360);
    expect(result.chemistryDelta).toBe(-1);
  });

  it("treats a repeated completion as a no-op across every state slice", () => {
    const preparation = prepared().result;
    const first = settle(preparation);
    const second = settlePlayedCareerGame(first.season, first.progression, preparation.launch, {
      completed: true,
      controlledTeamScore: 108,
      opponentScore: 101,
      playerLine,
    });
    expect(second.status).toBe("ALREADY_FINAL");
    expect(second.season).toBe(first.season);
    expect(second.progression).toBe(first.progression);
    expect(second.rewardCoins).toBe(0);
    expect(second.chemistryDelta).toBe(0);
  });

  it("never converts a simulated final into a paid manual game", () => {
    const preparation = prepared().result;
    const simulated = simulateCareerToDate(
      preparation.season,
      preparation.launch.date,
      preparation.launch.effectiveRatings,
    );
    const result = settlePlayedCareerGame(simulated, preparation.progression, preparation.launch, {
      completed: true,
      controlledTeamScore: 108,
      opponentScore: 101,
      playerLine,
    });
    expect(result.status).toBe("ALREADY_FINAL");
    expect(result.progression.coins).toBe(0);
    expect(result.progression.processedRewardIds).toEqual([]);
  });

  it("leaves an unfinished game and its future reward eligibility untouched", () => {
    const preparation = prepared().result;
    const result = settlePlayedCareerGame(preparation.season, preparation.progression, preparation.launch, {
      completed: false,
      controlledTeamScore: 10,
      opponentScore: 9,
      playerLine,
    });
    expect(result.status).toBe("NOT_COMPLETED");
    expect(result.season).toBe(preparation.season);
    expect(result.progression).toBe(preparation.progression);
    expect(result.progression.processedRewardIds).toEqual([]);
  });

  it("rejects tied scores and inconsistent player lines without partial changes", () => {
    const preparation = prepared().result;
    expect(() => settlePlayedCareerGame(preparation.season, preparation.progression, preparation.launch, {
      completed: true,
      controlledTeamScore: 100,
      opponentScore: 100,
      playerLine,
    })).toThrow(/tied/i);
    expect(() => settlePlayedCareerGame(preparation.season, preparation.progression, preparation.launch, {
      completed: true,
      controlledTeamScore: 108,
      opponentScore: 101,
      playerLine: { ...playerLine, points: 21 },
    })).toThrow(/shooting totals/i);
    expect(preparation.season.games.find((game) => game.id === preparation.launch.gameId)?.status).toBe("SCHEDULED");
    expect(preparation.progression.coins).toBe(0);
  });

  it("rejects a settlement marker that exists before its schedule result", () => {
    const preparation = prepared().result;
    const corrupted = {
      ...preparation.progression,
      processedRewardIds: [`career-game:${preparation.launch.gameId}:reward`],
    };
    expect(() => settlePlayedCareerGame(preparation.season, corrupted, preparation.launch, {
      completed: true,
      controlledTeamScore: 108,
      opponentScore: 101,
      playerLine,
    })).toThrow(/markers/i);
  });
});
