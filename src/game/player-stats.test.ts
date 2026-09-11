import { describe, expect, it } from "vitest";
import { players } from "./data";
import {
  applyPlayerStatsEvent,
  applyPlayerStatsEvents,
  assertPlayerStatsLedger,
  initializeTenPlayerStats,
} from "./player-stats";

function ledger() {
  return initializeTenPlayerStats(players);
}

describe("ten-player stats ledger", () => {
  it("initializes five players per team with every counting stat at zero", () => {
    const stats = ledger();
    expect(stats.playerIds).toHaveLength(10);
    expect(Object.values(stats.byPlayerId)).toHaveLength(10);
    expect(Object.values(stats.byPlayerId).filter((line) => line.team === "home")).toHaveLength(5);
    Object.values(stats.byPlayerId).forEach((line) => {
      expect(line.points).toBe(0);
      expect(line.rebounds).toBe(0);
      expect(line.secondsPlayed).toBe(0);
      expect(line.plusMinus).toBe(0);
    });
  });

  it("rejects incomplete, unbalanced and duplicate ten-player rosters", () => {
    expect(() => initializeTenPlayerStats(players.slice(0, 9))).toThrow(/exactly 10/);
    expect(() => initializeTenPlayerStats([...players.slice(0, 9), players[0]])).toThrow(/unique/);
    expect(() => initializeTenPlayerStats(players.map((player) => ({ ...player, team: "home" as const })))).toThrow(/five home/);
  });

  it("records made and missed field goals, threes, assists, blocks and plus-minus", () => {
    const stats = applyPlayerStatsEvents(ledger(), [
      { type: "SHOT_ATTEMPT", shooterId: "h1", made: true, points: 3, assistPlayerId: "h2" },
      { type: "SHOT_ATTEMPT", shooterId: "h1", made: false, points: 2, blockedByPlayerId: "a23" },
    ]);
    expect(stats.byPlayerId.h1).toMatchObject({
      fieldGoalsMade: 1,
      fieldGoalsAttempted: 2,
      threePointersMade: 1,
      threePointersAttempted: 1,
      points: 3,
    });
    expect(stats.byPlayerId.h2.assists).toBe(1);
    expect(stats.byPlayerId.a23.blocks).toBe(1);
    expect(stats.byPlayerId.h4.plusMinus).toBe(3);
    expect(stats.byPlayerId.a7.plusMinus).toBe(-3);
  });

  it("records animated free-throw results and updates scoring differential", () => {
    const stats = applyPlayerStatsEvents(ledger(), [
      { type: "FREE_THROW", shooterId: "a7", made: true },
      { type: "FREE_THROW", shooterId: "a7", made: false },
    ]);
    expect(stats.byPlayerId.a7).toMatchObject({ freeThrowsMade: 1, freeThrowsAttempted: 2, points: 1 });
    expect(stats.byPlayerId.a23.plusMinus).toBe(1);
    expect(stats.byPlayerId.h1.plusMinus).toBe(-1);
  });

  it("keeps total rebounds equal to offensive plus defensive rebounds", () => {
    const stats = applyPlayerStatsEvents(ledger(), [
      { type: "REBOUND", playerId: "h5", offensive: true },
      { type: "REBOUND", playerId: "h5", offensive: false },
      { type: "REBOUND", playerId: "h5", offensive: false },
    ]);
    expect(stats.byPlayerId.h5).toMatchObject({ offensiveRebounds: 1, defensiveRebounds: 2, rebounds: 3 });
    expect(() => assertPlayerStatsLedger(stats)).not.toThrow();
  });

  it("records an atomic stolen turnover and personal fouls", () => {
    const stats = applyPlayerStatsEvents(ledger(), [
      { type: "TURNOVER", playerId: "h1", stolenByPlayerId: "a7" },
      { type: "PERSONAL_FOUL", playerId: "a7" },
    ]);
    expect(stats.byPlayerId.h1.turnovers).toBe(1);
    expect(stats.byPlayerId.a7.steals).toBe(1);
    expect(stats.byPlayerId.a7.personalFouls).toBe(1);
  });

  it("updates immutably and never increments an assist on a missed shot", () => {
    const before = ledger();
    const after = applyPlayerStatsEvent(before, {
      type: "SHOT_ATTEMPT", shooterId: "h3", made: false, points: 3, assistPlayerId: "h1",
    });
    expect(after).not.toBe(before);
    expect(after.byPlayerId.h3).not.toBe(before.byPlayerId.h3);
    expect(before.byPlayerId.h3.fieldGoalsAttempted).toBe(0);
    expect(before.byPlayerId.h1.assists).toBe(0);
    expect(after.byPlayerId.h1.assists).toBe(0);
    expect(after.byPlayerId.h3.fieldGoalsMade).toBeLessThanOrEqual(after.byPlayerId.h3.fieldGoalsAttempted);
  });

  it("accrues playing time only for the supplied on-court unit", () => {
    const stats = applyPlayerStatsEvent(ledger(), {
      type: "PLAYING_TIME",
      elapsedSeconds: 12.5,
      onCourtPlayerIds: ["h1", "h2", "h3", "h4", "h5"],
    });
    expect(stats.byPlayerId.h1.secondsPlayed).toBe(12.5);
    expect(stats.byPlayerId.h5.secondsPlayed).toBe(12.5);
    expect(stats.byPlayerId.a7.secondsPlayed).toBe(0);
  });

  it("rejects cross-team assists, same-team steals, same-team blocks and unknown players", () => {
    const stats = ledger();
    expect(() => applyPlayerStatsEvent(stats, {
      type: "SHOT_ATTEMPT", shooterId: "h1", made: true, points: 2, assistPlayerId: "a7",
    })).toThrow(/assist/);
    expect(() => applyPlayerStatsEvent(stats, {
      type: "TURNOVER", playerId: "h1", stolenByPlayerId: "h2",
    })).toThrow(/steal/);
    expect(() => applyPlayerStatsEvent(stats, {
      type: "SHOT_ATTEMPT", shooterId: "h1", made: false, points: 2, blockedByPlayerId: "h5",
    })).toThrow(/block/);
    expect(() => applyPlayerStatsEvent(stats, { type: "REBOUND", playerId: "missing", offensive: false })).toThrow(/Unknown/);
  });
});
