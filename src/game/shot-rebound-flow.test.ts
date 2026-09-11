import { describe, expect, it } from "vitest";
import { initialMatchState } from "./data";
import { advanceMatchTime, assertMatchInvariants, startResolvedShot } from "./flow";
import { sampleBallFlight } from "./movement";
import type { MatchState } from "./types";

function fixture(patch: Partial<MatchState> = {}) {
  return structuredClone({ ...initialMatchState, ...patch });
}

function releaseMiss(seed: number, patch: Partial<MatchState> = {}) {
  return startResolvedShot(fixture({ ...patch, seed }), {
    attackingTeam: "home",
    shooterId: "h1",
    points: 3,
    made: false,
    shotType: "THREE",
    explanation: "固定未中测试",
    seed,
  });
}

function advanceUntil(state: MatchState, predicate: (value: MatchState) => boolean, maxFrames = 120) {
  let current = state;
  for (let frame = 0; frame < maxFrames && !predicate(current); frame += 1) current = advanceMatchTime(current, 50);
  return current;
}

function findMiss(predicate: (state: MatchState) => boolean) {
  for (let seed = 1; seed <= 30_000; seed += 1) {
    const shot = releaseMiss(seed);
    if (predicate(shot)) return shot;
  }
  throw new Error("No deterministic rebound fixture found");
}

describe("three-dimensional shot and rebound flow", () => {
  it("does not change score or statistics until the ball finishes its flight", () => {
    const released = startResolvedShot(fixture(), {
      attackingTeam: "home",
      shooterId: "h1",
      points: 2,
      made: true,
      shotType: "MID_RANGE",
      explanation: "固定命中测试",
      seed: 44,
    });
    expect(released.phase).toBe("SHOT_FLIGHT");
    expect(released.homeScore).toBe(60);
    expect(released.playerStats.attempts).toBe(0);
    expect(released.motion.ballFlight?.kind).toBe("SHOT");

    const resolved = advanceUntil(released, (state) => state.eventLog.some((event) => event.kind === "MADE_BASKET"));
    expect(resolved.homeScore).toBe(62);
    expect(resolved.playerStats.attempts).toBe(1);
    expect(resolved.playerStats.made).toBe(1);
    expect(resolved.phase).toBe("DEAD_BALL");
  });

  it("keeps floor projection and vertical height independent", () => {
    const released = releaseMiss(902);
    const flight = released.motion.ballFlight!;
    const start = sampleBallFlight({ ...flight, elapsed: 0 });
    const apex = sampleBallFlight({ ...flight, elapsed: flight.duration / 2 });
    const end = sampleBallFlight({ ...flight, elapsed: flight.duration });
    expect(start.heightMeters).toBeGreaterThan(1.9);
    expect(apex.heightMeters).toBeGreaterThan(start.heightMeters);
    expect(apex.heightMeters).toBeGreaterThan(end.heightMeters);
    expect(end.x).toBeCloseTo(flight.end.x, 6);
    expect(end.y).toBeCloseTo(flight.end.y, 6);
  });

  it("moves a rim miss through a visible loose-ball phase before control", () => {
    const released = findMiss((state) => state.pendingShot?.plannedRebound?.rimContacted === true);
    const loose = advanceUntil(released, (state) => state.phase === "REBOUND");
    expect(loose.motion.ballFlight?.kind).toBe("RIM_REBOUND");
    expect(loose.shotClock).toBe(0);
    expect(loose.pendingRebound?.resolution.candidates).toHaveLength(10);
    expect(loose.pendingRebound?.resolution.winnerId).toBeTruthy();
    expect(assertMatchInvariants(loose)).toBe(true);
  });

  it("gives a real offensive rebounder the ball, 14 seconds and a second-chance decision", () => {
    const released = findMiss((state) => {
      const rebound = state.pendingShot?.plannedRebound;
      return rebound?.rimContacted === true && rebound.offensive;
    });
    const resolved = advanceUntil(released, (state) => state.eventLog.some((event) => event.kind === "OFFENSIVE_REBOUND"));
    expect(resolved.lastRebound?.offensive).toBe(true);
    expect(resolved.ballHandlerId).toBe(resolved.lastRebound?.winnerId);
    expect(resolved.shotClock).toBe(14);
    expect(resolved.advantage).toBe("SECOND_CHANCE");
    expect(resolved.secondChanceCount).toBe(1);
    expect(assertMatchInvariants(resolved)).toBe(true);
  });

  it("preserves the naturally elapsed clock when an airball is recovered by the offense", () => {
    const released = findMiss((state) => {
      const rebound = state.pendingShot?.plannedRebound;
      return rebound?.collision === "AIRBALL" && rebound.offensive;
    });
    const shortClockRelease = { ...released, shotClock: 9, pendingShot: released.pendingShot ? { ...released.pendingShot, releaseShotClock: 9 } : undefined };
    const resolved = advanceUntil(shortClockRelease, (state) => state.eventLog.some((event) => event.kind === "OFFENSIVE_REBOUND"));
    expect(resolved.lastRebound?.rimContacted).toBe(false);
    expect(resolved.shotClock).toBeLessThan(9);
    expect(resolved.shotClock).toBeGreaterThan(0);
  });

  it("turns a defensive rebound into self-push or a visible outlet instead of a fixed handler", () => {
    let resolved: MatchState | undefined;
    for (let seed = 1; seed <= 5_000 && !resolved; seed += 1) {
      const released = releaseMiss(seed);
      if (released.pendingShot?.plannedRebound?.offensive !== false) continue;
      const candidate = advanceUntil(released, (state) => state.eventLog.some((event) => ["DEFENSIVE_REBOUND", "OUTLET_TURNOVER"].includes(event.kind)));
      if (candidate.eventLog.some((event) => event.kind === "DEFENSIVE_REBOUND")) resolved = candidate;
    }
    expect(resolved).toBeDefined();
    expect(resolved!.possession).toBe("away");
    expect(resolved!.lastRebound?.winnerId).toBeTruthy();
    expect(resolved!.phase).toBe("FASTBREAK");
    if (resolved!.motion.ballFlight) expect(resolved!.motion.ballFlight.kind).toBe("OUTLET");
    expect(assertMatchInvariants(resolved!)).toBe(true);
  });

  it("lets a legal buzzer shot finish after the clock reaches zero", () => {
    const released = startResolvedShot(fixture({ gameSeconds: 0.1, shotClock: 0.1 }), {
      attackingTeam: "home",
      shooterId: "h1",
      points: 2,
      made: true,
      shotType: "MID_RANGE",
      explanation: "压哨测试",
      seed: 91,
    });
    const resolved = advanceMatchTime(released, 2_000);
    expect(resolved.homeScore).toBe(62);
    expect(resolved.phase).toBe("FINAL");
    expect(resolved.gameResult?.winner).toBe("home");
  });

  it("preserves semantic results across coarse and 50ms partitions", () => {
    const released = releaseMiss(7_301);
    const coarse = advanceMatchTime(structuredClone(released), 3_000);
    let fine = structuredClone(released);
    for (let frame = 0; frame < 60; frame += 1) fine = advanceMatchTime(fine, 50);
    expect({
      seed: fine.seed,
      phase: fine.phase,
      possession: fine.possession,
      ballHandlerId: fine.ballHandlerId,
      homeScore: fine.homeScore,
      awayScore: fine.awayScore,
      gameSeconds: fine.gameSeconds,
      shotClock: fine.shotClock,
      eventLog: fine.eventLog,
      lastRebound: fine.lastRebound,
    }).toEqual({
      seed: coarse.seed,
      phase: coarse.phase,
      possession: coarse.possession,
      ballHandlerId: coarse.ballHandlerId,
      homeScore: coarse.homeScore,
      awayScore: coarse.awayScore,
      gameSeconds: coarse.gameSeconds,
      shotClock: coarse.shotClock,
      eventLog: coarse.eventLog,
      lastRebound: coarse.lastRebound,
    });
  });
});
