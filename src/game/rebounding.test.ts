import { describe, expect, it } from "vitest";
import { initialMatchState, players } from "./data";
import { courtDistanceMeters } from "./movement";
import {
  generateMissTrajectory,
  resolveMissedShotRebound,
  scoreReboundCandidates,
  selectDefensiveReboundOutlet,
} from "./rebounding";
import type { CourtPlayer, MatchState, ReboundResolutionState } from "./types";

const leftRim = { x: 11, y: 50 };

function state(patch: Partial<MatchState> = {}) {
  return structuredClone({ ...initialMatchState, ...patch });
}

function roster() {
  return structuredClone(players) as CourtPlayer[];
}

function resolve(seed = 7_301) {
  const match = state({ seed });
  return resolveMissedShotRebound({
    state: match,
    roster: roster(),
    shooterId: "h1",
    shotOrigin: { x: 37, y: 19 },
    rim: leftRim,
    seed,
  });
}

describe("miss trajectory", () => {
  it("is deterministic for the same shooter, geometry and seed", () => {
    expect(resolve(98_211)).toEqual(resolve(98_211));
  });

  it("keeps every sampled landing point inside the playable court", () => {
    const shooter = roster().find((player) => player.id === "h1")!;
    for (let seed = 1; seed <= 500; seed += 1) {
      const trajectory = generateMissTrajectory(shooter, { x: 40, y: 15 }, leftRim, seed);
      expect(trajectory.landingPoint.x).toBeGreaterThanOrEqual(5);
      expect(trajectory.landingPoint.x).toBeLessThanOrEqual(95);
      expect(trajectory.landingPoint.y).toBeGreaterThanOrEqual(5);
      expect(trajectory.landingPoint.y).toBeLessThanOrEqual(95);
      expect(["FRONT_RIM", "BACK_RIM", "SIDE_RIM", "BACKBOARD", "AIRBALL"]).toContain(trajectory.collision);
    }
  });

  it("makes long attempts produce longer rebounds on average", () => {
    const shooter = roster().find((player) => player.id === "h1")!;
    let closeTotal = 0;
    let longTotal = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const close = generateMissTrajectory(shooter, { x: 17, y: 50 }, leftRim, seed);
      const long = generateMissTrajectory(shooter, { x: 40, y: 18 }, leftRim, seed);
      closeTotal += courtDistanceMeters(close.landingPoint, leftRim);
      longTotal += courtDistanceMeters(long.landingPoint, leftRim);
    }
    expect(longTotal / 300).toBeGreaterThan(closeTotal / 300 + 1.25);
  });
});

describe("rebound contest", () => {
  it("scores all ten players and exposes normalized winner probabilities", () => {
    const result = resolve(41_808);
    expect(result.candidates).toHaveLength(10);
    expect(result.candidates.reduce((sum, candidate) => sum + candidate.probability, 0)).toBeCloseTo(1, 4);
  });

  it("lowers the same player's score when only travel distance increases", () => {
    const baseRoster = roster();
    const closeState = state();
    closeState.motion.positions.h5 = { x: 14, y: 50 };
    const farState = state();
    farState.motion.positions.h5 = { x: 50, y: 92 };
    const landing = { x: 16, y: 51 };
    const close = scoreReboundCandidates(closeState, baseRoster, landing, leftRim, "home")
      .find((candidate) => candidate.playerId === "h5")!;
    const far = scoreReboundCandidates(farState, baseRoster, landing, leftRim, "home")
      .find((candidate) => candidate.playerId === "h5")!;
    expect(close.distanceMeters).toBeLessThan(far.distanceMeters);
    expect(close.arrivalSeconds).toBeLessThan(far.arrivalSeconds);
    expect(close.score).toBeGreaterThan(far.score);
  });

  it("raises the same player's score when only relevant rebound attributes rise", () => {
    const lowRoster = roster();
    const highRoster = roster();
    const low = lowRoster.find((player) => player.id === "h5")!;
    const high = highRoster.find((player) => player.id === "h5")!;
    low.ratings = { ...low.ratings, offensiveRebound: 45, strength: 55, vertical: 55, hands: 55, basketballIQ: 55 };
    high.ratings = { ...high.ratings, offensiveRebound: 95, strength: 92, vertical: 92, hands: 92, basketballIQ: 92 };
    const landing = { x: 17, y: 53 };
    const lowScore = scoreReboundCandidates(state(), lowRoster, landing, leftRim, "home")
      .find((candidate) => candidate.playerId === "h5")!.score;
    const highScore = scoreReboundCandidates(state(), highRoster, landing, leftRim, "home")
      .find((candidate) => candidate.playerId === "h5")!.score;
    expect(highScore).toBeGreaterThan(lowScore);
  });

  it("always assigns the winner to a real team and derives offensive status from that team", () => {
    const allPlayers = roster();
    const byId = new Map(allPlayers.map((player) => [player.id, player]));
    for (let seed = 1; seed <= 150; seed += 1) {
      const result = resolve(seed);
      const winner = byId.get(result.winnerId);
      expect(winner).toBeDefined();
      expect(result.offensive).toBe(winner!.team === result.attackingTeam);
    }
  });
});

describe("defensive rebound outlet", () => {
  it("prioritizes a safe teammate with elite ball handling and basketball IQ", () => {
    const match = state();
    const allPlayers = roster();
    const rebounder = allPlayers.find((player) => player.id === "a23")!;
    const primary = allPlayers.find((player) => player.id === "a7")!;
    const otherAway = allPlayers.filter((player) => player.team === "away" && player.id !== "a7");
    rebounder.ratings = { ...rebounder.ratings, passAccuracy: 91, passVision: 88, basketballIQ: 86, ballHandle: 45, ballSecurity: 55 };
    primary.ratings = { ...primary.ratings, ballHandle: 97, basketballIQ: 96, ballSecurity: 96, hands: 94, speedWithBall: 95 };
    otherAway.forEach((player) => {
      if (player.id !== "a23") player.ratings = { ...player.ratings, ballHandle: 55, basketballIQ: 58, ballSecurity: 58 };
    });
    match.motion.positions.a23 = { x: 15, y: 50 };
    match.motion.positions.a7 = { x: 27, y: 28 };
    match.motion.positions.h1 = { x: 55, y: 20 };
    match.motion.positions.h2 = { x: 52, y: 83 };
    match.motion.positions.h3 = { x: 45, y: 50 };
    match.motion.positions.h4 = { x: 36, y: 75 };
    match.motion.positions.h5 = { x: 34, y: 55 };
    const rebound: ReboundResolutionState = {
      id: "fixture",
      attackingTeam: "home",
      winnerId: "a23",
      offensive: false,
      contested: true,
      landingPoint: { x: 15, y: 50 },
      collision: "FRONT_RIM",
      rimContacted: true,
      candidates: [],
      seed: 10,
    };
    const outlet = selectDefensiveReboundOutlet(match, allPlayers, rebound);
    expect(outlet.shouldPass).toBe(true);
    expect(outlet.receiverId).toBe("a7");
    expect(outlet.risk).toBeLessThanOrEqual(0.4);
  });

  it("allows the rebounder to keep the ball when an outlet is unsafe", () => {
    const match = state();
    const allPlayers = roster();
    const rebounder = allPlayers.find((player) => player.id === "a7")!;
    rebounder.ratings = { ...rebounder.ratings, ballHandle: 96, basketballIQ: 96, ballSecurity: 95, speedWithBall: 94 };
    allPlayers.filter((player) => player.team === "away" && player.id !== "a7").forEach((player) => {
      player.ratings = { ...player.ratings, ballHandle: 48, basketballIQ: 52, ballSecurity: 48 };
    });
    const rebound: ReboundResolutionState = {
      id: "fixture-self",
      attackingTeam: "home",
      winnerId: "a7",
      offensive: false,
      contested: false,
      landingPoint: match.motion.positions.a7,
      collision: "SIDE_RIM",
      rimContacted: true,
      candidates: [],
      seed: 11,
    };
    const outlet = selectDefensiveReboundOutlet(match, allPlayers, rebound);
    expect(outlet.shouldPass).toBe(false);
    expect(outlet.receiverId).toBe("a7");
  });
});
