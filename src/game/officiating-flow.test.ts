import { describe, expect, it } from "vitest";
import { initialMatchState, players } from "./data";
import {
  advanceMatchTime,
  assertMatchInvariants,
  beginFreeThrowSequence,
  callBasketInterference,
  callPersonalFoul,
  commitGameEvent,
  startResolvedShot,
} from "./flow";
import { freeThrowFormation, freeThrowLinePoint } from "./movement";
import { evaluateBasketInterference } from "./officiating";
import { applyPlayerStatsEvent, assertPlayerStatsLedger } from "./player-stats";
import type { MatchState } from "./types";

function fixture(patch: Partial<MatchState> = {}): MatchState {
  return structuredClone({ ...initialMatchState, ...patch });
}

function stepUntil(
  state: MatchState,
  predicate: (candidate: MatchState) => boolean,
  maximumMilliseconds = 10_000,
) {
  let current = state;
  for (let elapsed = 0; elapsed < maximumMilliseconds && !predicate(current); elapsed += 50) {
    current = advanceMatchTime(current, 50);
  }
  return current;
}

function finishFreeThrows(state: MatchState) {
  return stepUntil(state, (candidate) => candidate.freeThrowSequence === undefined);
}

function teamPlayerPoints(state: MatchState, team: "home" | "away") {
  return Object.values(state.playerBoxScores.byPlayerId)
    .filter((line) => line.team === team)
    .reduce((total, line) => total + line.points, 0);
}

describe("officiating closure: automatic free throws", () => {
  it("routes a missed three-point shooting foul from the shot flight into three automatic attempts", () => {
    const flight = startResolvedShot(fixture(), {
      attackingTeam: "home",
      shooterId: "h1",
      points: 3,
      made: false,
      shootingFoul: true,
      foulerId: "a9",
      shotType: "THREE",
      explanation: "三分线外接触",
      seed: 411,
    });
    const called = stepUntil(flight, (candidate) => candidate.freeThrowSequence !== undefined, 2_000);

    expect(called.freeThrowSequence).toMatchObject({ shooterId: "h1", total: 3, reason: "SHOOTING_FOUL" });
    expect(called.playerBoxScores.byPlayerId.h1).toMatchObject({ fieldGoalsMade: 0, fieldGoalsAttempted: 1 });
    expect(called.playerBoxScores.byPlayerId.a9.personalFouls).toBe(1);
    expect(called.pendingRebound).toBeUndefined();
  });

  it("counts the basket once before starting an and-one sequence", () => {
    const base = fixture();
    const flight = startResolvedShot(base, {
      attackingTeam: "home",
      shooterId: "h3",
      points: 2,
      made: true,
      shootingFoul: true,
      foulerId: "a11",
      shotType: "RIM",
      explanation: "对抗上篮",
      seed: 412,
    });
    const called = stepUntil(flight, (candidate) => candidate.freeThrowSequence !== undefined, 2_000);

    expect(called.homeScore).toBe(base.homeScore + 2);
    expect(called.freeThrowSequence).toMatchObject({ shooterId: "h3", total: 1 });
    expect(called.eventLog.some((event) => event.kind === "SHOT_MADE_AND_FOUL")).toBe(true);
    expect(called.playerBoxScores.byPlayerId.h3).toMatchObject({ fieldGoalsMade: 1, fieldGoalsAttempted: 1, points: 2 });
    expect(called.playerBoxScores.byPlayerId.a11.personalFouls).toBe(1);
  });

  it("produces the same automatic ceremony for one coarse advance and 50ms slices", () => {
    const start = callPersonalFoul(fixture(), {
      offenderId: "a7",
      offendedPlayerId: "h1",
      kind: "SHOOTING",
      shotMade: false,
      shotPoints: 2,
      seed: 1,
    });
    const coarse = advanceMatchTime(start, 4_000);
    let fine = start;
    for (let elapsed = 0; elapsed < 4_000; elapsed += 50) fine = advanceMatchTime(fine, 50);

    expect({
      phase: coarse.phase,
      score: [coarse.homeScore, coarse.awayScore],
      stats: coarse.playerBoxScores,
      freeThrows: coarse.freeThrowSequence,
      restart: coarse.restart,
      events: coarse.eventLog,
    }).toEqual({
      phase: fine.phase,
      score: [fine.homeScore, fine.awayScore],
      stats: fine.playerBoxScores,
      freeThrows: fine.freeThrowSequence,
      restart: fine.restart,
      events: fine.eventLog,
    });
  });

  it("finishes all horn-time foul shots before it decides the game", () => {
    const called = callPersonalFoul(fixture({ period: 4, gameSeconds: 0, shotClock: 0 }), {
      offenderId: "a9",
      offendedPlayerId: "h1",
      kind: "SHOOTING",
      shotMade: false,
      shotPoints: 3,
      seed: 1,
    });
    const completed = stepUntil(called, (candidate) => candidate.phase === "FINAL", 10_000);

    expect(completed.phase).toBe("FINAL");
    expect(completed.playerBoxScores.byPlayerId.h1.freeThrowsAttempted).toBe(3);
    expect(completed.homeScore).toBeGreaterThan(completed.awayScore);
    expect(completed.gameResult?.homeScore).toBe(completed.homeScore);
  });

  it.each([
    { label: "two-shot foul", points: 2 as const, expectedAttempts: 2 },
    { label: "three-shot foul", points: 3 as const, expectedAttempts: 3 },
  ])("runs the entire $label ceremony without player input", ({ points, expectedAttempts }) => {
    const called = callPersonalFoul(fixture(), {
      offenderId: "a7",
      offendedPlayerId: "h1",
      kind: "SHOOTING",
      shotMade: false,
      shotPoints: points,
      seed: 1,
    });

    expect(called.phase).toBe("FREE_THROW");
    expect(called.freeThrowSequence).toMatchObject({ total: expectedAttempts, attempted: 0, stage: "SETUP" });
    const completed = finishFreeThrows(called);

    expect(completed.freeThrowSequence).toBeUndefined();
    expect(completed.playerBoxScores.byPlayerId.h1.freeThrowsAttempted).toBe(expectedAttempts);
    expect(completed.eventLog.filter((event) => event.kind === "FREE_THROW_RELEASE")).toHaveLength(expectedAttempts);
    expect(completed.eventLog.filter((event) => event.kind === "FREE_THROW_MADE")).toHaveLength(expectedAttempts);
    expect(completed.playerBoxScores.byPlayerId.a7.personalFouls).toBe(1);
    expect(completed.teamFouls.away).toBe(1);
    expect(() => assertMatchInvariants(completed)).not.toThrow();
  });

  it("treats a made shooting foul as one and-one free throw and preserves score/stat conservation", () => {
    const playerBoxScores = applyPlayerStatsEvent(initialMatchState.playerBoxScores, {
      type: "SHOT_ATTEMPT",
      shooterId: "h1",
      made: true,
      points: 2,
    });
    const beforeCall = fixture({ homeScore: 62, playerBoxScores });
    const called = callPersonalFoul(beforeCall, {
      offenderId: "a7",
      offendedPlayerId: "h1",
      kind: "SHOOTING",
      shotMade: true,
      shotPoints: 2,
      seed: 1,
    });

    expect(called.freeThrowSequence?.total).toBe(1);
    const completed = finishFreeThrows(called);
    expect(completed.playerBoxScores.byPlayerId.h1).toMatchObject({
      fieldGoalsMade: 1,
      fieldGoalsAttempted: 1,
      freeThrowsMade: 1,
      freeThrowsAttempted: 1,
      points: 3,
    });
    expect(teamPlayerPoints(completed, "home")).toBe(completed.homeScore - completed.initialHomeScore);
    expect(teamPlayerPoints(completed, "away")).toBe(completed.awayScore - completed.initialAwayScore);
  });

  it("freezes game and shot clocks, then settles the shooter and all lane occupants before release", () => {
    const gameSeconds = 91.25;
    const shotClock = 8.4;
    const setup = beginFreeThrowSequence(fixture({ gameSeconds, shotClock }), {
      shooterId: "h3",
      total: 2,
      reason: "SHOOTING_FOUL",
      liveAfterFinalMiss: true,
      seed: 1,
    });
    const duringSetup = advanceMatchTime(setup, 600);

    expect(duringSetup.gameSeconds).toBe(gameSeconds);
    expect(duringSetup.shotClock).toBe(shotClock);
    expect(duringSetup.freeThrowSequence?.stage).toBe("SETUP");

    const released = stepUntil(duringSetup, (candidate) => candidate.freeThrowSequence?.stage === "FLIGHT");
    const assignments = freeThrowFormation("h3", true);
    expect(released.gameSeconds).toBe(gameSeconds);
    expect(released.shotClock).toBe(shotClock);
    expect(released.controlledPlayerId).toBe("h1");
    expect(released.ballHandlerId).toBe("h3");
    expect(released.motion.positions.h3).toEqual(freeThrowLinePoint("home"));
    Object.entries(assignments).forEach(([playerId, assignment]) => {
      expect(released.motion.positions[playerId]).toEqual(assignment.point);
      expect(released.motion.intents[playerId]).toBe("FREE_THROW");
    });
  });

  it("uses five legal lane occupants for a live final miss and clears the lane for a retained technical free throw", () => {
    const live = Object.values(freeThrowFormation("h1", true));
    expect(live.filter((assignment) => assignment.role === "SHOOTER")).toHaveLength(1);
    expect(live.filter((assignment) => assignment.role === "LANE_DEFENSE")).toHaveLength(3);
    expect(live.filter((assignment) => assignment.role === "LANE_OFFENSE")).toHaveLength(2);
    expect(live.filter((assignment) => assignment.role === "PERIMETER")).toHaveLength(4);

    const retained = Object.values(freeThrowFormation("h1", false));
    expect(retained.filter((assignment) => assignment.role === "SHOOTER")).toHaveLength(1);
    expect(retained.filter((assignment) => assignment.role === "PERIMETER")).toHaveLength(9);
    expect(retained.some((assignment) => assignment.role === "LANE_DEFENSE" || assignment.role === "LANE_OFFENSE")).toBe(false);
  });

  it("sends a rim-contacted final miss into the ordinary ten-player rebound contest", () => {
    const setup = beginFreeThrowSequence(fixture(), {
      shooterId: "h1",
      total: 1,
      reason: "SHOOTING_FOUL",
      liveAfterFinalMiss: true,
      seed: 14_336,
    });
    const afterMiss = finishFreeThrows(setup);

    expect(afterMiss.playerBoxScores.byPlayerId.h1).toMatchObject({ freeThrowsMade: 0, freeThrowsAttempted: 1 });
    expect(afterMiss.eventLog.some((event) => event.kind === "FREE_THROW_MISSED")).toBe(true);
    expect(afterMiss.phase).toBe("REBOUND");
    expect(afterMiss.pendingRebound?.resolution.rimContacted).toBe(true);
    expect(afterMiss.pendingRebound?.resolution.candidates).toHaveLength(10);
    expect(afterMiss.motion.ballFlight?.kind).toBe("RIM_REBOUND");
  });

  it("keeps the original offense and a frontcourt restart after a defensive-three-second technical free throw", () => {
    const setup = beginFreeThrowSequence(fixture({ shotClock: 7.2 }), {
      shooterId: "h1",
      total: 1,
      reason: "DEFENSIVE_THREE_SECONDS",
      retainPossession: true,
      liveAfterFinalMiss: false,
      resumeShotClock: 14,
      seed: 1,
    });
    const completed = finishFreeThrows(setup);

    expect(completed.phase).toBe("DEAD_BALL");
    expect(completed.possession).toBe("home");
    expect(completed.restart).toMatchObject({
      team: "home",
      spot: "SIDELINE_FRONTCOURT",
      retainsPossession: true,
      requiresAdvance: false,
      shotClock: 14,
    });
    expect(completed.teamFouls.away).toBe(0);
    expect(completed.playerBoxScores.byPlayerId.a7.personalFouls).toBe(0);
  });
});

describe("late-game intentional fouling", () => {
  it("lets the trailing AI defense foul on a deterministic delay and awards Bonus throws on team foul five", () => {
    const state = fixture({
      period: 4,
      gameSeconds: 30,
      homeScore: 68,
      awayScore: 64,
      teamFouls: { home: 0, away: 4 },
      naturalFoulPossessions: [1],
      offensivePossessionSerial: 5,
      possession: "home",
      phase: "SET_OFFENSE",
      ballHandlerId: "h1",
      frontcourtEstablished: true,
    });
    const called = advanceMatchTime(state, 1_500);

    expect(called.phase).toBe("FREE_THROW");
    expect(called.lastOfficialCall).toMatchObject({ kind: "COMMON_FOUL", offendingTeam: "away" });
    expect(called.lastOfficialCall?.text).toContain("末节主动犯规");
    expect(called.teamFouls.away).toBe(5);
    expect(called.freeThrowSequence).toMatchObject({ reason: "BONUS", total: 2, shooterId: "h1" });
    expect(called.naturalFoulPossessions).toEqual([1]);
    expect(called.intentionalFoulClock).toBeNull();
  });

  it.each([
    { label: "AI领先", homeScore: 64, awayScore: 68 },
    { label: "比分持平", homeScore: 68, awayScore: 68 },
    { label: "分差超过追分犯规范畴", homeScore: 77, awayScore: 68 },
  ])("does not let the AI commit an intentional foul when $label", ({ homeScore, awayScore }) => {
    const state = fixture({
      period: 4,
      gameSeconds: 30,
      homeScore,
      awayScore,
      possession: "home",
      phase: "SET_OFFENSE",
      ballHandlerId: "h1",
      frontcourtEstablished: true,
    });
    const after = advanceMatchTime(state, 1_500);

    expect(after.lastOfficialCall).toBeUndefined();
    expect(after.teamFouls.away).toBe(0);
    expect(after.freeThrowSequence).toBeUndefined();
    expect(after.intentionalFoulClock).toBeNull();
  });
});

describe("officiating closure: fouls and three seconds", () => {
  it("counts only a new offensive possession and keeps retained continuations in the same cadence slot", () => {
    const start = fixture();
    const retained = commitGameEvent(start, "RETAINED", "原队续权", { possession: "home" });
    const changed = commitGameEvent(retained, "CHANGE", "防守方获得球权", { possession: "away" });
    const sameAway = commitGameEvent(changed, "AWAY_RETAINED", "客队续权", { possession: "away" });
    const nextPeriod = commitGameEvent(sameAway, "NEXT_PERIOD", "新节开始", { possession: "away" });
    expect([start, retained, changed, sameAway, nextPeriod].map((state) => state.offensivePossessionSerial)).toEqual([1, 1, 2, 2, 3]);
  });

  it("blocks a second natural whistle inside ten possessions while forced referee calls remain available", () => {
    const first = callPersonalFoul(fixture(), {
      offenderId: "a7",
      offendedPlayerId: "h1",
      kind: "SHOOTING",
      shotPoints: 2,
      source: "NATURAL",
    });
    expect(first.naturalFoulPossessions).toEqual([1]);
    const atTen = { ...first, offensivePossessionSerial: 10 };
    const blocked = callPersonalFoul(atTen, {
      offenderId: "a8",
      offendedPlayerId: "h2",
      kind: "NON_SHOOTING",
      source: "NATURAL",
    });
    expect(blocked).toBe(atTen);
    expect(blocked.naturalFoulPossessions).toEqual([1]);
    expect(blocked.playerBoxScores.byPlayerId.a8.personalFouls).toBe(0);

    const allowed = callPersonalFoul({ ...first, phase: "SET_OFFENSE", freeThrowSequence: undefined, offensivePossessionSerial: 11 }, {
      offenderId: "a8",
      offendedPlayerId: "h2",
      kind: "NON_SHOOTING",
      source: "NATURAL",
    });
    expect(allowed.naturalFoulPossessions).toEqual([1, 11]);
    expect(allowed.playerBoxScores.byPlayerId.a8.personalFouls).toBe(1);

    const forced = callPersonalFoul({ ...first, phase: "SET_OFFENSE", freeThrowSequence: undefined, offensivePossessionSerial: 2 }, {
      offenderId: "a8",
      offendedPlayerId: "h2",
      kind: "NON_SHOOTING",
    });
    expect(forced.playerBoxScores.byPlayerId.a8.personalFouls).toBe(1);
    expect(forced.naturalFoulPossessions).toEqual([1]);
  });

  it("blocks natural three-point shooting fouls until fifty offensive possessions have elapsed", () => {
    const first = callPersonalFoul(fixture(), {
      offenderId: "a9",
      offendedPlayerId: "h1",
      kind: "SHOOTING",
      shotPoints: 3,
      source: "NATURAL",
    });
    expect(first.naturalThreePointFoulPossessions).toEqual([1]);
    const blocked = callPersonalFoul({ ...first, offensivePossessionSerial: 50 }, {
      offenderId: "a11",
      offendedPlayerId: "h2",
      kind: "SHOOTING",
      shotPoints: 3,
      source: "NATURAL",
    });
    expect(blocked.naturalThreePointFoulPossessions).toEqual([1]);
    expect(blocked.playerBoxScores.byPlayerId.a11.personalFouls).toBe(0);
    const allowed = callPersonalFoul({ ...first, phase: "SET_OFFENSE", freeThrowSequence: undefined, offensivePossessionSerial: 51 }, {
      offenderId: "a11",
      offendedPlayerId: "h2",
      kind: "SHOOTING",
      shotPoints: 3,
      source: "NATURAL",
    });
    expect(allowed.naturalThreePointFoulPossessions).toEqual([1, 51]);
    expect(allowed.naturalFoulPossessions).toEqual([1, 51]);
  });

  it("retains possession on a non-penalty common foul and awards two automatic throws once in the bonus", () => {
    const ordinary = callPersonalFoul(fixture(), {
      offenderId: "a7",
      offendedPlayerId: "h1",
      kind: "NON_SHOOTING",
    });
    expect(ordinary.phase).toBe("DEAD_BALL");
    expect(ordinary.possession).toBe("home");
    expect(ordinary.restart).toMatchObject({ spot: "SIDELINE_FRONTCOURT", retainsPossession: true });
    expect(ordinary.freeThrowSequence).toBeUndefined();

    const bonus = callPersonalFoul(fixture({ teamFouls: { home: 0, away: 4 } }), {
      offenderId: "a7",
      offendedPlayerId: "h1",
      kind: "NON_SHOOTING",
      seed: 1,
    });
    expect(bonus.phase).toBe("FREE_THROW");
    expect(bonus.freeThrowSequence).toMatchObject({ total: 2, reason: "BONUS" });
  });

  it("turns an offensive foul into a turnover without adding a team foul", () => {
    const called = callPersonalFoul(fixture(), {
      offenderId: "h1",
      offendedPlayerId: "a7",
      kind: "OFFENSIVE_CHARGE",
    });

    expect(called.phase).toBe("DEAD_BALL");
    expect(called.deadBallReason).toBe("OFFENSIVE_FOUL");
    expect(called.possession).toBe("away");
    expect(called.restart).toMatchObject({ team: "away", requiresAdvance: true, retainsPossession: false });
    expect(called.teamFouls.home).toBe(0);
    expect(called.playerBoxScores.byPlayerId.h1).toMatchObject({ personalFouls: 1, turnovers: 1 });
  });

  it("disqualifies a player on the sixth personal foul while preserving the complete ten-player ledger", () => {
    let state = fixture();
    for (let foul = 0; foul < 6; foul += 1) {
      state = callPersonalFoul(state, {
        offenderId: "a7",
        offendedPlayerId: "h1",
        kind: "OFFENSIVE_CHARGE",
      });
    }

    expect(state.playerBoxScores.byPlayerId.a7.personalFouls).toBe(6);
    expect(state.disqualifiedPlayerIds).toEqual(["a7"]);
    expect(state.playerBoxScores.playerIds).toHaveLength(10);
    expect(() => assertPlayerStatsLedger(state.playerBoxScores)).not.toThrow();
  });

  it("keeps the created player on court and under player control after six recorded fouls", () => {
    let state = fixture();
    for (let foul = 0; foul < 6; foul += 1) {
      state = callPersonalFoul(state, {
        offenderId: state.createdPlayerId,
        offendedPlayerId: "a7",
        kind: "OFFENSIVE_CHARGE",
      });
    }
    expect(state.disqualifiedPlayerIds).toContain(state.createdPlayerId);
    expect(state.controlledPlayerId).toBe(state.createdPlayerId);
    expect(state.motion.positions[state.createdPlayerId]).toBeDefined();
    expect(state.playerBoxScores.playerIds).toContain(state.createdPlayerId);
    expect(state.playerBoxScores.byPlayerId[state.createdPlayerId].personalFouls).toBe(6);
    expect(() => assertMatchInvariants(state)).not.toThrow();
  });

  it("calls offensive three seconds just after the threshold and resets every per-player clock at the dead ball", () => {
    const base = fixture();
    const state = fixture({
      threeSecondClocks: { ...base.threeSecondClocks, h5: 2.95 },
      motion: {
        ...base.motion,
        positions: { ...base.motion.positions, h5: { x: 18, y: 50 } },
        routes: Object.fromEntries(players.map((player) => [player.id, []])),
      },
    });
    const called = advanceMatchTime(state, 100);

    expect(called.deadBallReason).toBe("OFFENSIVE_THREE_SECONDS");
    expect(called.lastOfficialCall).toMatchObject({ kind: "OFFENSIVE_THREE_SECONDS", offenderId: "h5" });
    expect(called.possession).toBe("away");
    expect(called.playerBoxScores.byPlayerId.h5.turnovers).toBe(1);
    expect(Object.values(called.threeSecondClocks).every((clock) => clock === 0)).toBe(true);
  });

  it("records a created-player offensive three-second turnover exactly once in both ledgers", () => {
    const base = fixture();
    const state = fixture({
      ballHandlerId: "h2",
      threeSecondClocks: { ...base.threeSecondClocks, h1: 2.95 },
      motion: {
        ...base.motion,
        positions: { ...base.motion.positions, h1: { x: 18, y: 50 } },
        routes: Object.fromEntries(players.map((player) => [player.id, []])),
      },
    });
    const called = advanceMatchTime(state, 100);

    expect(called.lastOfficialCall).toMatchObject({ kind: "OFFENSIVE_THREE_SECONDS", offenderId: "h1" });
    expect(called.playerStats.turnovers).toBe(1);
    expect(called.playerBoxScores.byPlayerId.h1.turnovers).toBe(1);
  });

  it("records an opponent offensive three-second turnover exactly once in both ledgers", () => {
    const base = fixture();
    const state = fixture({
      possession: "away",
      ballHandlerId: "a7",
      phase: "SCREEN_APPROACH",
      threeSecondClocks: { ...base.threeSecondClocks, a23: 2.95 },
      motion: {
        ...base.motion,
        positions: { ...base.motion.positions, a23: { x: 82, y: 50 } },
        routes: Object.fromEntries(players.map((player) => [player.id, []])),
      },
    });
    const called = advanceMatchTime(state, 100);

    expect(called.lastOfficialCall).toMatchObject({ kind: "OFFENSIVE_THREE_SECONDS", offenderId: "a23" });
    expect(called.opponentStats.turnovers).toBe(1);
    expect(called.playerBoxScores.byPlayerId.a23.turnovers).toBe(1);
  });

  it("resets lane time immediately after a player exits instead of carrying it into the next visit", () => {
    const base = fixture();
    const state = fixture({
      threeSecondClocks: { ...base.threeSecondClocks, h5: 2.95 },
      motion: {
        ...base.motion,
        positions: { ...base.motion.positions, h5: { x: 34, y: 75 } },
        routes: Object.fromEntries(players.map((player) => [player.id, []])),
      },
    });
    const after = advanceMatchTime(state, 50);
    expect(after.threeSecondClocks.h5).toBe(0);
    expect(after.phase).toBe("SET_OFFENSE");
  });

  it("calls defensive three seconds without a personal/team foul and chooses an automatic technical shooter", () => {
    const base = fixture();
    const state = fixture({
      threeSecondClocks: { ...base.threeSecondClocks, a23: 2.95 },
      motion: {
        ...base.motion,
        positions: {
          ...base.motion.positions,
          h1: { x: 35, y: 50 },
          h2: { x: 34, y: 15 },
          h3: { x: 34, y: 85 },
          h4: { x: 38, y: 25 },
          h5: { x: 38, y: 75 },
          a23: { x: 18, y: 50 },
        },
        routes: Object.fromEntries(players.map((player) => [player.id, []])),
      },
    });
    const called = advanceMatchTime(state, 100);

    expect(called.phase).toBe("FREE_THROW");
    expect(called.lastOfficialCall).toMatchObject({ kind: "DEFENSIVE_THREE_SECONDS", offenderId: "a23" });
    expect(called.freeThrowSequence).toMatchObject({ total: 1, reason: "DEFENSIVE_THREE_SECONDS", retainPossession: true });
    expect(called.teamFouls.away).toBe(0);
    expect(called.playerBoxScores.byPlayerId.a23.personalFouls).toBe(0);
  });
});

describe("officiating closure: basket interference and ten-player conservation", () => {
  it("awards a defensive goaltend once and closes score, restart and shooter statistics", () => {
    const flight = startResolvedShot(fixture(), {
      attackingTeam: "home",
      shooterId: "h1",
      points: 3,
      made: false,
      shotType: "THREE",
      explanation: "下降段三分",
      seed: 902,
    });
    const called = callBasketInterference(flight, {
      touchingPlayerId: "a9",
      descending: true,
      aboveRing: false,
      withinCylinder: false,
      touchedBackboard: false,
      hasChanceToScore: true,
    });

    expect(called.deadBallReason).toBe("GOALTENDING");
    expect(called.homeScore).toBe(flight.homeScore + 3);
    expect(called.playerBoxScores.byPlayerId.h1).toMatchObject({ fieldGoalsMade: 1, fieldGoalsAttempted: 1, points: 3 });
    expect(called.playerBoxScores.byPlayerId.a9.blocks).toBe(0);
    expect(called.lastOfficialCall).toMatchObject({ kind: "DEFENSIVE_GOALTENDING", offenderId: "a9" });
    expect(called.pendingShot).toBeUndefined();
    expect(() => assertMatchInvariants(called)).not.toThrow();
  });

  it("cancels an offensive cylinder touch, charges the actual toucher and changes possession", () => {
    const flight = startResolvedShot(fixture(), {
      attackingTeam: "home",
      shooterId: "h1",
      points: 2,
      made: true,
      shotType: "RIM",
      explanation: "篮筐圆柱上方",
      seed: 903,
    });
    const called = callBasketInterference(flight, {
      touchingPlayerId: "h4",
      descending: false,
      aboveRing: true,
      withinCylinder: true,
      touchedBackboard: false,
      hasChanceToScore: true,
    });

    expect(called.deadBallReason).toBe("BASKET_INTERFERENCE");
    expect(called.homeScore).toBe(flight.homeScore);
    expect(called.possession).toBe("away");
    expect(called.playerBoxScores.byPlayerId.h1).toMatchObject({ fieldGoalsMade: 0, fieldGoalsAttempted: 1, points: 0 });
    expect(called.playerBoxScores.byPlayerId.h4.turnovers).toBe(1);
    expect(called.lastOfficialCall).toMatchObject({ kind: "OFFENSIVE_INTERFERENCE", offenderId: "h4" });
    expect(() => assertMatchInvariants(called)).not.toThrow();
  });

  it.each([
    {
      label: "descending try touched by the defense",
      touchingTeam: "away" as const,
      expected: "DEFENSIVE_GOALTENDING" as const,
      ballState: { descending: true, aboveRing: false, withinCylinder: false, touchedBackboard: false, ballOnRing: false, handThroughRing: false },
    },
    {
      label: "offense touching a ball in the cylinder",
      touchingTeam: "home" as const,
      expected: "OFFENSIVE_INTERFERENCE" as const,
      ballState: { descending: false, aboveRing: true, withinCylinder: true, touchedBackboard: false, ballOnRing: false, handThroughRing: false },
    },
    {
      label: "defense touching a backboard try with a scoring chance",
      touchingTeam: "away" as const,
      expected: "DEFENSIVE_GOALTENDING" as const,
      ballState: { descending: false, aboveRing: false, withinCylinder: false, touchedBackboard: true, ballOnRing: false, handThroughRing: false },
    },
  ])("classifies $label", ({ touchingTeam, expected, ballState }) => {
    expect(evaluateBasketInterference({
      shootingTeam: "home",
      touchingTeam,
      hasChanceToScore: true,
      ...ballState,
    })).toBe(expected);
  });

  it("keeps ten unique stat lines and makes team points/plus-minus reconcile after a foul sequence", () => {
    const completed = finishFreeThrows(callPersonalFoul(fixture(), {
      offenderId: "a7",
      offendedPlayerId: "h1",
      kind: "SHOOTING",
      shotMade: false,
      shotPoints: 3,
      seed: 1,
    }));
    const lines = Object.values(completed.playerBoxScores.byPlayerId);

    expect(completed.playerBoxScores.playerIds).toHaveLength(10);
    expect(new Set(completed.playerBoxScores.playerIds)).toHaveLength(10);
    expect(lines.filter((line) => line.team === "home")).toHaveLength(5);
    expect(lines.filter((line) => line.team === "away")).toHaveLength(5);
    expect(teamPlayerPoints(completed, "home")).toBe(completed.homeScore - completed.initialHomeScore);
    expect(teamPlayerPoints(completed, "away")).toBe(completed.awayScore - completed.initialAwayScore);
    expect(lines.reduce((total, line) => total + line.plusMinus, 0)).toBe(0);
    expect(completed.playerBoxScores.byPlayerId.a7.personalFouls).toBe(1);
    expect(() => assertPlayerStatsLedger(completed.playerBoxScores)).not.toThrow();
  });
});
