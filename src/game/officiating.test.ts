import { describe, expect, it } from "vitest";
import {
  evaluateBasketInterference,
  assertNaturalFoulHistory,
  isActivelyGuarding,
  isInsideLane,
  isPenaltyAfterCommonFoul,
  isNaturalFoulAllowed,
  nextThreeSecondClock,
  resolveAutomaticFreeThrow,
  resolveShootingContact,
  resolveFoulPenalty,
  shouldCountDefensiveThreeSeconds,
  shouldCountOffensiveThreeSeconds,
} from "./officiating";

function simulateAlwaysCandidate(possessions: number, threePointAttempt: boolean) {
  const foulPossessions: number[] = [];
  const threePointFoulPossessions: number[] = [];
  for (let currentPossession = 1; currentPossession <= possessions; currentPossession += 1) {
    const history = { currentPossession, foulPossessions, threePointFoulPossessions };
    if (!isNaturalFoulAllowed(history, threePointAttempt)) continue;
    foulPossessions.push(currentPossession);
    if (threePointAttempt) threePointFoulPossessions.push(currentPossession);
  }
  return { foulPossessions, threePointFoulPossessions };
}

describe("natural foul frequency protection", () => {
  it("allows at most one natural personal foul in every sliding ten-possession window", () => {
    const history = simulateAlwaysCandidate(100, false);
    expect(history.foulPossessions).toEqual([1, 11, 21, 31, 41, 51, 61, 71, 81, 91]);
    for (let start = 1; start <= 91; start += 1) {
      expect(history.foulPossessions.filter((value) => value >= start && value <= start + 9)).toHaveLength(1);
    }
    expect(() => assertNaturalFoulHistory({ currentPossession: 100, ...history })).not.toThrow();
  });

  it("allows at most one natural three-point foul in every sliding fifty-possession window", () => {
    const history = simulateAlwaysCandidate(120, true);
    expect(history.foulPossessions).toEqual([1, 51, 101]);
    expect(history.threePointFoulPossessions).toEqual([1, 51, 101]);
    for (let start = 1; start <= 71; start += 1) {
      expect(history.threePointFoulPossessions.filter((value) => value >= start && value <= start + 49)).toHaveLength(1);
    }
    expect(() => assertNaturalFoulHistory({ currentPossession: 120, ...history })).not.toThrow();
  });

  it("reopens ordinary whistles at possession eleven while keeping threes locked until possession fifty-one", () => {
    const priorThree = { foulPossessions: [1], threePointFoulPossessions: [1] };
    expect(isNaturalFoulAllowed({ currentPossession: 11, ...priorThree }, false)).toBe(true);
    expect(isNaturalFoulAllowed({ currentPossession: 11, ...priorThree }, true)).toBe(false);
    expect(isNaturalFoulAllowed({ currentPossession: 50, ...priorThree }, true)).toBe(false);
    expect(isNaturalFoulAllowed({ currentPossession: 51, ...priorThree }, true)).toBe(true);
  });
});

describe("team foul penalties", () => {
  it("starts regulation bonus on the fifth ordinary team foul", () => {
    expect(isPenaltyAfterCommonFoul({ overtime: false, foulsBefore: 3, inLastTwoMinutes: false, lateFoulsBefore: 0 })).toBe(false);
    expect(isPenaltyAfterCommonFoul({ overtime: false, foulsBefore: 4, inLastTwoMinutes: false, lateFoulsBefore: 0 })).toBe(true);
  });

  it("starts overtime bonus on the fourth foul and honors the final-two-minute allowance", () => {
    expect(isPenaltyAfterCommonFoul({ overtime: true, foulsBefore: 3, inLastTwoMinutes: false, lateFoulsBefore: 0 })).toBe(true);
    expect(isPenaltyAfterCommonFoul({ overtime: false, foulsBefore: 2, inLastTwoMinutes: true, lateFoulsBefore: 0 })).toBe(false);
    expect(isPenaltyAfterCommonFoul({ overtime: false, foulsBefore: 3, inLastTwoMinutes: true, lateFoulsBefore: 1 })).toBe(true);
  });

  it("maps shooting, bonus and offensive fouls to the correct attempts", () => {
    expect(resolveFoulPenalty({ kind: "SHOOTING", shotMade: true, shotPoints: 3 }).freeThrows).toBe(1);
    expect(resolveFoulPenalty({ kind: "SHOOTING", shotMade: false, shotPoints: 3 }).freeThrows).toBe(3);
    expect(resolveFoulPenalty({ kind: "SHOOTING", shotMade: false, shotPoints: 2 }).freeThrows).toBe(2);
    expect(resolveFoulPenalty({ kind: "NON_SHOOTING", inPenalty: true }).freeThrows).toBe(2);
    expect(resolveFoulPenalty({ kind: "OFFENSIVE_CHARGE" })).toMatchObject({ freeThrows: 0, changePossession: true, countsTeamFoul: false });
  });
});

describe("automatic free throws", () => {
  it("is deterministic, bounded and improves with free-throw skill", () => {
    const low = resolveAutomaticFreeThrow({ freeThrow: 45, shotConsistency: 55, stamina: 70 }, 901);
    const repeat = resolveAutomaticFreeThrow({ freeThrow: 45, shotConsistency: 55, stamina: 70 }, 901);
    const high = resolveAutomaticFreeThrow({ freeThrow: 92, shotConsistency: 90, stamina: 85 }, 901);
    expect(repeat).toEqual(low);
    expect(low.probability).toBeGreaterThanOrEqual(0.42);
    expect(high.probability).toBeLessThanOrEqual(0.965);
    expect(high.probability).toBeGreaterThan(low.probability);
  });

  it("uses the same deterministic contact model for either team", () => {
    const attacker = { drawFoul: 88, strength: 82, ballSecurity: 78 };
    const disciplined = { defenseConsistency: 92, lateralQuickness: 88, helpDefenseIQ: 90 };
    const reckless = { defenseConsistency: 48, lateralQuickness: 55, helpDefenseIQ: 52 };
    const safe = resolveShootingContact(attacker, disciplined, 7_301, true, true);
    const risky = resolveShootingContact(attacker, reckless, 7_301, true, true);
    expect(risky.probability).toBeGreaterThan(safe.probability);
    expect(resolveShootingContact(attacker, reckless, 7_301, true, true)).toEqual(risky);
  });
});

describe("three-second rules", () => {
  const live = { attackingTeam: "home" as const, teamHasFrontcourtControl: true, teamHasControl: true };

  it("counts only frontcourt-controlled offensive lane occupancy", () => {
    expect(isInsideLane({ x: 18, y: 50 }, "home")).toBe(true);
    expect(shouldCountOffensiveThreeSeconds({ x: 18, y: 50 }, live)).toBe(true);
    expect(shouldCountOffensiveThreeSeconds({ x: 18, y: 50 }, { ...live, shotInProgress: true })).toBe(false);
    expect(shouldCountOffensiveThreeSeconds({ x: 18, y: 50 }, { ...live, teamHasFrontcourtControl: false })).toBe(false);
  });

  it("exempts an actively guarding or ball-handler defender", () => {
    const defender = { x: 16, y: 50 };
    const nearOpponent = { x: 17, y: 50 };
    expect(isActivelyGuarding(defender, [nearOpponent])).toBe(true);
    expect(shouldCountDefensiveThreeSeconds(defender, [nearOpponent], live)).toBe(false);
    expect(shouldCountDefensiveThreeSeconds(defender, [{ x: 45, y: 50 }], live)).toBe(true);
    expect(shouldCountDefensiveThreeSeconds(defender, [{ x: 45, y: 50 }], live, true)).toBe(false);
    expect(nextThreeSecondClock(2.9, 0.1, true)).toBe(3);
    expect(nextThreeSecondClock(2.9, 0.1, false)).toBe(0);
  });
});

describe("basket interference", () => {
  it("awards defensive goaltending and rejects offensive cylinder contact", () => {
    expect(evaluateBasketInterference({
      shootingTeam: "home", touchingTeam: "away", descending: true, aboveRing: true,
      withinCylinder: false, touchedBackboard: false, hasChanceToScore: true,
    })).toBe("DEFENSIVE_GOALTENDING");
    expect(evaluateBasketInterference({
      shootingTeam: "home", touchingTeam: "home", descending: false, aboveRing: true,
      withinCylinder: true, touchedBackboard: false, hasChanceToScore: true,
    })).toBe("OFFENSIVE_INTERFERENCE");
    expect(evaluateBasketInterference({
      shootingTeam: "home", touchingTeam: "away", descending: false, aboveRing: false,
      withinCylinder: false, touchedBackboard: false, hasChanceToScore: true,
    })).toBe("LEGAL");
  });
});
