import { describe, expect, it } from "vitest";
import { resolveGameAction } from "./controller";
import { initialMatchState } from "./data";
import {
  advanceAutomaticPhase,
  advanceMatchTime,
  assertMatchInvariants,
  beginDeadBall,
  declareOutOfBounds,
  startFastbreak,
} from "./flow";
import type { MatchState, RestartPlan, TeamSide } from "./types";

function fixture(patch: Partial<MatchState> = {}): MatchState {
  return structuredClone({ ...initialMatchState, ...patch });
}

function restart(team: TeamSide, patch: Partial<RestartPlan> = {}): RestartPlan {
  return {
    team,
    spot: "BASELINE",
    reason: "MADE_BASKET",
    shotClock: 24,
    requiresAdvance: true,
    retainsPossession: false,
    gameClockContinues: false,
    ...patch,
  };
}

describe("M3A authoritative clocks", () => {
  it("advances live clocks from elapsed milliseconds without changing the decision context", () => {
    const before = fixture({ gameSeconds: 10, shotClock: 5 });
    const after = advanceMatchTime(before, 1_250);
    expect(after.gameSeconds).toBe(8.75);
    expect(after.shotClock).toBe(3.75);
    expect(after.seed).toBe(before.seed);
    expect(after.version).toBe(before.version);
    expect(after.decisionEpoch).toBe(before.decisionEpoch);
  });

  it("does not deduct a second time when a player action resolves", () => {
    const before = fixture({ gameSeconds: 101.4, shotClock: 17.6 });
    const after = resolveGameAction(before, "screen");
    expect(after.gameSeconds).toBe(before.gameSeconds);
    expect(after.shotClock).toBe(before.shotClock);
    expect(after.eventLog.at(-1)?.kind).toBe("SCREEN");
  });

  it("freezes the two main clocks during an ordinary dead ball", () => {
    const dead = beginDeadBall(
      fixture({ gameSeconds: 90, shotClock: 12 }),
      "OUT_OF_BOUNDS",
      restart("home", { reason: "OUT_OF_BOUNDS", spot: "SIDELINE_FRONTCOURT", shotClock: 12, requiresAdvance: false, retainsPossession: true }),
      "防守碰出",
    );
    const after = advanceMatchTime(dead, 300);
    expect(after.phase).toBe("DEAD_BALL");
    expect(after.gameSeconds).toBe(90);
    expect(after.shotClock).toBe(12);
    expect(after.transitionClock).toBeCloseTo(0.35, 3);
  });

  it("keeps the game clock running after an early made basket but stops it in the late fourth", () => {
    const early = beginDeadBall(
      fixture({ gameSeconds: 180 }),
      "MADE_BASKET",
      restart("away", { gameClockContinues: true }),
      "早段进球",
    );
    expect(advanceMatchTime(early, 500).gameSeconds).toBe(179.5);

    const late = beginDeadBall(
      fixture({ gameSeconds: 100 }),
      "MADE_BASKET",
      restart("away", { gameClockContinues: false }),
      "末段进球",
    );
    expect(advanceMatchTime(late, 500).gameSeconds).toBe(100);
  });

  it("gives period expiration priority when game and shot clocks expire together", () => {
    const tied = fixture({ gameSeconds: 0.1, shotClock: 0.1, homeScore: 60, awayScore: 60 });
    const after = advanceMatchTime(tied, 100);
    expect(after.phase).toBe("PERIOD_END");
    expect(after.eventLog.at(-1)?.kind).toBe("PERIOD_END");
    expect(after.playerStats.turnovers).toBe(0);
  });

  it("creates exactly one 24-second violation and never makes a clock negative", () => {
    const before = fixture({ gameSeconds: 10, shotClock: 0.1 });
    const after = advanceMatchTime(before, 200);
    expect(after.phase).toBe("DEAD_BALL");
    expect(after.deadBallReason).toBe("SHOT_CLOCK_VIOLATION");
    expect(after.possession).toBe("away");
    expect(after.playerStats.turnovers).toBe(1);
    expect(after.gameSeconds).toBe(9.9);
    expect(after.shotClock).toBe(24);
    expect(after.eventLog.filter((event) => event.kind === "SHOT_CLOCK_VIOLATION")).toHaveLength(1);
  });
});

describe("M3A inbound, out-of-bounds and transition flow", () => {
  it("cancels incompatible action routes at dead balls and live-ball turnovers", () => {
    const driving = resolveGameAction(fixture(), "drive");
    expect(driving.motion.routes.h1.length).toBeGreaterThan(0);
    const dead = beginDeadBall(driving, "OUT_OF_BOUNDS", restart("away", { reason: "OUT_OF_BOUNDS" }), "突破时出界");
    expect(Object.values(dead.motion.routes).every((route) => route.length === 0)).toBe(true);
    expect(Object.values(dead.motion.velocities).every((velocity) => velocity.x === 0 && velocity.y === 0)).toBe(true);

    const transition = startFastbreak(driving, "away", "TURNOVER", "突破掉球");
    expect(Object.values(transition.motion.routes).every((route) => route.length === 0)).toBe(true);
    expect(Object.values(transition.motion.intents).every((intent) => intent === "HOLD")).toBe(true);
  });

  it("locks repeated screen input until contact and settles the coverage exactly once", () => {
    const approach = resolveGameAction(fixture(), "screen");
    const repeated = resolveGameAction(approach, "screen");
    expect(repeated).toBe(approach);
    expect(approach.phase).toBe("SCREEN_APPROACH");
    expect(approach.eventLog.filter((event) => event.kind === "SCREEN")).toHaveLength(1);

    const settled = advanceMatchTime(approach, 1_350);
    expect(settled.phase).toBe("SECOND_DECISION");
    expect(settled.eventLog.filter((event) => event.kind === "SCREEN_SET")).toHaveLength(1);
    expect(new Set(Object.values(settled.currentMatchups)).size).toBe(5);
  });

  it("runs made basket → dead ball → baseline inbound → backcourt advance → half court once", () => {
    const scored = beginDeadBall(
      fixture({ homeScore: 62, gameSeconds: 100 }),
      "MADE_BASKET",
      restart("away"),
      "命中2分",
    );
    const score = scored.homeScore;
    const after = advanceMatchTime(scored, 2_600);
    expect(after.phase).toBe("SET_OFFENSE");
    expect(after.possession).toBe("away");
    expect(after.homeScore).toBe(score);
    expect(after.eventLog.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["MADE_BASKET", "INBOUND_READY", "INBOUND_COMPLETE", "FRONTCOURT"]),
    );
  });

  it("awards a 5-second inbound violation at the original restart context", () => {
    const dead = beginDeadBall(fixture(), "OUT_OF_BOUNDS", restart("home", { reason: "OUT_OF_BOUNDS" }), "出界");
    const ready = advanceAutomaticPhase({ ...dead, transitionClock: null });
    const held = { ...ready, transitionClock: null, inboundClock: 0.1 };
    const after = advanceMatchTime(held, 200);
    expect(after.deadBallReason).toBe("INBOUND_VIOLATION");
    expect(after.possession).toBe("away");
    expect(after.playerStats.turnovers).toBe(1);
  });

  it("awards an 8-second backcourt violation at midcourt", () => {
    const base = fixture();
    const state = fixture({
      phase: "BACKCOURT_ADVANCE",
      backcourtClock: 0.1,
      frontcourtEstablished: false,
      transitionClock: null,
      gameSeconds: 30,
      shotClock: 20,
      restart: restart("home"),
      motion: {
        ...base.motion,
        positions: { ...base.motion.positions, h1: { x: 78, y: 50 } },
      },
    });
    const after = advanceMatchTime(state, 200);
    expect(after.deadBallReason).toBe("BACKCOURT_VIOLATION");
    expect(after.restart?.spot).toBe("MIDCOURT");
    expect(after.possession).toBe("away");
    expect(after.eventLog.at(-1)?.text).toContain("8秒");
  });

  it("separates an established-frontcourt return violation from the 8-second count", () => {
    const base = fixture();
    const state = fixture({
      phase: "SET_OFFENSE",
      possession: "home",
      ballHandlerId: "h1",
      frontcourtEstablished: true,
      backcourtClock: null,
      gameSeconds: 30,
      shotClock: 18,
      motion: {
        ...base.motion,
        positions: { ...base.motion.positions, h1: { x: 51, y: 50 } },
      },
    });
    const after = advanceMatchTime(state, 50);
    expect(after.deadBallReason).toBe("OVER_AND_BACK_VIOLATION");
    expect(after.restart).toMatchObject({ spot: "MIDCOURT", requiresAdvance: false });
    expect(after.eventLog.at(-1)?.text).toContain("回场违例");
    expect(after.eventLog.at(-1)?.text).not.toContain("8秒");
    expect(after.possession).toBe("away");
    expect(after.playerStats.turnovers).toBe(1);
  });

  it("does not call a return violation before frontcourt control has been established", () => {
    const base = fixture();
    const state = fixture({
      phase: "SET_OFFENSE",
      frontcourtEstablished: false,
      backcourtClock: null,
      motion: {
        ...base.motion,
        positions: { ...base.motion.positions, h1: { x: 51, y: 50 } },
      },
    });
    const after = advanceMatchTime(state, 50);
    expect(after.deadBallReason).toBeUndefined();
    expect(after.eventLog.some((event) => event.kind === "OVER_AND_BACK_VIOLATION")).toBe(false);
  });

  it.each([
    { name: "defense touched last", lastTouchedBy: "away" as const, possession: "home", shotClock: 11, retains: true },
    { name: "offense touched last", lastTouchedBy: "home" as const, possession: "away", shotClock: 24, retains: false },
  ])("resolves $name from the same frontcourt sideline", ({ lastTouchedBy, possession, shotClock, retains }) => {
    const after = declareOutOfBounds(
      fixture({ shotClock: 11, backcourtClock: null }),
      { lastTouchedBy, spot: "SIDELINE", zone: "FRONTCOURT" },
    );
    expect(after.phase).toBe("DEAD_BALL");
    expect(after.possession).toBe(possession);
    expect(after.shotClock).toBe(shotClock);
    expect(after.restart?.retainsPossession).toBe(retains);
  });

  it("keeps more than 14 seconds after a defensive deflection out", () => {
    const after = declareOutOfBounds(
      fixture({ shotClock: 18 }),
      { lastTouchedBy: "away", spot: "SIDELINE", zone: "FRONTCOURT" },
    );
    expect(after.shotClock).toBe(18);
    expect(after.restart?.shotClock).toBe(18);
  });

  it("uses 14 seconds when rim contact is followed by a defensive deflection out", () => {
    const after = declareOutOfBounds(
      fixture({ shotClock: 3 }),
      { lastTouchedBy: "away", spot: "BASELINE", zone: "FRONTCOURT", rimContacted: true },
    );
    expect(after.possession).toBe("home");
    expect(after.shotClock).toBe(14);
    expect(after.restart?.spot).toBe("BASELINE");
  });

  it("turns an unresolved six-second player fastbreak into half-court offense without resetting possession or clocks", () => {
    const fastbreak = startFastbreak(fixture({ gameSeconds: 80 }), "home", "STEAL", "抢断形成快攻");
    const after = advanceMatchTime(fastbreak, 6_000);
    expect(after.phase).toBe("SET_OFFENSE");
    expect(after.possession).toBe("home");
    expect(after.gameSeconds).toBe(74);
    expect(after.shotClock).toBe(18);
    expect(after.ballHandlerId).toBe("h1");
    expect(after.eventLog.at(-1)?.kind).toBe("FASTBREAK_END");
  });

  it("rejects a stale automatic transition token", () => {
    const dead = beginDeadBall(fixture(), "OUT_OF_BOUNDS", restart("home", { reason: "OUT_OF_BOUNDS" }), "出界");
    expect(advanceAutomaticPhase(dead, "stale-token")).toBe(dead);
  });
});

describe("M3A period, overtime and final", () => {
  it("ends a non-tied fourth quarter once and freezes all later commands", () => {
    const ending = fixture({ gameSeconds: 0.1, shotClock: 8, homeScore: 63, awayScore: 60 });
    const final = advanceMatchTime(ending, 200);
    expect(final.phase).toBe("FINAL");
    expect(final.gameResult?.winner).toBe("home");
    const afterTime = advanceMatchTime(final, 20_000);
    const afterAction = resolveGameAction(final, "shoot");
    expect(afterTime).toBe(final);
    expect(afterAction).toBe(final);
    expect(final.eventLog.filter((event) => event.kind === "FINAL")).toHaveLength(1);
  });

  it("routes a tied fourth quarter into overtime rather than a final result", () => {
    const ending = fixture({ gameSeconds: 0.1, shotClock: 8, homeScore: 60, awayScore: 60 });
    const breakState = advanceMatchTime(ending, 100);
    expect(breakState.phase).toBe("PERIOD_END");
    expect(breakState.gameResult).toBeUndefined();
    const overtime = advanceMatchTime(breakState, 1_000);
    expect(overtime.phase).toBe("TIP_OFF");
    expect(overtime.overtime).toBe(1);
    expect(overtime.gameSeconds).toBe(75);
    const live = advanceMatchTime(overtime, 900);
    expect(live.phase).toBe("SET_OFFENSE");
  });

  it("starts another overtime when an overtime period also ends tied", () => {
    const ending = fixture({ gameSeconds: 0.1, shotClock: 8, overtime: 1, homeScore: 70, awayScore: 70 });
    const next = advanceMatchTime(ending, 1_100);
    expect(next.phase).toBe("TIP_OFF");
    expect(next.overtime).toBe(2);
    expect(next.gameSeconds).toBe(75);
  });

  it("uses a normal period break before the fourth quarter", () => {
    const ending = fixture({ period: 2, gameSeconds: 0.1, shotClock: 8, homeScore: 30, awayScore: 28 });
    const next = advanceMatchTime(ending, 1_100);
    expect(next.phase).toBe("INBOUND_READY");
    expect(next.period).toBe(3);
    expect(next.overtime).toBe(0);
    expect(next.gameSeconds).toBe(180);
    expect(next.restart?.reason).toBe("PERIOD_START");
    expect(next.possession).toBe("away");
  });

  it("restores the base matchup after a switch reaches a dead ball", () => {
    const defense = fixture({ possession: "away", ballHandlerId: "a7" });
    const switched = resolveGameAction(defense, "switch");
    expect(switched.currentMatchups.h1).not.toBe(initialMatchState.currentMatchups.h1);
    const dead = beginDeadBall(
      switched,
      "OUT_OF_BOUNDS",
      restart("home", { reason: "OUT_OF_BOUNDS", spot: "SIDELINE_FRONTCOURT", requiresAdvance: false }),
      "换防后出界",
    );
    expect(dead.currentMatchups).toEqual(initialMatchState.currentMatchups);
  });
});

describe("M3A deterministic 500-possession soak", () => {
  it("completes 500 possession changes without invalid clocks, duplicate assignments or deadlock", () => {
    let state = fixture({
      gameSeconds: 100_000,
      shotClock: 24,
      rules: { ...initialMatchState.rules, regulationPeriodSeconds: 100_000 },
    });

    for (let possession = 0; possession < 500; possession += 1) {
      assertMatchInvariants(state);
      const startingTeam = state.possession;
      const action = startingTeam === "home" ? (possession % 2 === 0 ? "shoot" : "pass") : possession % 2 === 0 ? "contest" : "steal";
      state = resolveGameAction(state, action);
      state = advanceMatchTime(state, 7_000);
      if (state.possession === startingTeam && state.phase !== "FINAL") {
        if (state.phase !== "SET_OFFENSE" && state.phase !== "SECOND_DECISION" && state.phase !== "FASTBREAK") {
          state = advanceMatchTime(state, 3_000);
        }
        if (state.possession === startingTeam) {
          state = declareOutOfBounds(state, {
            lastTouchedBy: startingTeam,
            spot: "SIDELINE",
            zone: "FRONTCOURT",
          });
          state = advanceMatchTime(state, 3_000);
        }
      }
      expect(state.possession).not.toBe(startingTeam);
      assertMatchInvariants(state);
    }

    expect(state.eventSequence).toBeGreaterThan(500);
    expect(state.gameSeconds).toBeGreaterThan(0);
    expect(state.homeScore - state.initialHomeScore).toBe(state.playerStats.points);
    expect(state.awayScore - state.initialAwayScore).toBe(state.opponentStats.points);
  }, 30_000);
});
