import { describe, expect, it } from "vitest";
import type { CareerPlayerGameLine } from "./career-game-settlement";
import {
  assertPostseasonPerformanceState,
  createPostseasonPerformanceState,
  markLegacyUntrackedGames,
  postseasonPerformanceTotals,
  recordPostseasonPlayerGame,
  type PostseasonPlayerGameRecord,
} from "./career-postseason-performance";

const line = (overrides: Partial<CareerPlayerGameLine> = {}): CareerPlayerGameLine => ({
  points: 24,
  rebounds: 7,
  assists: 6,
  steals: 2,
  blocks: 1,
  turnovers: 3,
  made: 9,
  attempts: 18,
  threesMade: 3,
  threesAttempted: 8,
  freeThrowsMade: 3,
  freeThrowsAttempted: 4,
  ...overrides,
});

const game = (overrides: Partial<PostseasonPlayerGameRecord> = {}): PostseasonPlayerGameRecord => ({
  gameId: "season-1:playin:EAST:A",
  eventId: "season-1:playin:EAST:A:FINAL:112-104",
  competition: "PLAY_IN",
  source: "PLAYED",
  teamId: "WIZARDS",
  opponentTeamId: "BULLS",
  venue: "HOME",
  teamScore: 112,
  opponentScore: 104,
  won: true,
  playerLine: line(),
  ...overrides,
});

describe("career postseason player performance", () => {
  it("creates two empty competition buckets and exposes a combined total", () => {
    const state = createPostseasonPerformanceState("WIZARDS");
    expect(state).toMatchObject({ schemaVersion: 1, coverage: "COMPLETE", trackingStartRevision: 0, legacyUntrackedGameIds: [] });
    expect(state.byCompetition.PLAY_IN.games).toEqual([]);
    expect(state.byCompetition.PLAYOFF.games).toEqual([]);
    expect(postseasonPerformanceTotals(state)).toEqual({
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
  });

  it("records play-in and playoff games separately while replaying combined totals", () => {
    const initial = createPostseasonPerformanceState("WIZARDS");
    const first = recordPostseasonPlayerGame(initial, game());
    expect(first.status).toBe("APPLIED");
    if (first.status !== "APPLIED") return;
    const playoff = game({
      gameId: "season-1:series:F1:G1",
      eventId: "season-1:series:F1:G1:FINAL:101-108",
      competition: "PLAYOFF",
      round: "FIRST_ROUND",
      source: "SIMULATED",
      opponentTeamId: "CELTICS",
      venue: "AWAY",
      teamScore: 101,
      opponentScore: 108,
      won: false,
      playerLine: line({ points: 18, made: 7, threesMade: 2, freeThrowsMade: 2 }),
    });
    const second = recordPostseasonPlayerGame(first.state, playoff);
    expect(second.status).toBe("APPLIED");
    if (second.status !== "APPLIED") return;

    expect(postseasonPerformanceTotals(second.state, "PLAY_IN")).toMatchObject({ games: 1, points: 24 });
    expect(postseasonPerformanceTotals(second.state, "PLAYOFF")).toMatchObject({ games: 1, points: 18 });
    expect(postseasonPerformanceTotals(second.state)).toMatchObject({ games: 2, points: 42, rebounds: 14, assists: 12 });
    expect(initial.byCompetition.PLAY_IN.games).toHaveLength(0);
    assertPostseasonPerformanceState(JSON.parse(JSON.stringify(second.state)));
  });

  it("returns a reference-equal NOOP for an identical game and rejects game/event conflicts atomically", () => {
    const applied = recordPostseasonPlayerGame(createPostseasonPerformanceState("WIZARDS"), game());
    if (applied.status !== "APPLIED") throw new Error("fixture application failed");

    const duplicate = recordPostseasonPlayerGame(applied.state, structuredClone(game()));
    expect(duplicate.status).toBe("NOOP");
    expect(duplicate.state).toBe(applied.state);

    const gameConflict = recordPostseasonPlayerGame(applied.state, game({ eventId: "different-event", playerLine: line({ rebounds: 8 }) }));
    expect(gameConflict).toMatchObject({ status: "REJECTED", code: "CONFLICT" });
    expect(gameConflict.state).toBe(applied.state);

    const eventConflict = recordPostseasonPlayerGame(applied.state, game({ gameId: "different-game", opponentTeamId: "CELTICS" }));
    expect(eventConflict).toMatchObject({ status: "REJECTED", code: "CONFLICT" });
    expect(eventConflict.state).toBe(applied.state);

    const malformedReplay = recordPostseasonPlayerGame(applied.state, game({ playerLine: line({ points: 25 }) }));
    expect(malformedReplay).toMatchObject({ status: "REJECTED", code: "CONFLICT" });
    expect(malformedReplay.state).toBe(applied.state);
    expect(applied.state.byCompetition.PLAY_IN.games).toHaveLength(1);
  });

  it("rejects invalid lines, scores, outcomes and non-player-team records without mutation", () => {
    const state = createPostseasonPerformanceState("WIZARDS");
    const invalid = [
      game({ playerLine: line({ rebounds: -1 }) }),
      game({ playerLine: line({ made: 19 }) }),
      game({ playerLine: line({ points: 25 }) }),
      game({ teamScore: 20 }),
      game({ won: false }),
      game({ teamScore: 104, opponentScore: 104 }),
      game({ teamId: "BULLS", opponentTeamId: "WIZARDS" }),
      game({ competition: "PLAY_IN", round: "FIRST_ROUND" }),
    ];
    for (const record of invalid) {
      const result = recordPostseasonPlayerGame(state, record);
      expect(result).toMatchObject({ status: "REJECTED", code: "INVALID_RECORD" });
      expect(result.state).toBe(state);
    }
    expect(postseasonPerformanceTotals(state).games).toBe(0);
  });

  it("detects aggregate, bucket and identity tampering during validation", () => {
    const applied = recordPostseasonPlayerGame(createPostseasonPerformanceState("WIZARDS"), game());
    if (applied.status !== "APPLIED") throw new Error("fixture application failed");

    const aggregate = structuredClone(applied.state);
    aggregate.byCompetition.PLAY_IN.totals.points += 1;
    expect(() => assertPostseasonPerformanceState(aggregate)).toThrow(/replayed|shooting totals/i);

    const bucket = structuredClone(applied.state);
    bucket.byCompetition.PLAYOFF.games.push({ ...structuredClone(game()), competition: "PLAY_IN" });
    expect(() => assertPostseasonPerformanceState(bucket)).toThrow(/bucket/i);

    const duplicate = structuredClone(applied.state);
    duplicate.byCompetition.PLAYOFF.games.push({
      ...structuredClone(game()),
      competition: "PLAYOFF",
      round: "FIRST_ROUND",
    });
    duplicate.byCompetition.PLAYOFF.totals = { ...duplicate.byCompetition.PLAY_IN.totals };
    expect(() => assertPostseasonPerformanceState(duplicate)).toThrow(/duplicate game/i);
  });

  it("marks irrecoverable legacy games without fabricating stats and keeps the marker idempotent", () => {
    const initial = createPostseasonPerformanceState("WIZARDS");
    const partial = markLegacyUntrackedGames(initial, ["old-g2", "old-g1", "old-g2"]);
    expect(partial).toMatchObject({
      coverage: "PARTIAL_LEGACY",
      legacyUntrackedGameIds: ["old-g1", "old-g2"],
    });
    expect(postseasonPerformanceTotals(partial).games).toBe(0);
    expect(markLegacyUntrackedGames(partial, ["old-g1"])).toBe(partial);

    const rejected = recordPostseasonPlayerGame(partial, game({ gameId: "old-g1", eventId: "old-event" }));
    expect(rejected).toMatchObject({ status: "REJECTED", code: "LEGACY_UNTRACKED" });
    expect(rejected.state).toBe(partial);

    const applied = recordPostseasonPlayerGame(partial, game());
    if (applied.status !== "APPLIED") throw new Error("fixture application failed");
    expect(() => markLegacyUntrackedGames(applied.state, [game().gameId])).toThrow(/tracked game/i);
    assertPostseasonPerformanceState(applied.state);
  });

  it("rejects coverage drift, duplicate legacy IDs and a non-replayable restored state", () => {
    const complete = createPostseasonPerformanceState("WIZARDS");
    expect(() => assertPostseasonPerformanceState({ ...complete, coverage: "PARTIAL_LEGACY" })).toThrow(/coverage/i);
    expect(() => assertPostseasonPerformanceState({
      ...complete,
      coverage: "PARTIAL_LEGACY",
      legacyUntrackedGameIds: ["old", "old"],
    })).toThrow(/duplicate/i);

    const partial = createPostseasonPerformanceState("WIZARDS", { legacyUntrackedGameIds: ["old-g1"], trackingStartRevision: 7 });
    expect(partial.coverage).toBe("PARTIAL_LEGACY");
    expect(partial.trackingStartRevision).toBe(7);
    const corrupted = structuredClone(partial);
    corrupted.legacyUntrackedGameIds = [];
    expect(() => assertPostseasonPerformanceState(corrupted)).toThrow(/coverage/i);
    expect(() => assertPostseasonPerformanceState({ ...complete, trackingStartRevision: -1 })).toThrow(/trackingStartRevision/i);
  });
});
