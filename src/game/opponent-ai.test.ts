import { describe, expect, it } from "vitest";
import { resolveGameAction } from "./controller";
import { initialMatchState } from "./data";
import { advanceMatchTime, assertMatchInvariants } from "./flow";
import {
  calculateOpponentAttemptChance,
  chooseOpponentPlay,
  startOpponentOffense,
} from "./opponent-ai";
import { opponentTactics } from "./opponent-tactics";
import { courtVisualDistance, TACTIC_TARGET_SPACING_VISUAL } from "./movement";
import type {
  DifficultyId,
  MatchState,
  OpponentPlayId,
  PendingOpponentAttempt,
  Position,
} from "./types";

const positions: Position[] = ["PG", "SG", "SF", "PF", "C"];
const expectedPlayIds: OpponentPlayId[] = [
  "OPEN_41",
  "PRIN_CHIN",
  "BLOCKER_MOVER",
  "HORNS_STS",
  "FLEX_CONT",
  "HIGH_LOW",
  "DRIBBLE_DRIVE",
  "ZONE_OVERLOAD",
  "EARLY_DHO",
];

export function awayFixture(patch: Partial<MatchState> = {}): MatchState {
  return structuredClone({
    ...initialMatchState,
    possession: "away" as const,
    ballHandlerId: "a7",
    phase: "SET_OFFENSE" as const,
    restart: undefined,
    opponentOffense: undefined,
    pendingDefenseResponse: undefined,
    aiDecisionClock: null,
    opponentPlayHistory: [],
    ...patch,
  });
}

export function sampleSeed(index: number) {
  return Math.imul(index + 1, 0x9e37_79b1) >>> 0;
}

function withDirectMatchup(state: MatchState, defenderId: string, shooterId: string): MatchState {
  const currentMatchups = { ...state.currentMatchups };
  const previousDefender = Object.entries(currentMatchups).find(([, opponentId]) => opponentId === shooterId)?.[0];
  if (!previousDefender) throw new Error(`No current matchup for ${shooterId}`);
  if (previousDefender !== defenderId) {
    const previousTarget = currentMatchups[defenderId];
    currentMatchups[previousDefender] = previousTarget;
    currentMatchups[defenderId] = shooterId;
  }
  return { ...state, controlledPlayerId: defenderId, currentMatchups };
}

function attempt(
  shooterId: string,
  shotType: PendingOpponentAttempt["shotType"] = "THREE",
): PendingOpponentAttempt {
  return {
    shooterId,
    shotType,
    points: shotType === "THREE" || shotType === "KICK_THREE" ? 3 : 2,
    label: "固定验收出手",
    quality: 0.62,
  };
}

function readyThreePointAttempt(seed: number, history: Partial<MatchState> = {}) {
  const base = awayFixture({
    seed,
    offensivePossessionSerial: 20,
    naturalFoulPossessions: [],
    naturalThreePointFoulPossessions: [],
    ...history,
  });
  const started = startOpponentOffense(base);
  const offense = started.patch.opponentOffense;
  if (!offense) throw new Error("Expected opponent offense fixture");
  return {
    ...base,
    ...started.patch,
    ballHandlerId: "a7",
    aiDecisionClock: 0.01,
    opponentOffense: {
      ...offense,
      stage: "SHOT_PREP" as const,
      visibleIntent: "SHOOT" as const,
      pendingAttempt: attempt("a7", "THREE"),
    },
  };
}

describe("opponent tactic catalog", () => {
  it("defines all nine play families with complete semantic contracts", () => {
    expect(opponentTactics).toHaveLength(9);
    expect(new Set(opponentTactics.map((tactic) => tactic.id))).toEqual(new Set(expectedPlayIds));

    for (const tactic of opponentTactics) {
      expect(tactic.name.trim()).not.toBe("");
      expect(tactic.alignment.trim()).not.toBe("");
      expect(tactic.trigger.trim()).not.toBe("");
      expect(tactic.reads).toHaveLength(2);
      expect(tactic.reads.every((read) => read.trim().length > 0)).toBe(true);
      expect(tactic.fallback.trim()).not.toBe("");
      expect(tactic.counterTags.length).toBeGreaterThan(0);
      expect(tactic.phaseTags.length).toBeGreaterThan(0);
      expect(tactic.stages.length).toBeGreaterThanOrEqual(4);
      expect(tactic.stages[0].key).toBe("SETUP");
      expect(tactic.stages.at(-1)?.options?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("keeps every target and intermediate route point finite and on the court", () => {
    for (const tactic of opponentTactics) {
      for (const stage of tactic.stages) {
        expect(Number.isFinite(stage.duration)).toBe(true);
        expect(stage.duration).toBeGreaterThan(0);
        expect(new Set(Object.keys(stage.targets))).toEqual(new Set(positions));

        const points = [
          ...positions.map((position) => stage.targets[position]),
          ...Object.values(stage.via ?? {}).flatMap((route) => route ?? []),
        ];
        for (const point of points) {
          expect(Number.isFinite(point.x)).toBe(true);
          expect(Number.isFinite(point.y)).toBe(true);
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(100);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it("keeps non-contact tactic targets separated while declaring deliberate screen contact", () => {
    let declaredContacts = 0;
    for (const tactic of opponentTactics) {
      for (const stage of tactic.stages) {
        for (let first = 0; first < positions.length; first += 1) {
          for (let second = first + 1; second < positions.length; second += 1) {
            const firstPosition = positions[first];
            const secondPosition = positions[second];
            const deliberateContact = stage.contactPairs?.some(([left, right]) => (
              (left === firstPosition && right === secondPosition)
              || (left === secondPosition && right === firstPosition)
            ));
            if (deliberateContact) {
              declaredContacts += 1;
              continue;
            }
            expect(
              courtVisualDistance(stage.targets[firstPosition], stage.targets[secondPosition]),
              `${tactic.id}/${stage.key}/${firstPosition}-${secondPosition}`,
            ).toBeGreaterThanOrEqual(TACTIC_TARGET_SPACING_VISUAL);
          }
        }
      }
    }
    expect(declaredContacts).toBeGreaterThan(0);
  });
});

describe("opponent play policy", () => {
  it("returns the same selection for the same state and seed", () => {
    const state = awayFixture({ seed: 0x51a7_2026, opponentPlayHistory: ["OPEN_41", "PRIN_CHIN"] });
    expect(chooseOpponentPlay(state)).toEqual(chooseOpponentPlay(structuredClone(state)));
  });

  it("selects at least six different half-court plays across fixed seeds", () => {
    const selected = new Set<OpponentPlayId>();
    for (let index = 0; index < 1_024; index += 1) {
      selected.add(chooseOpponentPlay(awayFixture({ seed: sampleSeed(index), defenseScheme: "MAN" })).playId);
    }

    expect(selected.has("EARLY_DHO")).toBe(false);
    expect(selected.size).toBeGreaterThanOrEqual(6);
  });

  it("significantly favors the zone-overload counter against a zone", () => {
    let manSelections = 0;
    let zoneSelections = 0;
    const sampleSize = 1_024;
    for (let index = 0; index < sampleSize; index += 1) {
      const seed = sampleSeed(index);
      if (chooseOpponentPlay(awayFixture({ seed, defenseScheme: "MAN" })).playId === "ZONE_OVERLOAD") manSelections += 1;
      if (chooseOpponentPlay(awayFixture({ seed, defenseScheme: "ZONE_2_3" })).playId === "ZONE_OVERLOAD") zoneSelections += 1;
    }

    const manShare = manSelections / sampleSize;
    const zoneShare = zoneSelections / sampleSize;
    expect(zoneShare).toBeGreaterThan(0.4);
    expect(zoneShare - manShare).toBeGreaterThan(0.25);
  });

  it("never repeats an adjacent half-court play or complete guide signature across 500 starts", () => {
    let state = awayFixture({ seed: 0x6d2b_79f5, defenseScheme: "MAN" });
    let previousPlayId: OpponentPlayId | undefined;
    let previousGuideKey: string | undefined;

    for (let possession = 0; possession < 500; possession += 1) {
      state = {
        ...state,
        phase: "SET_OFFENSE",
        defenseScheme: possession % 7 === 0 ? "ZONE_2_3" : "MAN",
      };
      const started = startOpponentOffense(state);
      const playId = started.patch.opponentPlayHistory?.at(-1);
      const guideKey = started.patch.lastOpponentGuideKey;

      expect(playId, `missing play at possession ${possession}`).toBeDefined();
      expect(guideKey, `missing guide at possession ${possession}`).toBeDefined();
      if (previousPlayId) {
        expect(playId, `repeated play at possession ${possession}`).not.toBe(previousPlayId);
      }
      if (previousGuideKey) {
        expect(guideKey, `repeated guide at possession ${possession}`).not.toBe(previousGuideKey);
      }

      previousPlayId = playId;
      previousGuideKey = guideKey;
      state = { ...state, ...started.patch };
    }
  });
});

describe("opponent attempt probabilities", () => {
  it("uses the same fifty-possession natural three-point foul protection for the computer offense", () => {
    let seedWithContact: number | undefined;
    for (let seed = 1; seed <= 10_000; seed += 1) {
      const candidate = advanceMatchTime(readyThreePointAttempt(seed), 50);
      if (candidate.pendingShot?.shootingFoul) {
        seedWithContact = seed;
        break;
      }
    }
    expect(seedWithContact).toBeDefined();
    const open = advanceMatchTime(readyThreePointAttempt(seedWithContact!), 50);
    const protectedWindow = advanceMatchTime(readyThreePointAttempt(seedWithContact!, {
      naturalFoulPossessions: [1],
      naturalThreePointFoulPossessions: [1],
    }), 50);
    expect(open.pendingShot).toMatchObject({ attackingTeam: "away", points: 3, shootingFoul: true, foulSource: "NATURAL" });
    expect(protectedWindow.pendingShot).toMatchObject({ attackingTeam: "away", points: 3, shootingFoul: false, foulSource: "NATURAL" });
  });

  it("increases when the corresponding shooting attribute is higher", () => {
    const base = awayFixture({ difficulty: "STARTER" });
    const lowerRatedShooter = withDirectMatchup(base, "h1", "a7");
    const higherRatedShooter = withDirectMatchup(base, "h1", "a9");

    const lowerChance = calculateOpponentAttemptChance(lowerRatedShooter, attempt("a7"));
    const higherChance = calculateOpponentAttemptChance(higherRatedShooter, attempt("a9"));
    expect(higherChance).toBeGreaterThan(lowerChance);
  });

  it("decreases when the direct perimeter defender is stronger", () => {
    const base = awayFixture({ difficulty: "PRO" });
    const weakDefense = withDirectMatchup(base, "h4", "a7");
    const strongDefense = withDirectMatchup(base, "h3", "a7");

    expect(calculateOpponentAttemptChance(strongDefense, attempt("a7"))).toBeLessThan(
      calculateOpponentAttemptChance(weakDefense, attempt("a7")),
    );
  });

  it("orders the five difficulties monotonically for the controlled direct defender", () => {
    const difficulties: DifficultyId[] = ["ROOKIE", "PRO", "STARTER", "ALL_STAR", "HALL_OF_FAME"];
    const probabilities = difficulties.map((difficulty) =>
      calculateOpponentAttemptChance(
        withDirectMatchup(awayFixture({ difficulty }), "h1", "a9"),
        attempt("a9"),
      ),
    );

    for (let index = 1; index < probabilities.length; index += 1) {
      expect(probabilities[index]).toBeGreaterThanOrEqual(probabilities[index - 1]);
    }
    expect(probabilities.at(-1)).toBeGreaterThan(probabilities[0]);
  });

  it("makes an on-time contest reduce the pending attempt chance", () => {
    const state = awayFixture({ seed: 0x7a11_2026, difficulty: "STARTER" });
    const started = startOpponentOffense(state);
    const active = { ...state, ...started.patch } as MatchState;
    const pendingAttempt = attempt("a9");
    const uncontested = calculateOpponentAttemptChance(active, pendingAttempt);
    const contestedState = resolveGameAction(active, "contest");

    expect(contestedState.pendingDefenseResponse?.action).toBe("CONTEST");
    expect(calculateOpponentAttemptChance(contestedState, pendingAttempt)).toBeLessThan(uncontested);
  });

  it.each(["contain", "contest"] as const)("gives an early %s response a real carried effect", (action) => {
    const state = awayFixture({ seed: 0x6a11_2026, difficulty: "STARTER" });
    const started = startOpponentOffense(state);
    const active = { ...state, ...started.patch } as MatchState;
    expect(active.opponentOffense?.visibleIntent).toBe("SETUP");
    const responded = resolveGameAction(active, action);
    expect(responded.pendingDefenseResponse).toBeDefined();
    let advanced = responded;
    for (let step = 0; step < 100 && advanced.opponentOffense?.decisionToken === active.opponentOffense?.decisionToken; step += 1) {
      advanced = advanceMatchTime(advanced, 50);
      expect(advanced.eventLog.some((event) => event.kind === "OVER_AND_BACK_VIOLATION")).toBe(false);
    }
    expect(advanced.opponentOffense?.decisionToken).not.toBe(active.opponentOffense?.decisionToken);
    expect(advanced.opponentOffense?.qualityModifier).toBeLessThan(0);
  });
});

describe("automatic opponent possession", () => {
  it("never repeats an identical opponent guide signature on consecutive starts", () => {
    const base = awayFixture({ seed: 0x20_260_901 });
    const first = startOpponentOffense(base);
    const firstState = { ...base, ...first.patch } as MatchState;
    const repeatedSeedState = {
      ...base,
      lastOpponentGuideKey: firstState.lastOpponentGuideKey,
    };
    const second = startOpponentOffense(repeatedSeedState);
    expect(second.patch.lastOpponentGuideKey).not.toBe(firstState.lastOpponentGuideKey);
  });

  it("finishes an away possession without requiring player input", () => {
    let state = awayFixture({ seed: 0x20_260_901, gameSeconds: 60, shotClock: 24 });
    let elapsedMs = 0;

    while (state.possession === "away" && elapsedMs < 40_000) {
      state = advanceMatchTime(state, 50);
      assertMatchInvariants(state);
      elapsedMs += 50;
    }

    expect(state.possession).toBe("home");
    expect(elapsedMs).toBeLessThanOrEqual(40_000);
    expect(state.opponentOffense).toBeUndefined();
    expect(state.aiDecisionClock).toBeNull();
    expect(state.opponentStats.attempts + state.opponentStats.turnovers).toBeGreaterThan(0);
  });

  it("is deterministic and preserves semantics across coarse and 50ms time partitions", () => {
    const start = awayFixture({ seed: 0x31_415_926, gameSeconds: 60, shotClock: 24 });
    const coarse = advanceMatchTime(structuredClone(start), 8_000);
    const repeated = advanceMatchTime(structuredClone(start), 8_000);
    let fine = structuredClone(start);
    for (let index = 0; index < 160; index += 1) fine = advanceMatchTime(fine, 50);

    expect(repeated).toEqual(coarse);
    expect({
      seed: fine.seed,
      phase: fine.phase,
      possession: fine.possession,
      ballHandlerId: fine.ballHandlerId,
      homeScore: fine.homeScore,
      awayScore: fine.awayScore,
      gameSeconds: fine.gameSeconds,
      shotClock: fine.shotClock,
      playerStats: fine.playerStats,
      opponentStats: fine.opponentStats,
      eventLog: fine.eventLog,
      opponentOffense: fine.opponentOffense,
      aiDecisionClock: fine.aiDecisionClock,
    }).toEqual({
      seed: coarse.seed,
      phase: coarse.phase,
      possession: coarse.possession,
      ballHandlerId: coarse.ballHandlerId,
      homeScore: coarse.homeScore,
      awayScore: coarse.awayScore,
      gameSeconds: coarse.gameSeconds,
      shotClock: coarse.shotClock,
      playerStats: coarse.playerStats,
      opponentStats: coarse.opponentStats,
      eventLog: coarse.eventLog,
      opponentOffense: coarse.opponentOffense,
      aiDecisionClock: coarse.aiDecisionClock,
    });
    for (const [playerId, point] of Object.entries(coarse.motion.positions)) {
      expect(fine.motion.positions[playerId].x).toBeCloseTo(point.x, 5);
      expect(fine.motion.positions[playerId].y).toBeCloseTo(point.y, 5);
    }
  });

  it("completes 500 seeded natural opponent possessions without a deadlock", () => {
    let attempts = 0;
    let makes = 0;
    let turnovers = 0;
    let points = 0;
    for (let sample = 0; sample < 500; sample += 1) {
      let state = awayFixture({ seed: sampleSeed(sample), gameSeconds: 120, shotClock: 24 });
      let steps = 0;
      // A live offensive rebound can legitimately extend the same possession;
      // keep the watchdog generous enough for a second NCAA action to finish.
      while (state.possession === "away" && steps < 1_600) {
        state = advanceMatchTime(state, 50);
        assertMatchInvariants(state);
        steps += 1;
      }
      expect(state.possession, `seed ${sampleSeed(sample)} stalled`).toBe("home");
      expect(steps).toBeLessThan(1_600);
      expect(
        state.eventLog.some((event) => event.kind === "OVER_AND_BACK_VIOLATION"),
        `seed ${sampleSeed(sample)} scripted an avoidable backcourt catch`,
      ).toBe(false);
      attempts += state.opponentStats.attempts;
      makes += state.opponentStats.made;
      turnovers += state.opponentStats.turnovers;
      points += state.opponentStats.points;
    }
    expect(attempts).toBeGreaterThan(350);
    expect(makes / attempts).toBeGreaterThan(0.25);
    expect(makes / attempts).toBeLessThan(0.7);
    expect(turnovers / 500).toBeGreaterThan(0.02);
    expect(turnovers / 500).toBeLessThan(0.28);
    expect(points / 500).toBeGreaterThan(0.55);
    expect(points / 500).toBeLessThan(1.45);
  }, 30_000);
});
