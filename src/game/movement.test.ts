import { describe, expect, it } from "vitest";
import { resolveGameAction, selectTactic, type GameActionId, type TacticId } from "./controller";
import { initialMatchState, playerById, players } from "./data";
import { advanceMatchTime } from "./flow";
import {
  advanceCourtMotion,
  assertMotionInvariants,
  calculatePassFlight,
  courtDistance,
  courtDistanceMeters,
  courtVisualDistance,
  TEAMMATE_SPACING_VISUAL,
} from "./movement";
import type { MatchState } from "./types";

function fixture(patch: Partial<MatchState> = {}) {
  return structuredClone({ ...initialMatchState, ...patch });
}

function moved(before: MatchState, after: MatchState, id: string, threshold = 0.05) {
  return courtDistance(before.motion.positions[id], after.motion.positions[id]) > threshold;
}

describe("deterministic court movement", () => {
  it("converts board percentages using a 28.65m by 15.24m court", () => {
    expect(courtDistanceMeters({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(28.65, 6);
    expect(courtDistanceMeters({ x: 0, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(15.24, 6);
    expect(courtDistanceMeters({ x: 10, y: 10 }, { x: 20, y: 10 })).toBeCloseTo(2.865, 6);
    expect(courtDistanceMeters({ x: 10, y: 10 }, { x: 10, y: 20 })).toBeCloseTo(1.524, 6);
  });

  it("derives readable pass time from metric distance, rating and pass type", () => {
    const shortPass = calculatePassFlight({ x: 20, y: 50 }, { x: 35, y: 50 }, 70);
    const longPass = calculatePassFlight({ x: 20, y: 50 }, { x: 70, y: 50 }, 70);
    const fasterPasser = calculatePassFlight({ x: 20, y: 50 }, { x: 70, y: 50 }, 95);
    const lob = calculatePassFlight({ x: 20, y: 50 }, { x: 70, y: 50 }, 70, "LOB");
    expect(longPass.duration).toBeGreaterThan(shortPass.duration);
    expect(fasterPasser.duration).toBeLessThanOrEqual(longPass.duration);
    expect(lob.duration).toBeGreaterThan(longPass.duration);
    expect(longPass.speedMetersPerSecond).toBeGreaterThan(8);
    expect(longPass.speedMetersPerSecond).toBeLessThan(13);
  });

  it("keeps a completed pass visibly in flight until its metric duration expires", () => {
    const passed = resolveGameAction(fixture(), "pass");
    const flight = passed.motion.ballFlight;
    expect(flight).toBeDefined();
    expect(flight!.duration).toBeGreaterThanOrEqual(0.32);
    const halfway = advanceMatchTime(passed, flight!.duration * 500);
    expect(halfway.motion.ballFlight?.elapsed).toBeGreaterThan(0);
    expect(halfway.motion.ballFlight?.elapsed).toBeLessThan(flight!.duration);
    const arrived = advanceMatchTime(halfway, flight!.duration * 600);
    expect(arrived.motion.ballFlight).toBeUndefined();
  });

  it("moves AI teammates and opponents while leaving the uncommanded created player alone", () => {
    const before = fixture();
    const after = advanceMatchTime(before, 1_200);

    expect(after.motion.positions.h1).toEqual(before.motion.positions.h1);
    expect(["h2", "h3", "h4", "h5"].filter((id) => moved(before, after, id)).length).toBeGreaterThanOrEqual(3);
    expect(["a7", "a8", "a9", "a11", "a23"].filter((id) => moved(before, after, id)).length).toBeGreaterThanOrEqual(4);
    expect(after.seed).toBe(before.seed);
    expect(after.decisionEpoch).toBe(before.decisionEpoch);
    expect(after.eventLog).toEqual(before.eventLog);
    expect(after.motion.frame).toBeGreaterThan(before.motion.frame);
    expect(assertMotionInvariants(after)).toBe(true);
  });

  it("is deterministic, speed-bounded and keeps all ten pieces on the board", () => {
    const state = fixture();
    const first = advanceCourtMotion(state, 0.1);
    const second = advanceCourtMotion(state, 0.1);
    expect(first.motion).toEqual(second.motion);
    for (const player of players) {
      const delta = courtDistance(state.motion.positions[player.id], first.motion.positions[player.id]);
      expect(delta).toBeLessThanOrEqual(1.7);
    }
    expect(assertMotionInvariants(first)).toBe(true);
  });

  it("produces the same trajectory for one coarse call and twenty fixed substeps", () => {
    const state = fixture();
    const coarse = advanceCourtMotion(state, 1);
    let split = state;
    for (let index = 0; index < 20; index += 1) split = advanceCourtMotion(split, 0.05);

    for (const player of players) {
      expect(courtVisualDistance(coarse.motion.positions[player.id], split.motion.positions[player.id])).toBeLessThanOrEqual(0.08);
      expect(courtVisualDistance(coarse.motion.velocities[player.id], split.motion.velocities[player.id])).toBeLessThanOrEqual(0.08);
    }
  });

  it("keeps finite velocity state and soft spacing after the opening settle window", () => {
    let state = fixture();
    let minimumGap = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame < 80; frame += 1) {
      state = advanceCourtMotion(state, 0.05);
      for (const player of players) {
        const velocity = state.motion.velocities[player.id];
        expect(Number.isFinite(velocity.x)).toBe(true);
        expect(Number.isFinite(velocity.y)).toBe(true);
      }
      if (frame < 20) continue;
      for (let first = 0; first < players.length; first += 1) {
        for (let second = first + 1; second < players.length; second += 1) {
          minimumGap = Math.min(
            minimumGap,
            courtVisualDistance(state.motion.positions[players[first].id], state.motion.positions[players[second].id]),
          );
        }
      }
    }
    expect(minimumGap).toBeGreaterThanOrEqual(10.3);
    expect(assertMotionInvariants(state)).toBe(true);
  });

  it("keeps ordinary same-team pieces out of a visual cluster after settling", () => {
    const state = advanceCourtMotion(fixture(), 4);
    for (const team of ["home", "away"] as const) {
      const lineup = players.filter((player) => player.team === team);
      for (let first = 0; first < lineup.length; first += 1) {
        for (let second = first + 1; second < lineup.length; second += 1) {
          expect(
            courtVisualDistance(state.motion.positions[lineup[first].id], state.motion.positions[lineup[second].id]),
            `${lineup[first].id}-${lineup[second].id}`,
          ).toBeGreaterThanOrEqual(TEAMMATE_SPACING_VISUAL - 0.8);
        }
      }
    }
  });

  it("keeps half-court roles in recognizable organizer, wing and interior zones", () => {
    const state = advanceCourtMotion(fixture(), 4);
    const point = (id: string) => state.motion.positions[id];
    for (const id of ["h1", "h2", "h3"]) {
      expect(point(id).x >= 29 || point(id).y <= 30 || point(id).y >= 70, id).toBe(true);
    }
    for (const id of ["h4", "h5"]) expect(point(id).x, id).toBeLessThanOrEqual(27);
    expect(point("h5").y).toBeGreaterThan(34);
    expect(point("h5").y).toBeLessThan(66);
  });

  it("settles a completed user route without drift or a stale action intent", () => {
    let state = resolveGameAction(fixture(), "drive");
    for (let frame = 0; frame < 160; frame += 1) state = advanceCourtMotion(state, 0.05);
    expect(state.motion.routes.h1).toHaveLength(0);
    expect(state.motion.velocities.h1).toEqual({ x: 0, y: 0 });
    expect(state.motion.intents.h1).toBe("HANDLE");
    const settled = state.motion.positions.h1;
    state = advanceCourtMotion(state, 0.5);
    expect(courtVisualDistance(settled, state.motion.positions.h1)).toBeLessThanOrEqual(0.02);
  });

  it("keeps an interior ballhandler in an interior creation zone", () => {
    let state = fixture({ ballHandlerId: "h5" });
    for (let frame = 0; frame < 60; frame += 1) state = advanceCourtMotion(state, 0.05);
    expect(state.motion.positions.h5.x).toBeLessThan(30);
    expect(state.motion.positions.h5.x).toBeGreaterThan(18);
  });

  it("survives a three-minute movement soak without invalid geometry", () => {
    const after = advanceCourtMotion(fixture(), 180);
    expect(assertMotionInvariants(after)).toBe(true);
    expect(Object.keys(after.motion.velocities)).toHaveLength(10);
  });

  it.each<TacticId>(["HORNS", "FIVE_OUT", "HANDOFF", "STAGGER"])("executes %s as real multi-player routes", (tactic) => {
    const before = fixture();
    const called = selectTactic(before, tactic);
    expect(Object.values(called.motion.routes).filter((route) => route.length > 0)).toHaveLength(5);
    expect(called.motion.lastActionOwnerId).toBe("h1");
    const after = advanceMatchTime(called, 1_400);
    expect(players.filter((player) => player.team === "home" && moved(before, after, player.id, 0.5)).length).toBeGreaterThanOrEqual(4);
    expect(players.filter((player) => player.team === "away" && moved(before, after, player.id, 0.5)).length).toBeGreaterThanOrEqual(3);
  });
});

describe("right-rail action contracts", () => {
  it.each<GameActionId>(["pass", "drive", "shoot", "screen"])("makes on-ball %s a real h1 action", (action) => {
    const before = fixture();
    const after = resolveGameAction(before, action);
    expect(after.controlledPlayerId).toBe("h1");
    expect(after.motion.lastActionOwnerId).toBe("h1");
    expect(after).not.toEqual(before);
    const movementTransferredToPhase = after.phase === "DEAD_BALL" || after.phase === "FASTBREAK";
    expect(Object.values(after.motion.routes).some((route) => route.length > 0) || movementTransferredToPhase).toBe(true);
  });

  it("stages one-click set offense drive, preserves the read window, then auto-resolves a layup", () => {
    const started = resolveGameAction(fixture(), "drive");
    expect(started.advantage).toBe("DRIVE_LANE");
    expect(started.phase).toBe("SECOND_DECISION");
    expect(started.playerStats.attempts).toBe(0);
    expect(started.pendingDrive).toMatchObject({ laneOpenAtStart: false });

    let released = started;
    for (let frame = 0; frame < 120 && !released.pendingShot; frame += 1) {
      released = advanceMatchTime(released, 50);
    }
    expect(released.phase).toBe("SHOT_FLIGHT");
    expect(released.pendingShot?.shotType).toBe("RIM");
    expect(released.playerStats.attempts).toBe(0);
    const resolved = advanceMatchTime(released, 3_000);
    expect(resolved.playerStats.attempts).toBe(1);
  });

  it.each<GameActionId>(["request", "cut", "spot", "screen"])("makes off-ball %s move h1 and preserves control", (action) => {
    const before = fixture({ ballHandlerId: "h3" });
    const after = resolveGameAction(before, action);
    expect(after.controlledPlayerId).toBe("h1");
    expect(after.motion.lastActionOwnerId).toBe("h1");
    expect(after.motion.routes.h1?.length ?? 0).toBeGreaterThan(0);
  });

  it.each<GameActionId>(["contain", "steal", "contest", "switch", "zone"])("makes defensive %s spatial or persistent", (action) => {
    const before = fixture({ possession: "away", ballHandlerId: "a7" });
    const after = resolveGameAction(before, action);
    expect(after.controlledPlayerId).toBe("h1");
    expect(after.motion.lastActionOwnerId).toBe("h1");
    expect(after).not.toEqual(before);
    const routeChanged = (after.motion.routes.h1?.length ?? 0) > 0;
    const ruleChanged = after.defenseScheme !== before.defenseScheme || after.currentMatchups.h1 !== before.currentMatchups.h1;
    const possessionChanged = after.possession !== before.possession;
    expect(routeChanged || ruleChanged || possessionChanged).toBe(true);
  });

  it("atomically changes the controlled matchup and gives 2-3 zone persistent state", () => {
    const defense = fixture({ possession: "away", ballHandlerId: "a7" });
    const switched = resolveGameAction(defense, "switch");
    expect(switched.currentMatchups.h1).not.toBe(defense.currentMatchups.h1);
    expect(playerById.get(switched.currentMatchups.h1)?.team).toBe("away");
    expect(new Set(Object.values(switched.currentMatchups)).size).toBe(5);
    expect(switched.motion.intents.h1).toBe("SWITCH");

    const zoned = resolveGameAction(defense, "zone");
    expect(zoned.defenseScheme).toBe("ZONE_2_3");
    expect(players.filter((player) => player.team === "home" && zoned.motion.routes[player.id]?.length).length).toBe(5);
  });

  it("does not allow a cross-court instant steal or block", () => {
    const defense = fixture({ possession: "away", ballHandlerId: "a7" });
    expect(resolveGameAction(defense, "steal").eventLog.at(-1)?.kind).toBe("STEAL_CLOSE_GAP");
    expect(resolveGameAction(defense, "contest").eventLog.at(-1)?.kind).toBe("CONTEST_CLOSEOUT");
  });
});
