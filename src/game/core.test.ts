import { describe, expect, it } from "vitest";
import { initialMatchState, playerById } from "./data";
import {
  applySwitchMatchups,
  calculateBlockChance,
  calculateFinishChance,
  calculateShotChance,
  calculateStealChance,
  resolveDrive,
  resolveDriveKickPass,
  resolvePass,
  resolvePickAndRoll,
  resolveShot,
} from "./core";
import {
  accumulateStealAttempt,
  classifyTap,
  DOUBLE_TAP_WINDOW_MS,
  isPendingTapStillValid,
  MAX_CONSECUTIVE_STEAL_ATTEMPTS,
} from "./input";
import { resolveGameAction, type GameActionId } from "./controller";
import { advanceMatchTime } from "./flow";
import type { DifficultyId, MatchState } from "./types";

function player(id: string) {
  const value = playerById.get(id);
  if (!value) throw new Error(`Missing fixture ${id}`);
  return value;
}

function findOutcome(action: GameActionId, eventKind: string, doubleTap = false) {
  for (let seed = 1; seed <= 20_000; seed += 1) {
    let result = resolveGameAction({ ...initialMatchState, seed }, action, doubleTap);
    if (eventKind === "MADE_BASKET" && result.pendingShot?.made !== true) continue;
    if (eventKind === "OFFENSIVE_REBOUND" && result.pendingShot?.plannedRebound?.offensive !== true) continue;
    for (let frame = 0; frame < 80; frame += 1) {
      if (result.eventLog.some((event) => event.kind === eventKind)) return result;
      result = advanceMatchTime(result, 50);
    }
  }
  throw new Error(`No deterministic fixture found for ${eventKind}`);
}

describe("fixed-seed pick-and-roll", () => {
  it("returns the same resolution for the same state and seed", () => {
    const first = resolvePickAndRoll(initialMatchState);
    const second = resolvePickAndRoll(initialMatchState);
    expect(second).toEqual(first);
  });

  it("opens the tutorial slice with a same-position center matchup and reproducible coverage", () => {
    const result = resolvePickAndRoll(initialMatchState).value;
    expect(result.screenerId).toBe("h5");
    expect(player(result.handlerDefenderBefore).position).toBe("PG");
    expect(player(result.screenerDefenderBefore).position).toBe("C");
    expect(["BLITZ", "SWITCH", "DROP_OVER", "DROP_UNDER", "HEDGE_RECOVER"]).toContain(result.coverage);
    expect(resolvePickAndRoll(initialMatchState).value).toEqual(result);
  });

  it("uses the controlled player as screener when the user is off ball", () => {
    const offBall = {
      ...initialMatchState,
      controlledPlayerId: "h1",
      ballHandlerId: "h3",
    };
    const result = resolvePickAndRoll(offBall).value;
    expect(result.handlerId).toBe("h3");
    expect(result.screenerId).toBe("h1");
    expect(result.decisionOwnerId).toBe("h3");
  });

  it("atomically swaps both assignments when coverage switches", () => {
    const base = resolvePickAndRoll(initialMatchState).value;
    const forcedSwitch = {
      ...base,
      coverage: "SWITCH" as const,
      result: "MISMATCH_CREATED" as const,
      handlerDefenderAfter: base.screenerDefenderBefore,
      screenerDefenderAfter: base.handlerDefenderBefore,
    };
    const updated = applySwitchMatchups(initialMatchState, forcedSwitch);
    expect(updated[forcedSwitch.handlerId]).toBe(forcedSwitch.screenerDefenderBefore);
    expect(updated[forcedSwitch.screenerId]).toBe(forcedSwitch.handlerDefenderBefore);
    expect(new Set(Object.values(updated)).size).toBe(Object.values(updated).length);
  });
});

describe("natural foul cadence on player shots", () => {
  it("keeps the same three-point attempt live but suppresses a whistle inside the fifty-possession window", () => {
    let seedWithContact: number | undefined;
    for (let seed = 1; seed <= 10_000; seed += 1) {
      const candidate = resolveGameAction({
        ...initialMatchState,
        seed,
        offensivePossessionSerial: 20,
        naturalFoulPossessions: [],
        naturalThreePointFoulPossessions: [],
      }, "shoot", false);
      if (candidate.pendingShot?.points === 3 && candidate.pendingShot.shootingFoul) {
        seedWithContact = seed;
        break;
      }
    }
    expect(seedWithContact).toBeDefined();
    const open = resolveGameAction({
      ...initialMatchState,
      seed: seedWithContact!,
      offensivePossessionSerial: 20,
      naturalFoulPossessions: [],
      naturalThreePointFoulPossessions: [],
    }, "shoot", false);
    const protectedWindow = resolveGameAction({
      ...initialMatchState,
      seed: seedWithContact!,
      offensivePossessionSerial: 20,
      naturalFoulPossessions: [1],
      naturalThreePointFoulPossessions: [1],
    }, "shoot", false);
    expect(open.phase).toBe("SHOT_FLIGHT");
    expect(open.pendingShot).toMatchObject({ points: 3, shootingFoul: true, foulSource: "NATURAL" });
    expect(protectedWindow.phase).toBe("SHOT_FLIGHT");
    expect(protectedWindow.pendingShot).toMatchObject({ points: 3, shootingFoul: false, foulSource: "NATURAL" });
    let adjudicated = open;
    for (let frame = 0; frame < 40 && adjudicated.naturalFoulPossessions.length === 0; frame += 1) {
      adjudicated = advanceMatchTime(adjudicated, 50);
    }
    expect(adjudicated.naturalFoulPossessions).toEqual([20]);
    expect(adjudicated.freeThrowSequence).toMatchObject({ total: open.pendingShot?.made ? 1 : 3, reason: "SHOOTING_FOUL" });
  });

  it("turns a cadence-blocked steal-gamble foul candidate into an explained miss", () => {
    const defense = {
      ...initialMatchState,
      possession: "away" as const,
      ballHandlerId: "a7",
      motion: {
        ...initialMatchState.motion,
        positions: {
          ...initialMatchState.motion.positions,
          h1: { x: 58, y: 22 },
        },
      },
    };
    let seedWithWhistle: number | undefined;
    for (let seed = 1; seed <= 20_000; seed += 1) {
      const candidate = resolveGameAction({ ...defense, seed }, "steal", false);
      if (candidate.lastOfficialCall?.kind === "COMMON_FOUL") {
        seedWithWhistle = seed;
        break;
      }
    }
    expect(seedWithWhistle).toBeDefined();
    const protectedWindow = resolveGameAction({
      ...defense,
      seed: seedWithWhistle!,
      offensivePossessionSerial: 5,
      naturalFoulPossessions: [1],
    }, "steal", false);
    expect(protectedWindow.lastOfficialCall).toBeUndefined();
    expect(protectedWindow.eventLog.at(-1)?.kind).toBe("STEAL_MISS");
    expect(protectedWindow.possession).toBe("away");
  });
});

describe("consecutive steal pressure", () => {
  it("counts only the same defender in the same possession and flags the fifth attempt", () => {
    let current;
    for (let count = 1; count <= 5; count += 1) {
      const result = accumulateStealAttempt(current, "h1", 8);
      current = result.value;
      expect(current.count).toBe(count);
      expect(result.commitsFoul).toBe(count > MAX_CONSECUTIVE_STEAL_ATTEMPTS);
    }
    expect(accumulateStealAttempt(current, "h2", 8).value.count).toBe(1);
    expect(accumulateStealAttempt(current, "h1", 9).value.count).toBe(1);
  });

  it("turns the fifth repeated steal click into a personal foul and the fifth team foul into Bonus throws", () => {
    let state: MatchState = {
      ...initialMatchState,
      seed: 19_026,
      possession: "away" as const,
      ballHandlerId: "a7",
      teamFouls: { home: 4, away: 0 },
      naturalFoulPossessions: [1],
      offensivePossessionSerial: 5,
      opponentOffense: {
        id: "locked-read",
        playId: "OPEN_41" as const,
        stageIndex: 0,
        stage: "SETUP" as const,
        side: "UPPER" as const,
        variant: 0 as const,
        decisionToken: "locked-read-0",
        decisionCount: 0,
        startedAtShotClock: 24,
        visibleIntent: "SETUP" as const,
        qualityModifier: 0,
      },
      pendingDefenseResponse: { decisionToken: "locked-read-0", action: "CONTAIN" as const },
      motion: {
        ...initialMatchState.motion,
        positions: {
          ...initialMatchState.motion.positions,
          h1: { x: 58, y: 22 },
        },
      },
    };
    for (let attempt = 1; attempt <= 5; attempt += 1) state = resolveGameAction(state, "steal");

    expect(state.phase).toBe("FREE_THROW");
    expect(state.lastOfficialCall).toMatchObject({ kind: "COMMON_FOUL", offenderId: "h1" });
    expect(state.lastOfficialCall?.text).toContain("连续第5次上抢");
    expect(state.teamFouls.home).toBe(5);
    expect(state.playerBoxScores.byPlayerId.h1.personalFouls).toBe(1);
    expect(state.freeThrowSequence).toMatchObject({ total: 2, reason: "BONUS", shooterId: "a7" });
    expect(state.naturalFoulPossessions).toEqual([1]);
    expect(state.stealAttemptAccumulator).toBeUndefined();
  });

  it("breaks the steal-click streak when another defensive decision is selected", () => {
    const defense = {
      ...initialMatchState,
      possession: "away" as const,
      ballHandlerId: "a7",
      stealAttemptAccumulator: { defenderId: "h1", possessionSerial: 1, count: 3 },
    };
    const contained = resolveGameAction(defense, "contain");
    expect(contained.stealAttemptAccumulator).toBeUndefined();
  });
});

describe("defensive reductions", () => {
  it("never improves a three-point chance when perimeter defense rises", () => {
    const shooter = player("h1");
    const low = { ...player("a11"), ratings: { ...player("a11").ratings, perimeterDefense: 45, lateralQuickness: 45 } };
    const high = { ...player("a11"), ratings: { ...player("a11").ratings, perimeterDefense: 90, lateralQuickness: 88 } };
    expect(calculateShotChance(shooter, high, 0.6, true)).toBeLessThan(calculateShotChance(shooter, low, 0.6, true));
  });

  it("never improves a finish chance when interior defense and block rise", () => {
    const attacker = player("h1");
    const primary = player("a9");
    const low = { ...player("a23"), ratings: { ...player("a23").ratings, interiorDefense: 45, block: 40, helpDefenseIQ: 55 } };
    const high = { ...player("a23"), ratings: { ...player("a23").ratings, interiorDefense: 94, block: 93, helpDefenseIQ: 90 } };
    expect(calculateFinishChance(attacker, primary, high, 0.62)).toBeLessThan(
      calculateFinishChance(attacker, primary, low, 0.62),
    );
  });

  it("raises steal chance with stronger hands and steal ability against the same handler", () => {
    const handler = player("a7");
    const low = { ...player("h1"), ratings: { ...player("h1").ratings, steal: 45, hands: 50, basketballIQ: 55 } };
    const high = { ...player("h1"), ratings: { ...player("h1").ratings, steal: 92, hands: 88, basketballIQ: 88 } };
    expect(calculateStealChance(high, handler)).toBeGreaterThan(calculateStealChance(low, handler));
  });

  it("raises block chance with stronger block, vertical and help awareness", () => {
    const shooter = player("a7");
    const low = { ...player("h1"), ratings: { ...player("h1").ratings, block: 35, vertical: 45, helpDefenseIQ: 50 } };
    const high = { ...player("h1"), ratings: { ...player("h1").ratings, block: 92, vertical: 90, helpDefenseIQ: 88 } };
    expect(calculateBlockChance(high, shooter)).toBeGreaterThan(calculateBlockChance(low, shooter));
  });
});

describe("created-player difficulty contribution", () => {
  const difficulties: DifficultyId[] = ["ROOKIE", "PRO", "STARTER", "ALL_STAR", "HALL_OF_FAME"];

  function expectStrictlyDescending(values: number[]) {
    expect(values).toHaveLength(difficulties.length);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index - 1]).toBeGreaterThan(values[index]);
    }
  }

  function atDifficulty(difficulty: DifficultyId): MatchState {
    return structuredClone({
      ...initialMatchState,
      seed: 0x26_20_26,
      difficulty,
      controlledPlayerId: initialMatchState.createdPlayerId,
      ballHandlerId: initialMatchState.createdPlayerId,
    });
  }

  it("applies 120/90/80/75/70 percent only to positive created-player shot and finish rating terms", () => {
    expectStrictlyDescending(difficulties.map((difficulty) => resolveShot(atDifficulty(difficulty)).probability));
    expectStrictlyDescending(difficulties.map((difficulty) => resolveDrive(atDifficulty(difficulty)).probability));

    const shooter = player("h1");
    const defender = player("a9");
    const weakShooter = {
      ...shooter,
      ratings: {
        ...shooter.ratings,
        threePoint: 60,
        catchShoot: 60,
        shotConsistency: 60,
        basketballIQ: 60,
      },
    };
    const weakProbabilities = difficulties.map((difficulty) =>
      calculateShotChance(weakShooter, defender, 0.5, true, "CATCH", difficulty),
    );
    expect(new Set(weakProbabilities)).toHaveLength(1);
  });

  it("applies the same strict ordering to normal passes and live drive-and-kick passes", () => {
    const passes = difficulties.map((difficulty) => resolvePass(atDifficulty(difficulty)));
    expectStrictlyDescending(passes.map((result) => result.selectionQuality));
    expectStrictlyDescending(passes.map((result) => result.completion));

    const kickOuts = difficulties.map((difficulty) => resolveDriveKickPass(atDifficulty(difficulty)));
    expect(kickOuts.every(Boolean)).toBe(true);
    expectStrictlyDescending(kickOuts.map((result) => result!.completion));
  });

  it("leaves teammate and non-controlled actions unchanged when the difficulty changes", () => {
    const teammateStates = difficulties.map((difficulty) => ({
      ...atDifficulty(difficulty),
      ballHandlerId: "h2",
    }));
    expect(new Set(teammateStates.map((state) => resolveShot(state).probability))).toHaveLength(1);
    expect(new Set(teammateStates.map((state) => resolveDrive(state).probability))).toHaveLength(1);
    expect(new Set(teammateStates.map((state) => resolvePass(state).selectionQuality))).toHaveLength(1);
    expect(new Set(teammateStates.map((state) => resolvePass(state).completion))).toHaveLength(1);

    const nonControlledCreatedStates = difficulties.map((difficulty) => ({
      ...atDifficulty(difficulty),
      controlledPlayerId: "h2",
    }));
    expect(new Set(nonControlledCreatedStates.map((state) => resolveShot(state).probability))).toHaveLength(1);
    expect(new Set(nonControlledCreatedStates.map((state) => resolveDrive(state).probability))).toHaveLength(1);
    expect(new Set(nonControlledCreatedStates.map((state) => resolvePass(state).selectionQuality))).toHaveLength(1);
  });
});

describe("tap intent arbitration", () => {
  it("upgrades two matching taps inside the window to one double action", () => {
    const first = classifyTap(null, "pass", 1_000, 3);
    expect(first.kind).toBe("PENDING_SINGLE");
    const second = classifyTap(first.pending, "pass", 1_000 + DOUBLE_TAP_WINDOW_MS, 3);
    expect(second.kind).toBe("DOUBLE");
  });

  it("does not combine taps from different decision epochs", () => {
    const first = classifyTap(null, "shoot", 1_000, 3);
    const second = classifyTap(first.pending, "shoot", 1_120, 4);
    expect(second.kind).toBe("REPLACE_PENDING");
    expect(isPendingTapStillValid(first.pending!, 4)).toBe(false);
  });

  it("does not combine different actions", () => {
    const first = classifyTap(null, "pass", 1_000, 3);
    const second = classifyTap(first.pending, "shoot", 1_080, 3);
    expect(second.kind).toBe("REPLACE_PENDING");
  });
});

describe("game action controller", () => {
  it("creates one screen state and does not mutate the input", () => {
    const before = structuredClone(initialMatchState);
    const after = resolveGameAction(before, "screen");
    expect(before).toEqual(initialMatchState);
    expect(after.version).toBe(before.version + 1);
    expect(after.screen).toBeDefined();
    expect(after.phase).toBe("SCREEN_APPROACH");
    expect(after.transitionClock).toBe(1.35);
    expect(after.eventLog.at(-1)?.kind).toBe("SCREEN");
  });

  it("uses the off-ball screen meaning after the player passes", () => {
    const passed = resolveGameAction(initialMatchState, "pass");
    expect(passed.ballHandlerId).toBe(passed.controlledPlayerId);
    expect(passed.pendingPass?.toPlayerId).not.toBe(passed.controlledPlayerId);
    expect(passed.motion.ballFlight).toBeDefined();
    const arrived = advanceMatchTime(passed, (passed.motion.ballFlight!.duration + 0.05) * 1_000);
    expect(arrived.ballHandlerId).not.toBe(arrived.controlledPlayerId);
    expect(arrived.pendingPass).toBeUndefined();
    const screened = resolveGameAction(arrived, "screen");
    expect(screened.screen?.screenerId).toBe(screened.controlledPlayerId);
    expect(screened.screen?.decisionOwnerId).toBe(arrived.ballHandlerId);
    expect(screened.eventLog.at(-1)?.kind).toBe("OFF_BALL_SCREEN");
  });

  it("does not silently downgrade an unavailable lob to a normal pass", () => {
    const after = resolveGameAction(initialMatchState, "pass", true);
    expect(after.ballHandlerId).toBe(initialMatchState.ballHandlerId);
    expect(after.eventLog.at(-1)?.kind).toBe("LOB_UNAVAILABLE");
  });

  it("resets only the shot clock to 14 after an offensive rebound", () => {
    const after = findOutcome("shoot", "OFFENSIVE_REBOUND");
    expect(after.possession).toBe("home");
    expect(after.shotClock).toBe(14);
    expect(after.ballHandlerId).toBe(after.lastRebound?.winnerId);
    expect(after.playerStats.rebounds).toBe(after.lastRebound?.winnerId === after.controlledPlayerId ? 1 : 0);
    expect(after.advantage).toBe("SECOND_CHANCE");
  });

  it("sends a live-ball turnover directly into the opponent fastbreak", () => {
    const after = findOutcome("pass", "TURNOVER");
    expect(after.possession).toBe("away");
    expect(after.phase).toBe("FASTBREAK");
    expect(after.shotClock).toBe(24);
    expect(after.playerStats.turnovers).toBe(1);
    expect(Object.values(after.motion.routes).every((route) => route.length === 0)).toBe(true);
  });

  it("advances from a made basket through inbound without scoring twice", () => {
    const made = findOutcome("shoot", "MADE_BASKET");
    expect(made.phase).toBe("DEAD_BALL");
    expect(Object.values(made.motion.routes).every((route) => route.length === 0)).toBe(true);
    // The full whistle/hand-off/inbound/advance animation may now include the
    // longer referee ceremony, so allow five real seconds before asserting the
    // settled half-court state.
    const advanced = advanceMatchTime(made, 5_000);
    expect(advanced.homeScore).toBe(made.homeScore);
    expect(advanced.awayScore).toBe(made.awayScore);
    expect(advanced.phase).toBe("SET_OFFENSE");
    expect(advanced.shotClock).toBeLessThan(24);
    expect(advanced.eventLog.some((event) => event.kind === "FRONTCOURT")).toBe(true);
  });
});
