import { describe, expect, it } from "vitest";
import { RATING_IDS, type RatingId } from "./ratings";
import type { Ratings } from "./types";
import {
  TRAINING_GROUPS,
  ageDeclineBudget,
  applyChemistryEvent,
  applyTrainingSession,
  assertCareerProgression,
  attributePointCost,
  awardPlayedMatch,
  calculateCareerGameReward,
  calculatePlayedMatchReward,
  chemistryRatingBonus,
  chemistryCoordinationModifiers,
  completeCareerSeason,
  completeTrainingWeek,
  createCareerProgression,
  effectiveRatings,
  purchaseAttributePoint,
  scaleControlledPositiveContribution,
  scaleControlledAttributeContribution,
  settleCareerGameReward,
} from "./career-progression";

function ratingsAt(value: number): Ratings {
  return Object.fromEntries(RATING_IDS.map((id) => [id, value])) as unknown as Ratings;
}

function runWeeks(state: ReturnType<typeof createCareerProgression>, weeks: number) {
  let next = state;
  for (let index = 0; index < weeks; index += 1) {
    next = completeTrainingWeek(next, { weekId: `season-${next.season}-week-${next.week}`, expectedWeek: next.week });
  }
  return next;
}

describe("career progression", () => {
  it("covers all 38 ratings with at least one training group", () => {
    const covered = new Set(TRAINING_GROUPS.flatMap((group) => group.ratingIds));
    expect(covered).toEqual(new Set(RATING_IDS));
    expect(RATING_IDS).toHaveLength(38);
  });

  it("starts a new career at age 20 with 10 percent chemistry", () => {
    const state = createCareerProgression(ratingsAt(70));
    expect(state.age).toBe(20);
    expect(state.retired).toBe(false);
    expect(state.chemistryPercent).toBe(10);
    expect(chemistryRatingBonus(state.chemistryPercent)).toBe(1);
  });

  it("limits training to two weekly sessions and turns two 50-unit secondary gains into one point", () => {
    let state = createCareerProgression(ratingsAt(70));
    state = applyTrainingSession(state, {
      sessionId: "week-1-shooting-1",
      groupId: "SHOOTING",
      primaryRatingId: "threePoint",
      secondaryRatingIds: ["midRange", "freeThrow"],
    });
    expect(state.ratings.threePoint).toBe(71);
    expect(state.ratings.midRange).toBe(70);
    expect(state.secondaryProgressUnits.midRange).toBe(50);

    state = applyTrainingSession(state, {
      sessionId: "week-1-shooting-2",
      groupId: "SHOOTING",
      primaryRatingId: "catchShoot",
      secondaryRatingIds: ["midRange", "freeThrow"],
    });
    expect(state.ratings.catchShoot).toBe(71);
    expect(state.ratings.midRange).toBe(71);
    expect(state.ratings.freeThrow).toBe(71);
    expect(() => applyTrainingSession(state, { sessionId: "week-1-shooting-3", groupId: "SHOOTING", primaryRatingId: "pullUpShot" })).toThrow(/limit/i);
    expect(state.ledger.filter((entry) => entry.source === "TRAINING")).toHaveLength(4);
    expect(state.secondaryProgressUnits.midRange).toBe(0);
  });

  it("makes training and week settlement idempotent and rejects stale week commands", () => {
    const initial = createCareerProgression(ratingsAt(70));
    const trained = applyTrainingSession(initial, {
      sessionId: "week-1-session-1",
      groupId: "SHOOTING",
      primaryRatingId: "threePoint",
    });
    expect(applyTrainingSession(trained, {
      sessionId: "week-1-session-1",
      groupId: "SHOOTING",
      primaryRatingId: "threePoint",
    })).toBe(trained);
    expect(trained.ratings.threePoint).toBe(71);
    expect(trained.sessionsUsedThisWeek).toBe(1);

    const settled = completeTrainingWeek(trained, { weekId: "career-week-1", expectedWeek: 1 });
    expect(completeTrainingWeek(settled, { weekId: "career-week-1", expectedWeek: 1 })).toBe(settled);
    expect(settled.week).toBe(2);
    expect(() => completeTrainingWeek(settled, { weekId: "stale-retry", expectedWeek: 1 })).toThrow(/stale/i);
  });

  it("does not bank hidden secondary progress at the 99 cap", () => {
    const values = ratingsAt(70);
    values.midRange = 99;
    const state = applyTrainingSession(createCareerProgression(values), {
      sessionId: "cap-secondary",
      groupId: "SHOOTING",
      primaryRatingId: "threePoint",
      secondaryRatingIds: ["midRange"],
    });
    expect(state.ratings.midRange).toBe(99);
    expect(state.secondaryProgressUnits.midRange).toBe(0);
  });

  it("rejects ratings outside the selected training group", () => {
    const state = createCareerProgression(ratingsAt(70));
    expect(() => applyTrainingSession(state, {
      sessionId: "invalid-cross-group",
      groupId: "SHOOTING",
      primaryRatingId: "speed",
    })).toThrow(/not covered/i);
  });

  it("uses fractional inactivity decay after three protected weeks", () => {
    const initial = createCareerProgression(ratingsAt(70));
    const afterThree = runWeeks(initial, 3);
    expect(afterThree.ratings.threePoint).toBe(70);
    const afterSeven = runWeeks(afterThree, 4);
    expect(afterSeven.ratings.threePoint).toBe(70);
    const afterEight = runWeeks(afterSeven, 1);
    expect(afterEight.ratings.threePoint).toBe(69);
    expect(afterEight.ledger.some((entry) => entry.source === "INACTIVITY" && entry.ratingId === "threePoint")).toBe(true);
  });

  it("lets any overlapping training group maintain a shared rating", () => {
    let state = runWeeks(createCareerProgression(ratingsAt(70)), 7);
    state = applyTrainingSession(state, { sessionId: "week-8-rebounding", groupId: "REBOUNDING", primaryRatingId: "strength" });
    state = completeTrainingWeek(state, { weekId: `season-${state.season}-week-${state.week}`, expectedWeek: state.week });
    expect(state.ratings.strength).toBe(71);
    expect(state.groupDormancyWeeks.REBOUNDING).toBe(0);
  });

  it("clears fractional inactivity debt when a related group is maintained", () => {
    let state = runWeeks(createCareerProgression(ratingsAt(70)), 7);
    expect(state.inactivityProgressUnits.threePoint).toBe(80);
    state = applyTrainingSession(state, { sessionId: "week-8-shooting", groupId: "SHOOTING", primaryRatingId: "freeThrow" });
    expect(state.inactivityProgressUnits.threePoint).toBe(0);
    state = runWeeks(state, 4);
    expect(state.ratings.threePoint).toBe(70);
  });

  it("caps inactivity loss at six per season and protects young players near their rookie floor", () => {
    const state = runWeeks(createCareerProgression(ratingsAt(70)), 80);
    for (const id of RATING_IDS) {
      expect(70 - state.ratings[id]).toBeLessThanOrEqual(6);
      expect(state.ratings[id]).toBeGreaterThanOrEqual(62);
    }
  });

  it("matches the complete five-difficulty by three-length reward matrix", () => {
    const expected = {
      ROOKIE: { 8: 90, 12: 108, 24: 130 },
      PRO: { 8: 240, 12: 288, 24: 348 },
      STARTER: { 8: 300, 12: 360, 24: 435 },
      ALL_STAR: { 8: 330, 12: 396, 24: 478 },
      HALL_OF_FAME: { 8: 390, 12: 468, 24: 565 },
    } as const;
    for (const [difficulty, byLength] of Object.entries(expected)) {
      for (const [minutes, reward] of Object.entries(byLength)) {
        expect(calculatePlayedMatchReward(difficulty as keyof typeof expected, Number(minutes) as 8 | 12 | 24)).toBe(reward);
      }
    }
  });

  it("lets a 100 percent reward buy three early points and a 30 percent reward buy one", () => {
    let starter = awardPlayedMatch(createCareerProgression(ratingsAt(70)), "season-1-game-1", "STARTER", 8);
    starter = purchaseAttributePoint(starter, "starter-buy-1", "threePoint");
    starter = purchaseAttributePoint(starter, "starter-buy-2", "threePoint");
    starter = purchaseAttributePoint(starter, "starter-buy-3", "threePoint");
    expect(starter.ratings.threePoint).toBe(73);
    expect(starter.coins).toBe(30);

    let rookie = awardPlayedMatch(createCareerProgression(ratingsAt(70)), "season-1-game-1", "ROOKIE", 8);
    rookie = purchaseAttributePoint(rookie, "rookie-buy-1", "threePoint");
    expect(rookie.ratings.threePoint).toBe(71);
    expect(rookie.coins).toBe(0);
  });

  it("awards each played match once and gives simulated or tutorial games no implicit reward", () => {
    const initial = createCareerProgression(ratingsAt(70));
    const awarded = awardPlayedMatch(initial, "season-1-game-1", "STARTER", 8);
    const duplicate = awardPlayedMatch(awarded, "season-1-game-1", "HALL_OF_FAME", 24);
    expect(awarded.coins).toBe(300);
    expect(duplicate).toBe(awarded);
    expect(duplicate.processedRewardIds).toEqual(["season-1-game-1"]);
    expect(initial.coins).toBe(0);
    expect(() => awardPlayedMatch(initial, "   ", "STARTER", 8)).toThrow(/reward id/i);

    expect(calculateCareerGameReward({ difficulty: "STARTER", gameMinutes: 8, mode: "SIMULATED", completed: true })).toBe(0);
    expect(calculateCareerGameReward({ difficulty: "STARTER", gameMinutes: 8, mode: "TUTORIAL", completed: true })).toBe(0);
    expect(calculateCareerGameReward({ difficulty: "STARTER", gameMinutes: 8, mode: "PLAYED", completed: false })).toBe(0);

    const simulated = settleCareerGameReward(initial, {
      rewardId: "sim-1",
      difficulty: "HALL_OF_FAME",
      gameMinutes: 24,
      mode: "SIMULATED",
      completed: true,
    });
    expect(simulated.coins).toBe(0);
    expect(simulated.processedRewardIds).toEqual(["sim-1"]);
  });

  it("raises attribute prices near 99 and never sells a point above the cap", () => {
    expect(attributePointCost(79)).toBe(90);
    expect(attributePointCost(80)).toBe(120);
    expect(attributePointCost(85)).toBe(160);
    expect(attributePointCost(90)).toBe(220);
    expect(attributePointCost(95)).toBe(300);
    expect(attributePointCost(99)).toBeNull();
    const state = createCareerProgression(ratingsAt(99), { coins: 1_000 });
    expect(() => purchaseAttributePoint(state, "buy-at-cap", "threePoint")).toThrow(/already at 99/i);
  });

  it("charges the next price tier immediately after crossing 79", () => {
    const values = ratingsAt(70);
    values.threePoint = 79;
    let state = createCareerProgression(values, { coins: 210 });
    state = purchaseAttributePoint(state, "tier-buy-1", "threePoint");
    expect(state.ratings.threePoint).toBe(80);
    expect(state.coins).toBe(120);
    state = purchaseAttributePoint(state, "tier-buy-2", "threePoint");
    expect(state.ratings.threePoint).toBe(81);
    expect(state.coins).toBe(0);
  });

  it("caps chemistry at a five-point effective bonus without changing raw ratings", () => {
    expect([10, 20, 30, 40, 50, 100].map(chemistryRatingBonus)).toEqual([1, 2, 3, 4, 5, 5]);
    let state = createCareerProgression(ratingsAt(97), { chemistryPercent: 49 });
    state = applyChemistryEvent(state, "chemistry-win-1", "WIN");
    expect(state.chemistryPercent).toBe(50);
    expect(applyChemistryEvent(state, "chemistry-win-1", "WIN")).toBe(state);
    const effective = effectiveRatings(state.ratings, state.chemistryPercent);
    expect(effective.threePoint).toBe(99);
    expect(state.ratings.threePoint).toBe(97);
  });

  it("uses chemistry above 50 only for bounded coordination benefits", () => {
    expect(chemistryCoordinationModifiers(50)).toEqual({
      routeSettleTimeMultiplier: 1,
      misreadRiskMultiplier: 1,
      switchCommunicationBonus: 0,
    });
    expect(chemistryCoordinationModifiers(100)).toEqual({
      routeSettleTimeMultiplier: 0.9,
      misreadRiskMultiplier: 0.8,
      switchCommunicationBonus: 0.05,
    });
    expect(chemistryRatingBonus(100)).toBe(5);
  });

  it("exposes the frozen player-contribution difficulty policy without mutating ratings", () => {
    expect(scaleControlledPositiveContribution(10, "ROOKIE")).toBe(12);
    expect(scaleControlledPositiveContribution(10, "PRO")).toBe(9);
    expect(scaleControlledPositiveContribution(10, "STARTER")).toBe(8);
    expect(scaleControlledPositiveContribution(10, "ALL_STAR")).toBe(7.5);
    expect(scaleControlledPositiveContribution(10, "HALL_OF_FAME")).toBe(7);
    expect(() => scaleControlledPositiveContribution(Number.NaN, "STARTER")).toThrow(/finite/i);
    expect(scaleControlledAttributeContribution(-0.5, "ROOKIE")).toBe(-0.5);
    expect(scaleControlledAttributeContribution(-0.5, "HALL_OF_FAME")).toBe(-0.5);
    expect(scaleControlledAttributeContribution(0.5, "ROOKIE")).toBe(0.6);
    expect(scaleControlledAttributeContribution(0.5, "HALL_OF_FAME")).toBe(0.35);
  });

  it("starts age decline at 32, keeps it category-budgeted, and retires at 40", () => {
    expect(ageDeclineBudget(31)).toEqual({ athletic: 0, execution: 0, skill: 0 });
    expect(ageDeclineBudget(32)).toEqual({ athletic: 1, execution: 0, skill: 0 });
    expect(ageDeclineBudget(39)).toEqual({ athletic: 4, execution: 2, skill: 2 });

    const age31 = createCareerProgression(ratingsAt(75), { age: 31, season: 12 });
    const age32 = completeCareerSeason(age31, "season-12");
    expect(age32.age).toBe(32);
    expect(age32.ledger.filter((entry) => entry.source === "AGE")).toHaveLength(1);
    expect(RATING_IDS.reduce((sum, id) => sum + age31.ratings[id] - age32.ratings[id], 0)).toBe(1);

    const age39 = createCareerProgression(ratingsAt(75), { age: 39, season: 20 });
    const retired = completeCareerSeason(age39, "season-20");
    expect(retired.age).toBe(40);
    expect(retired.retired).toBe(true);
    expect(retired.season).toBe(20);
    expect(() => applyTrainingSession(retired, { sessionId: "retired-training", groupId: "SHOOTING", primaryRatingId: "threePoint" })).toThrow(/retired/i);
  });

  it("resets offseason-only training cadence without discarding banked secondary progress", () => {
    let state = createCareerProgression(ratingsAt(75), { season: 4 });
    state = applyTrainingSession(state, {
      sessionId: "season-4-session",
      groupId: "SHOOTING",
      primaryRatingId: "threePoint",
      secondaryRatingIds: ["midRange"],
    });
    state = runWeeks(state, 8);
    expect(Object.values(state.groupDormancyWeeks).some((weeks) => weeks > 0)).toBe(true);
    expect(state.secondaryProgressUnits.midRange).toBe(50);

    const next = completeCareerSeason(state, "season-4");
    expect(next.season).toBe(5);
    expect(next.week).toBe(1);
    expect(next.sessionsUsedThisWeek).toBe(0);
    expect(next.trainedGroupsThisWeek).toEqual([]);
    expect(Object.values(next.groupDormancyWeeks).every((weeks) => weeks === 0)).toBe(true);
    expect(next.inactivityProgressUnits).toEqual({});
    expect(next.seasonInactivityLosses).toEqual({});
    expect(next.secondaryProgressUnits.midRange).toBe(50);
    expect(next.processedTrainingSessionIds).toEqual(state.processedTrainingSessionIds);
    expect(next.processedWeekIds).toEqual(state.processedWeekIds);
    expect(next.processedRewardIds).toEqual(state.processedRewardIds);
    expect(next.processedPurchaseIds).toEqual(state.processedPurchaseIds);
    expect(next.processedChemistryEventIds).toEqual(state.processedChemistryEventIds);
  });

  it("matches the complete age decline budget table", () => {
    expect([31, 32, 33, 34, 35, 36, 37, 38, 39, 40].map(ageDeclineBudget)).toEqual([
      { athletic: 0, execution: 0, skill: 0 },
      { athletic: 1, execution: 0, skill: 0 },
      { athletic: 1, execution: 1, skill: 0 },
      { athletic: 1, execution: 1, skill: 0 },
      { athletic: 2, execution: 1, skill: 0 },
      { athletic: 2, execution: 1, skill: 1 },
      { athletic: 3, execution: 1, skill: 1 },
      { athletic: 3, execution: 2, skill: 1 },
      { athletic: 4, execution: 2, skill: 2 },
      { athletic: 0, execution: 0, skill: 0 },
    ]);
  });

  it("settles a season once and reaches forced retirement after 20 unique seasons", () => {
    let state = createCareerProgression(ratingsAt(75));
    for (let season = 1; season <= 20; season += 1) {
      const settled = completeCareerSeason(state, `season-${season}`);
      expect(completeCareerSeason(settled, `season-${season}`)).toBe(settled);
      state = settled;
    }
    expect(state.age).toBe(40);
    expect(state.retired).toBe(true);
    expect(state.processedSeasonIds).toHaveLength(20);
  });

  it("cannot use protected ratings to erase mandatory athletic age decline", () => {
    const age38 = createCareerProgression(ratingsAt(75), { age: 38, season: 19 });
    const age39 = completeCareerSeason(age38, "season-19", [...RATING_IDS]);
    expect(age39.age).toBe(39);
    const athleticIds: RatingId[] = ["speed", "speedWithBall", "acceleration", "strength", "vertical", "stamina", "agility"];
    expect(athleticIds.reduce((total, id) => total + age38.ratings[id] - age39.ratings[id], 0)).toBe(4);
  });

  it("freezes rewards, chemistry and week settlement after retirement", () => {
    const retired = createCareerProgression(ratingsAt(75), { age: 40 });
    expect(awardPlayedMatch(retired, "retired-game", "HALL_OF_FAME", 24)).toBe(retired);
    expect(applyChemistryEvent(retired, "retired-win", "WIN")).toBe(retired);
    expect(completeTrainingWeek(retired, { weekId: "retired-week", expectedWeek: 999 })).toBe(retired);
  });

  it("rejects non-finite career initialization values", () => {
    expect(() => createCareerProgression(ratingsAt(70), { age: Number.NaN })).toThrow(/finite/i);
    expect(() => createCareerProgression(ratingsAt(70), { coins: Number.POSITIVE_INFINITY })).toThrow(/finite/i);
    expect(() => createCareerProgression(ratingsAt(70), { season: Number.NEGATIVE_INFINITY })).toThrow(/finite/i);
    expect(() => createCareerProgression(ratingsAt(70), { chemistryPercent: Number.NaN })).toThrow(/finite/i);
  });

  it("writes an explainable ledger entry for every permanent rating change", () => {
    let state = createCareerProgression(ratingsAt(70), { coins: 90 });
    state = applyTrainingSession(state, { sessionId: "ledger-training-1", groupId: "PLAYMAKING", primaryRatingId: "passVision" });
    state = purchaseAttributePoint(state, "ledger-buy-1", "threePoint");
    const changed = [state.ratings.passVision - 70, state.ratings.threePoint - 70].reduce((sum, value) => sum + value, 0);
    expect(changed).toBe(2);
    expect(state.ledger).toHaveLength(2);
    expect(state.ledger.every((entry) => entry.reason.length > 0 && entry.nextValue - entry.previousValue === entry.delta)).toBe(true);
  });

  it("replays the rating ledger exactly and survives a JSON round trip", () => {
    const initialRatings = ratingsAt(70);
    let state = createCareerProgression(initialRatings, { coins: 90 });
    state = applyTrainingSession(state, {
      sessionId: "replay-training",
      groupId: "PLAYMAKING",
      primaryRatingId: "basketballIQ",
    });
    state = purchaseAttributePoint(state, "replay-purchase", "threePoint");
    state = runWeeks(state, 8);

    const replayed = { ...initialRatings };
    for (const entry of state.ledger) replayed[entry.ratingId] += entry.delta;
    expect(replayed).toEqual(state.ratings);
    const restored: unknown = JSON.parse(JSON.stringify(state));
    assertCareerProgression(restored);
    expect(restored).toEqual(state);
  });

  it("rejects corrupted or duplicate save-state bookkeeping", () => {
    const valid = createCareerProgression(ratingsAt(70));
    expect(() => assertCareerProgression({ ...valid, coins: Number.POSITIVE_INFINITY })).toThrow(/coins/i);
    expect(() => assertCareerProgression({ ...valid, age: Number.NaN })).toThrow(/age/i);
    expect(() => assertCareerProgression({ ...valid, retired: true })).toThrow(/retired/i);
    expect(() => assertCareerProgression({ ...valid, processedRewardIds: ["game-1", "game-1"] })).toThrow(/duplicate/i);
    expect(() => assertCareerProgression({ ...valid, secondaryProgressUnits: { imaginaryRating: 50 } })).toThrow(/unknown rating/i);

    const trained = applyTrainingSession(valid, {
      sessionId: "tamper-ledger",
      groupId: "SHOOTING",
      primaryRatingId: "threePoint",
    });
    expect(() => assertCareerProgression({ ...trained, ratings: { ...trained.ratings, threePoint: 72 } })).toThrow(/ledger/i);
    expect(() => assertCareerProgression({ ...trained, ledger: [...trained.ledger, trained.ledger[0]] })).toThrow(/duplicate/i);
  });

  it("does not mutate caller-owned ratings or prior states", () => {
    const ratings = ratingsAt(70);
    const state = createCareerProgression(ratings, { coins: 90 });
    const snapshot = structuredClone(state);
    const trained = applyTrainingSession(state, {
      sessionId: "immutability-training",
      groupId: "SHOOTING",
      primaryRatingId: "threePoint",
    });
    expect(state).toEqual(snapshot);
    expect(ratings.threePoint).toBe(70);
    expect(trained.ratings.threePoint).toBe(71);
  });

  it("keeps a failed purchase atomic and never allows a negative balance", () => {
    const state = createCareerProgression(ratingsAt(70), { coins: 89 });
    expect(() => purchaseAttributePoint(state, "failed-buy-1", "threePoint")).toThrow(/not enough/i);
    expect(state.coins).toBe(89);
    expect(state.ratings.threePoint).toBe(70);
    expect(state.ledger).toHaveLength(0);
  });

  it("makes each purchase transaction idempotent", () => {
    const initial = createCareerProgression(ratingsAt(70), { coins: 180 });
    const purchased = purchaseAttributePoint(initial, "buy-1", "threePoint");
    const duplicate = purchaseAttributePoint(purchased, "buy-1", "threePoint");
    expect(duplicate).toBe(purchased);
    expect(duplicate.coins).toBe(90);
    expect(duplicate.ratings.threePoint).toBe(71);
    expect(duplicate.processedPurchaseIds).toEqual(["buy-1"]);
  });

  it("accepts each rating as a typed training target", () => {
    const allIds: RatingId[] = [...RATING_IDS];
    expect(allIds).toHaveLength(38);
  });
});
