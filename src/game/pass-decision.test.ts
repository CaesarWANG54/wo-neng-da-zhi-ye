import { afterEach, describe, expect, it } from "vitest";
import { resolveGameAction } from "./controller";
import { evaluateOrdinaryPassOptions, resolvePass } from "./core";
import { initialMatchState, playerById } from "./data";
import { advanceMatchTime, assertMatchInvariants } from "./flow";
import type { MatchState, Ratings } from "./types";

const passer = playerById.get("h1")!;
if (!passer) throw new Error("Missing passing-decision fixture");
const originalRatings = structuredClone(passer.ratings);

afterEach(() => {
  passer.ratings = structuredClone(originalRatings);
});

function setPassingRatings(value: number) {
  passer.ratings = {
    ...passer.ratings,
    basketballIQ: value,
    passVision: value,
    passAccuracy: value,
    decisionSpeed: value,
    passSpeed: value,
    ballSecurity: value,
  } satisfies Ratings;
}

function spacedFixture(seed: number): MatchState {
  const state = structuredClone(initialMatchState);
  state.seed = seed;
  state.phase = "SET_OFFENSE";
  state.possession = "home";
  state.ballHandlerId = "h1";
  state.controlledPlayerId = "h1";
  state.frontcourtEstablished = true;
  state.motion.positions = {
    ...state.motion.positions,
    h1: { x: 42, y: 50 },
    h2: { x: 22, y: 12 },
    h3: { x: 28, y: 48 },
    h4: { x: 16, y: 82 },
    h5: { x: 14, y: 52 },
    a7: { x: 40, y: 54 },
    a8: { x: 45, y: 90 },
    a9: { x: 30, y: 48 },
    a11: { x: 17, y: 82 },
    a23: { x: 15, y: 52 },
  };
  state.motion.routes = {};
  state.motion.velocities = Object.fromEntries(
    Object.keys(state.motion.positions).map((id) => [id, { x: 0, y: 0 }]),
  );
  state.motion.intents = {
    ...state.motion.intents,
    h1: "HANDLE",
    h2: "RECEIVE",
    h3: "HOLD",
    h4: "SPACE",
    h5: "ROLL",
  };
  return state;
}

function riskyFixture(seed: number): MatchState {
  const state = spacedFixture(seed);
  state.motion.positions = {
    ...state.motion.positions,
    h1: { x: 45, y: 50 },
    h2: { x: 15, y: 10 },
    h3: { x: 18, y: 32 },
    h4: { x: 14, y: 72 },
    h5: { x: 12, y: 50 },
    a7: { x: 42, y: 50 },
    a8: { x: 30, y: 29 },
    a9: { x: 31, y: 39 },
    a11: { x: 29, y: 62 },
    a23: { x: 27, y: 50 },
  };
  return state;
}

describe("ordinary pass decision model", () => {
  it("considers all four legal off-ball teammates and high-IQ passing selects the best live opportunity", () => {
    setPassingRatings(99);
    const state = spacedFixture(1);
    const options = evaluateOrdinaryPassOptions(state);
    const result = resolvePass(state);

    expect(new Set(options.map((option) => option.targetId))).toEqual(new Set(["h2", "h3", "h4", "h5"]));
    expect(result.consideredTargetIds).toHaveLength(4);
    expect(result.bestTargetId).toBe(options[0].targetId);
    expect(result.targetId).toBe(options[0].targetId);
    expect(result.selectedCorrectly).toBe(true);
    expect(result.selectionQuality).toBeGreaterThanOrEqual(0.94);
    expect(resolvePass(state)).toEqual(result);
  });

  it("allows a low-IQ passer to choose a clearly inferior but legal teammate", () => {
    setPassingRatings(25);
    const state = spacedFixture(123_456);
    const result = resolvePass(state);
    expect(result.options).toBeDefined();
    const options = result.options!;
    const best = options[0];
    const selected = options.find((option) => option.targetId === result.targetId);

    expect(result.selectedCorrectly).toBe(false);
    expect(result.targetId).not.toBe(result.bestTargetId);
    expect(selected).toBeDefined();
    expect(best.opportunityScore - selected!.opportunityScore).toBeGreaterThan(8);
  });

  it("can turn a risky, inaccurate pass into a credited live-ball interception", () => {
    setPassingRatings(25);
    let stolen: MatchState | undefined;
    let riskyResult: ReturnType<typeof resolvePass> | undefined;
    for (let seed = 1; seed <= 2_000; seed += 1) {
      const state = riskyFixture(seed);
      const pass = resolvePass(state);
      const resolved = resolveGameAction(state, "pass");
      if (resolved.eventLog.at(-1)?.kind === "TURNOVER") {
        stolen = resolved;
        riskyResult = pass;
        break;
      }
    }

    expect(stolen).toBeDefined();
    expect(riskyResult?.laneRisk).toBeGreaterThan(0.55);
    expect(riskyResult?.completed).toBe(false);
    expect(stolen?.possession).toBe("away");
    expect(stolen?.phase).toBe("FASTBREAK");
    expect(stolen?.playerStats.turnovers).toBe(initialMatchState.playerStats.turnovers + 1);
  });

  it("distinguishes a defender's out-of-bounds deflection from an interception", () => {
    setPassingRatings(25);
    let deflected: MatchState | undefined;
    let before: MatchState | undefined;
    for (let seed = 1; seed <= 2_000; seed += 1) {
      const state = riskyFixture(seed);
      const resolved = resolveGameAction(state, "pass");
      if (resolved.eventLog.at(-1)?.kind === "OUT_OF_BOUNDS") {
        before = state;
        deflected = resolved;
        break;
      }
    }

    expect(deflected).toBeDefined();
    expect(deflected?.restart?.retainsPossession).toBe(true);
    expect(deflected?.restart?.team).toBe("home");
    expect(deflected?.shotClock).toBe(before?.shotClock);
    expect(deflected?.playerStats.turnovers).toBe(before?.playerStats.turnovers);
  });

  it("keeps the dynamically selected pass airborne while both clocks run, then transfers the handler once", () => {
    setPassingRatings(99);
    const state = spacedFixture(1);
    const decision = resolvePass(state);
    const released = resolveGameAction(state, "pass");
    const flight = released.motion.ballFlight;

    expect(released.pendingPass?.toPlayerId).toBe(decision.targetId);
    expect(released.ballHandlerId).toBe("h1");
    expect(flight).toBeDefined();
    const fixedEnd = { ...flight!.end };
    const midway = advanceMatchTime(released, flight!.duration * 500);
    expect(midway.ballHandlerId).toBe("h1");
    expect(midway.motion.ballFlight?.end).toEqual(fixedEnd);
    expect(midway.gameSeconds).toBeLessThan(released.gameSeconds);
    expect(midway.shotClock).toBeLessThan(released.shotClock);

    const arrived = advanceMatchTime(midway, flight!.duration * 600);
    expect(arrived.ballHandlerId).toBe(decision.targetId);
    expect(arrived.pendingPass).toBeUndefined();
    expect(arrived.eventLog.filter((event) => event.kind === "PASS_ARRIVAL")).toHaveLength(1);
    expect(assertMatchInvariants(arrived)).toBe(true);
  });
});
