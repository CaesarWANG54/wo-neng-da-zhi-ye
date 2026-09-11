import { describe, expect, it } from "vitest";
import { resolveGameAction } from "./controller";
import { initialMatchState } from "./data";
import {
  advanceMatchTime,
  assertMatchInvariants,
  canAcceptGameAction,
  declareOutOfBounds,
  hasOverAndBackViolation,
} from "./flow";
import { passCatchPoint, sampleBallFlight } from "./movement";
import type { MatchState } from "./types";

function fixture(patch: Partial<MatchState> = {}): MatchState {
  return structuredClone({ ...initialMatchState, ...patch });
}

function ordinaryPass() {
  const initial = fixture();
  const released = resolveGameAction(initial, "pass");
  if (!released.pendingPass || !released.motion.ballFlight) throw new Error("Expected a live pass fixture");
  return { initial, released, pass: released.pendingPass, flight: released.motion.ballFlight };
}

describe("explicit pass-arrival semantics", () => {
  it("keeps the passer authoritative and rejects on-ball actions while the ball is airborne", () => {
    const { initial, released, pass, flight } = ordinaryPass();
    expect(released.ballHandlerId).toBe(initial.ballHandlerId);
    expect(pass.fromPlayerId).toBe(initial.ballHandlerId);
    expect(pass.toPlayerId).not.toBe(initial.ballHandlerId);
    expect(canAcceptGameAction(released)).toBe(false);
    expect(resolveGameAction(released, "shoot")).toBe(released);

    const midway = advanceMatchTime(released, flight.duration * 500);
    expect(midway.ballHandlerId).toBe(initial.ballHandlerId);
    expect(midway.pendingPass?.id).toBe(pass.id);
    expect(midway.motion.ballFlight).toBeDefined();
  });

  it("transfers control and emits the catch exactly once at physical arrival", () => {
    const { released, pass, flight } = ordinaryPass();
    const arrived = advanceMatchTime(released, (flight.duration + 0.05) * 1_000);
    expect(arrived.ballHandlerId).toBe(pass.toPlayerId);
    expect(arrived.pendingPass).toBeUndefined();
    expect(arrived.motion.ballFlight).toBeUndefined();
    expect(arrived.eventLog.filter((event) => event.kind === "PASS_ARRIVAL")).toHaveLength(1);
    expect(assertMatchInvariants(arrived)).toBe(true);

    const later = advanceMatchTime(arrived, 100);
    expect(later.eventLog.filter((event) => event.kind === "PASS_ARRIVAL")).toHaveLength(1);
  });

  it("keeps a fixed release-time endpoint while the receiver runs onto it", () => {
    const { released, pass, flight } = ordinaryPass();
    const frozenEnd = { ...flight.end };
    const receiverStart = { ...released.motion.positions[pass.toPlayerId] };
    const midway = advanceMatchTime(released, flight.duration * 500);
    expect(midway.motion.ballFlight?.end).toEqual(frozenEnd);
    expect(midway.motion.positions[pass.toPlayerId]).not.toEqual(receiverStart);
    const sampled = sampleBallFlight(midway.motion.ballFlight!);
    expect(sampled.progress).toBeGreaterThan(0);
    expect(sampled.progress).toBeLessThan(1);
  });

  it("continues the game and shot clocks throughout flight", () => {
    const { released, flight } = ordinaryPass();
    const elapsedSeconds = flight.duration / 2;
    const midway = advanceMatchTime(released, elapsedSeconds * 1_000);
    expect(released.gameSeconds - midway.gameSeconds).toBeCloseTo(elapsedSeconds, 4);
    expect(released.shotClock - midway.shotClock).toBeCloseTo(elapsedSeconds, 4);
  });

  it("cancels an airborne pass when a dead-ball restart changes the world", () => {
    const { released } = ordinaryPass();
    const deadBall = declareOutOfBounds(released, {
      lastTouchedBy: "home",
      spot: "SIDELINE",
      zone: "FRONTCOURT",
    });
    expect(deadBall.phase).toBe("DEAD_BALL");
    expect(deadBall.pendingPass).toBeUndefined();
    expect(deadBall.motion.ballFlight).toBeUndefined();
    const advanced = advanceMatchTime(deadBall, 2_000);
    expect(advanced.eventLog.some((event) => event.kind === "PASS_ARRIVAL")).toBe(false);
  });

  it("clamps an established frontcourt catch point without weakening genuine backcourt calls", () => {
    const motion = structuredClone(initialMatchState.motion);
    motion.positions.a7 = { x: 62, y: 50 };
    motion.positions.a9 = { x: 52, y: 40 };
    motion.velocities.a9 = { x: -40, y: 0 };
    const catchPoint = passCatchPoint(motion, "a7", "a9", "PASS", true, "away");
    expect(catchPoint?.x).toBeGreaterThanOrEqual(50);

    const illegal = fixture({
      phase: "SET_OFFENSE",
      possession: "home",
      ballHandlerId: "h1",
      frontcourtEstablished: true,
      backcourtClock: null,
      motion: {
        ...initialMatchState.motion,
        positions: { ...initialMatchState.motion.positions, h1: { x: 51, y: 50 } },
      },
    });
    expect(hasOverAndBackViolation(illegal)).toBe(true);
    expect(advanceMatchTime(illegal, 50).deadBallReason).toBe("OVER_AND_BACK_VIOLATION");
  });

  it("restores the receiving AI player's live stage route after the catch", () => {
    let state = fixture({
      possession: "away",
      ballHandlerId: "a7",
      phase: "SET_OFFENSE",
      restart: undefined,
      opponentOffense: undefined,
      pendingDefenseResponse: undefined,
      aiDecisionClock: null,
      opponentPlayHistory: [],
      gameSeconds: 90,
      shotClock: 24,
      seed: 0x31_415_926,
    });
    for (let step = 0; step < 400 && !state.pendingPass; step += 1) state = advanceMatchTime(state, 50);
    expect(state.pendingPass?.continuation).toBe("AI_STAGE");
    expect(state.motion.ballFlight).toBeDefined();
    const receiverId = state.pendingPass!.toPlayerId;
    const arrived = advanceMatchTime(state, ((state.motion.ballFlight?.duration ?? 0) + 0.05) * 1_000);
    expect(arrived.ballHandlerId).toBe(receiverId);
    expect(arrived.motion.intents[receiverId]).toBe("HANDLE");
    expect(arrived.motion.routes[receiverId]?.length ?? 0).toBeGreaterThan(0);
    expect(assertMatchInvariants(arrived)).toBe(true);
  });
});
