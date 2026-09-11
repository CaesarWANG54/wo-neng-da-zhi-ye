import { describe, expect, it } from "vitest";
import { initialMatchState } from "./data";
import { resolveGameAction } from "./controller";
import { advanceMatchTime, beginDeadBall, beginFreeThrowSequence, startFastbreak } from "./flow";
import { classifyTap, DOUBLE_TAP_WINDOW_MS, isPendingTapStillValid, type PendingTap } from "./input";

/**
 * Clock / input fairness (P1).
 *
 * The authoritative clock lives in the pure engine (`advanceMatchTime`) and
 * must be independent of the UI's single/double-tap arbitration. These tests
 * lock down the engine-side contracts the UI relies on:
 *
 * 1. Pure elapsed time never invalidates a pending tap (a decision window is
 *    ordinary decision time — the clock keeps running and the tap stays
 *    valid until a real event changes the world).
 * 2. Every ownership-changing transition (possession, phase or ball handler)
 *    bumps `decisionEpoch`, so a queued tap can be proven stale.
 * 3. `advanceMatchTime` is monotonic: no input sequence can make the engine
 *    hand back more clock than real elapsed time allows.
 * 4. Alternating pass/shoot taps keep exactly one pending decision and can
 *    never extend a deadline: each tap's deadline is tapTime + window, and
 *    the final deadline is anchored to the newest tap, not the oldest.
 */

function pending(actionId: string, at: number, decisionEpoch: number): PendingTap {
  return { actionId, at, decisionEpoch };
}

describe("pending tap validity across engine time", () => {
  it("keeps a pending tap valid while pure match time passes without any event", () => {
    const tap = pending("pass", 0, initialMatchState.decisionEpoch);
    const advanced = advanceMatchTime(initialMatchState, 400);
    expect(advanced.decisionEpoch).toBe(initialMatchState.decisionEpoch);
    expect(advanced.gameSeconds).toBeLessThan(initialMatchState.gameSeconds);
    expect(advanced.shotClock).toBeLessThan(initialMatchState.shotClock);
    expect(isPendingTapStillValid(tap, advanced.decisionEpoch)).toBe(true);
  });

  it("never advances the shot clock or game clock backwards for larger elapsed inputs", () => {
    const short = advanceMatchTime(initialMatchState, 300);
    const long = advanceMatchTime(initialMatchState, 900);
    expect(long.gameSeconds).toBeLessThanOrEqual(short.gameSeconds);
    expect(long.shotClock).toBeLessThanOrEqual(short.shotClock);
    expect(long.gameSeconds).toBeLessThan(initialMatchState.gameSeconds - 0.8);
    expect(long.shotClock).toBeLessThan(initialMatchState.shotClock - 0.8);
  });
});

describe("decision epoch guards every queued action", () => {
  it("invalidates a pending tap when a pass commits and hands the ball to a teammate", () => {
    const before = initialMatchState;
    const tap = pending("pass", 0, before.decisionEpoch);
    const passed = resolveGameAction(before, "pass");
    expect(passed.decisionEpoch).toBe(before.decisionEpoch + 1);
    expect(isPendingTapStillValid(tap, passed.decisionEpoch)).toBe(false);
  });

  it("invalidates a pending tap when a made basket starts the dead-ball inbound", () => {
    const before = { ...initialMatchState, homeScore: 62 };
    const tap = pending("shoot", 0, before.decisionEpoch);
    const dead = beginDeadBall(
      before,
      "MADE_BASKET",
      {
        team: "away",
        spot: "BASELINE",
        reason: "MADE_BASKET",
        shotClock: 24,
        requiresAdvance: true,
        retainsPossession: false,
        gameClockContinues: false,
      },
      "三分命中 · 对方底线发球",
    );
    expect(dead.decisionEpoch).toBe(before.decisionEpoch + 1);
    expect(dead.possession).toBe("away");
    expect(isPendingTapStillValid(tap, dead.decisionEpoch)).toBe(false);
  });

  it("invalidates a pending tap when the shot clock expires into a violation", () => {
    const before = { ...initialMatchState, shotClock: 0.2 };
    const tap = pending("pass", 0, before.decisionEpoch);
    const expired = advanceMatchTime(before, 400);
    expect(expired.decisionEpoch).toBeGreaterThan(before.decisionEpoch);
    expect(expired.deadBallReason).toBe("SHOT_CLOCK_VIOLATION");
    expect(expired.possession).toBe("away");
    expect(isPendingTapStillValid(tap, expired.decisionEpoch)).toBe(false);
  });

  it("invalidates a pending tap when a free-throw sequence begins", () => {
    const before = initialMatchState;
    const tap = pending("shoot", 0, before.decisionEpoch);
    const freeThrows = beginFreeThrowSequence(before, {
      shooterId: "h3",
      total: 2,
      reason: "SHOOTING_FOUL",
      foulerId: "a9",
      liveAfterFinalMiss: true,
      seed: 2_026_090,
    });
    expect(freeThrows.phase).toBe("FREE_THROW");
    expect(freeThrows.decisionEpoch).toBe(before.decisionEpoch + 1);
    expect(isPendingTapStillValid(tap, freeThrows.decisionEpoch)).toBe(false);
  });

  it("invalidates a pending tap when a steal flips possession into a fastbreak", () => {
    const before = initialMatchState;
    const tap = pending("pass", 0, before.decisionEpoch);
    const fastbreak = startFastbreak(before, "home", "STEAL", "抢断形成快攻");
    expect(fastbreak.possession).toBe("home");
    expect(fastbreak.phase).toBe("FASTBREAK");
    expect(fastbreak.decisionEpoch).toBe(before.decisionEpoch + 1);
    expect(isPendingTapStillValid(tap, fastbreak.decisionEpoch)).toBe(false);
  });
});

describe("rapid alternating tap arbitration", () => {
  it("keeps exactly one pending decision and never combines different actions", () => {
    const epoch = 7;
    let slot: PendingTap | null = null;
    let doubles = 0;
    for (let index = 0; index < 24; index += 1) {
      const actionId = index % 2 === 0 ? "pass" : "shoot";
      const classification = classifyTap(slot, actionId, 1_000 + index * 60, epoch);
      if (classification.kind === "DOUBLE") doubles += 1;
      slot = classification.pending;
      if (classification.kind === "PENDING_SINGLE" || classification.kind === "REPLACE_PENDING") {
        expect(slot).not.toBeNull();
      }
    }
    expect(doubles).toBe(0);
    expect(slot?.actionId).toBe("shoot");
    expect(isPendingTapStillValid(slot!, epoch)).toBe(true);
  });

  it("never extends a deadline: the commit deadline stays anchored to the newest tap", () => {
    const epoch = 7;
    const taps = [1_000, 1_050, 1_110, 1_165, 1_220, 1_300, 1_355, 1_410];
    let slot: PendingTap | null = null;
    for (const at of taps) {
      const actionId = taps.indexOf(at) % 2 === 0 ? "pass" : "shoot";
      const classification = classifyTap(slot, actionId, at, epoch);
      expect(classification.kind).not.toBe("DOUBLE");
      slot = classification.pending;
    }
    // The newest tap's deadline is the only one that can ever commit.
    const newest = taps.at(-1)!;
    expect(slot!.at).toBe(newest);
    expect(isPendingTapStillValid(slot!, epoch)).toBe(true);
    // A tap arriving after the newest deadline replaces the pending entry
    // instead of resurrecting the old one, so the sequence can never push
    // the commit later than newestTap + window.
    const late = classifyTap(slot, "pass", newest + DOUBLE_TAP_WINDOW_MS + 1, epoch);
    expect(late.kind).toBe("REPLACE_PENDING");
  });

  it("upgrades only two matching taps inside one immutable window into a double", () => {
    const first = classifyTap(null, "pass", 10_000, 5);
    expect(first.kind).toBe("PENDING_SINGLE");
    const second = classifyTap(first.pending, "pass", 10_000 + DOUBLE_TAP_WINDOW_MS - 1, 5);
    expect(second.kind).toBe("DOUBLE");
    expect(second.pending).toBeNull();
    const third = classifyTap(null, "pass", 20_000, 5);
    const tooLate = classifyTap(third.pending, "pass", 20_000 + DOUBLE_TAP_WINDOW_MS + 1, 5);
    expect(tooLate.kind).toBe("REPLACE_PENDING");
  });
});
