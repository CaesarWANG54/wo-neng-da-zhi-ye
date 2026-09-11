import { describe, expect, it } from "vitest";
import { resolveGameAction } from "./controller";
import {
  assessDriveLane,
  calculateFinishChance,
  findNearestLegalPerimeterTeammate,
  resolveDrive,
  resolveShot,
} from "./core";
import { initialMatchState, playerById } from "./data";
import { advanceMatchTime, assertMatchInvariants } from "./flow";
import { attackRim, courtDistanceMeters } from "./movement";
import type { CourtPoint, MatchState } from "./types";

function player(id: string) {
  const value = playerById.get(id);
  if (!value) throw new Error(`Missing fixture player ${id}`);
  return value;
}

function withPositions(state: MatchState, positions: Record<string, CourtPoint>): MatchState {
  return {
    ...state,
    motion: {
      ...state.motion,
      positions: { ...state.motion.positions, ...positions },
      routes: Object.fromEntries(Object.keys(state.motion.routes).map((id) => [id, []])),
      velocities: Object.fromEntries(Object.keys(state.motion.velocities).map((id) => [id, { x: 0, y: 0 }])),
      ballFlight: undefined,
    },
  };
}

function openFastbreakFixture(): MatchState {
  const base = structuredClone(initialMatchState);
  return withPositions({
    ...base,
    seed: 1,
    phase: "FASTBREAK",
    phaseToken: "fastbreak-drive-fixture",
    fastbreakClock: 6,
    transitionClock: null,
    backcourtClock: null,
    frontcourtEstablished: true,
    advantage: undefined,
    pendingDrive: undefined,
  }, {
    h1: { x: 28, y: 50 },
    h2: { x: 31, y: 12 },
    h3: { x: 45, y: 87 },
    h4: { x: 47, y: 20 },
    h5: { x: 25, y: 50 },
    a7: { x: 67, y: 10 },
    a8: { x: 66, y: 90 },
    a9: { x: 61, y: 8 },
    a11: { x: 65, y: 92 },
    a23: { x: 70, y: 50 },
  });
}

describe("live drive-lane reads", () => {
  it("recognizes an actually empty rim and ignores bigs who are still behind the play", () => {
    const open = openFastbreakFixture();
    expect(assessDriveLane(open)).toMatchObject({
      openRim: true,
      rimProtectorId: undefined,
      pathBlockerIds: [],
    });

    const protectedLane = withPositions(open, { a11: { x: 14, y: 50 } });
    expect(assessDriveLane(protectedLane)).toMatchObject({
      openRim: false,
      rimProtectorId: "a11",
    });
  });

  it("uses the defender who is physically protecting the paint for a set-offense finish", () => {
    const protectedLane = withPositions(structuredClone(initialMatchState), {
      a11: { x: 14, y: 50 },
      a23: { x: 70, y: 80 },
    });
    const emptyPaint = withPositions(protectedLane, { a11: { x: 68, y: 88 } });
    const protectedFinish = resolveDrive(protectedLane);
    const emptyPaintFinish = resolveDrive(emptyPaint);

    expect(protectedFinish.helperId).toBe("a11");
    expect(emptyPaintFinish.helperId).toBeUndefined();
    expect(emptyPaintFinish.probability).toBeGreaterThan(protectedFinish.probability);
  });

  it("makes layup rating a primary set-offense finishing input", () => {
    const attacker = player("h1");
    const lowLayup = { ...attacker, ratings: { ...attacker.ratings, layup: 45 } };
    const highLayup = { ...attacker, ratings: { ...attacker.ratings, layup: 95 } };
    const primary = player("a9");
    const helper = player("a11");

    expect(calculateFinishChance(highLayup, primary, helper, 0.48)).toBeGreaterThan(
      calculateFinishChance(lowLayup, primary, helper, 0.48),
    );
  });
});

describe("interruptible open-rim drive", () => {
  it("moves first and releases the automatic dunk only after reaching the rim", () => {
    const fixture = openFastbreakFixture();
    const started = resolveGameAction(fixture, "drive");

    expect(started.eventLog.at(-1)?.kind).toBe("DRIVE_START_OPEN_RIM");
    expect(started.pendingDrive).toMatchObject({ laneOpenAtStart: true, handlerId: "h1" });
    expect(started.pendingShot).toBeUndefined();
    expect(started.phase).toBe("SECOND_DECISION");
    expect(started.fastbreakClock).toBeNull();
    expect(assertMatchInvariants(started)).toBe(true);

    const partway = advanceMatchTime(started, 500);
    expect(courtDistanceMeters(partway.motion.positions.h1, fixture.motion.positions.h1)).toBeGreaterThan(0.2);
    expect(partway.pendingDrive).toBeDefined();
    expect(partway.pendingShot).toBeUndefined();

    let released = partway;
    for (let frame = 0; frame < 80 && !released.pendingShot; frame += 1) {
      released = advanceMatchTime(released, 50);
    }
    expect(released.phase).toBe("SHOT_FLIGHT");
    expect(released.pendingShot).toMatchObject({ shotType: "DUNK", made: true, shooterId: "h1" });
    expect(released.pendingDrive).toBeUndefined();
    expect(released.motion.ballFlight?.start).toBeDefined();
    expect(courtDistanceMeters(released.motion.ballFlight!.start, attackRim("home"))).toBeLessThanOrEqual(2.25);
    expect(assertMatchInvariants(released)).toBe(true);
  });

  it("keeps a repeated drive input on the open-rim dunk route instead of degrading to a layup", () => {
    const started = resolveGameAction(openFastbreakFixture(), "drive");
    const repeated = resolveGameAction(started, "drive");

    expect(repeated.eventLog.at(-1)?.kind).toBe("DRIVE_CONTINUE_OPEN_RIM");
    expect(repeated.pendingDrive?.laneOpenAtStart).toBe(true);
    expect(repeated.pendingShot).toBeUndefined();
    expect(repeated.motion.routes.h1.at(-1)).toEqual(attackRim("home"));
  });

  it("turns a pass during the route into a nearest-perimeter kick-out and cancels auto-finish", () => {
    const fixture = openFastbreakFixture();
    expect(findNearestLegalPerimeterTeammate(fixture)?.id).toBe("h2");
    const started = resolveGameAction(fixture, "drive");
    const partway = advanceMatchTime(started, 250);
    const kicked = resolveGameAction(partway, "pass");

    expect(kicked.eventLog.at(-1)?.kind).toBe("PASS_RELEASE");
    expect(kicked.eventLog.at(-1)?.text).toContain("突分");
    expect(kicked.ballHandlerId).toBe("h1");
    expect(kicked.pendingPass?.toPlayerId).toBe("h2");
    expect(kicked.motion.ballFlight?.toPlayerId).toBe("h2");
    expect(kicked.advantage).toBeUndefined();
    expect(kicked.pendingDrive).toBeUndefined();
    expect(kicked.transitionClock).toBeNull();
    expect(assertMatchInvariants(kicked)).toBe(true);

    const afterCatch = advanceMatchTime(kicked, ((kicked.motion.ballFlight?.duration ?? 0) + 0.05) * 1_000);
    expect(afterCatch.ballHandlerId).toBe("h2");
    expect(afterCatch.advantage).toBe("KICK_OUT");
    expect(afterCatch.eventLog.at(-1)?.kind).toBe("PASS_ARRIVAL");
    expect(afterCatch.eventLog.some((event) => event.kind === "SHOT_RELEASE")).toBe(false);
    expect(afterCatch.pendingDrive).toBeUndefined();
  });

  it("cancels the drive atomically when the player chooses a pull-up or a screen", () => {
    const driveForShot = resolveGameAction(openFastbreakFixture(), "drive");
    const shot = resolveGameAction(driveForShot, "shoot");
    expect(shot.phase).toBe("SHOT_FLIGHT");
    expect(shot.pendingDrive).toBeUndefined();
    expect(shot.transitionClock).toBeNull();

    const driveForScreen = resolveGameAction(openFastbreakFixture(), "drive");
    const screen = resolveGameAction(driveForScreen, "screen");
    expect(screen.phase).toBe("SCREEN_APPROACH");
    expect(screen.pendingDrive).toBeUndefined();
    expect(screen.transitionClock).toBe(1.35);
  });
});

describe("one-click protected drive", () => {
  it("auto-resolves at the rim with the layup model without requiring a second drive tap", () => {
    const started = resolveGameAction({ ...structuredClone(initialMatchState), seed: 1 }, "drive");
    expect(started.eventLog.at(-1)?.kind).toBe("DRIVE_START");
    expect(started.pendingDrive).toMatchObject({ laneOpenAtStart: false });

    let released = started;
    for (let frame = 0; frame < 120 && !released.pendingShot; frame += 1) {
      released = advanceMatchTime(released, 50);
    }
    expect(released.pendingShot).toMatchObject({ shotType: "RIM", shooterId: "h1" });
    expect(released.pendingDrive).toBeUndefined();
    expect(released.motion.ballFlight?.start).toBeDefined();
    expect(courtDistanceMeters(released.motion.ballFlight!.start, attackRim("home"))).toBeLessThanOrEqual(2.25);
  });

  it("lets a single pass interrupt the protected drive before the automatic layup", () => {
    const started = resolveGameAction({ ...structuredClone(initialMatchState), seed: 1 }, "drive");
    const partway = advanceMatchTime(started, 250);
    const kicked = resolveGameAction(partway, "pass");

    expect(kicked.eventLog.at(-1)?.kind).toBe("PASS_RELEASE");
    expect(kicked.pendingDrive).toBeUndefined();
    expect(kicked.pendingShot).toBeUndefined();
    expect(kicked.advantage).toBeUndefined();
    expect(kicked.motion.ballFlight?.toPlayerId).toBe(kicked.pendingPass?.toPlayerId);
    const afterCatch = advanceMatchTime(kicked, ((kicked.motion.ballFlight?.duration ?? 0) + 0.05) * 1_000);
    expect(afterCatch.ballHandlerId).toBe(kicked.pendingPass?.toPlayerId);
    expect(afterCatch.advantage).toBe("KICK_OUT");
  });

  it("keeps the pass branch valid on the final frame before automatic layup release", () => {
    let lastPending = resolveGameAction({ ...structuredClone(initialMatchState), seed: 1 }, "drive");
    let released = advanceMatchTime(lastPending, 50);
    for (let frame = 0; frame < 120 && !released.pendingShot; frame += 1) {
      lastPending = released;
      released = advanceMatchTime(lastPending, 50);
    }

    expect(lastPending.pendingDrive).toBeDefined();
    expect(lastPending.pendingShot).toBeUndefined();
    expect(released.pendingShot).toMatchObject({ shotType: "RIM", shooterId: "h1" });

    const nearestPerimeterId = findNearestLegalPerimeterTeammate(lastPending)?.id;
    const kicked = resolveGameAction(lastPending, "pass");
    expect(kicked.eventLog.at(-1)?.kind).toBe("PASS_RELEASE");
    expect(nearestPerimeterId).toBeDefined();
    expect(kicked.ballHandlerId).toBe(lastPending.ballHandlerId);
    expect(kicked.pendingPass?.toPlayerId).toBe(nearestPerimeterId);
    expect(kicked.pendingDrive).toBeUndefined();
    expect(kicked.pendingShot).toBeUndefined();
    const afterCatch = advanceMatchTime(kicked, ((kicked.motion.ballFlight?.duration ?? 0) + 0.05) * 1_000);
    expect(afterCatch.ballHandlerId).toBe(nearestPerimeterId);
    expect(afterCatch.advantage).toBe("KICK_OUT");
    expect(afterCatch.eventLog.some((event) => event.kind === "SHOT_RELEASE")).toBe(false);
    expect(assertMatchInvariants(afterCatch)).toBe(true);
  });
});

describe("kick-out shot value", () => {
  it("gives the immediate catch a bounded advantage created by collapsing help", () => {
    const ordinary = resolveShot({ ...initialMatchState, ballHandlerId: "h2", advantage: undefined });
    const kickOut = resolveShot({ ...initialMatchState, ballHandlerId: "h2", advantage: "KICK_OUT" });
    expect(kickOut.probability).toBeGreaterThan(ordinary.probability);
    expect(kickOut.probability - ordinary.probability).toBeLessThanOrEqual(0.2);
  });
});
