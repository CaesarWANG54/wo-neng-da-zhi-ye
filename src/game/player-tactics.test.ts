import { describe, expect, it } from "vitest";
import { selectTactic } from "./controller";
import { calculateTacticExecutionBonus } from "./core";
import { initialMatchState } from "./data";
import { homeTactics, isHomeTacticContactPair, tacticStageAt } from "./player-tactics";
import { players } from "./data";

function fresh() {
  return structuredClone(initialMatchState);
}

describe("home tactic execution", () => {
  it("gives every tactic three semantic reads and a real tactical description", () => {
    expect(homeTactics).toHaveLength(4);
    for (const tactic of homeTactics) {
      expect(tactic.entries).toHaveLength(3);
      expect(tactic.counters).toHaveLength(3);
      expect(new Set(tactic.entries).size).toBe(3);
      expect(tactic.description.length).toBeGreaterThan(8);
    }
  });

  it("never repeats an adjacent full signature when the same family is called repeatedly", () => {
    let state = fresh();
    const signatures: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      state = selectTactic(state, "HORNS");
      signatures.push(state.homeTacticExecution!.signature);
    }
    for (let index = 1; index < signatures.length; index += 1) {
      expect(signatures[index]).not.toBe(signatures[index - 1]);
    }
    expect(new Set(signatures).size).toBeGreaterThanOrEqual(4);
    expect(state.homeTacticHistory).toHaveLength(5);
    expect(state.homeTacticSignatureHistory).toHaveLength(6);
  });

  it("is deterministic for the same state and seed", () => {
    const first = selectTactic(fresh(), "STAGGER");
    const second = selectTactic(fresh(), "STAGGER");
    expect(second.homeTacticExecution).toEqual(first.homeTacticExecution);
    expect(second.seed).toBe(first.seed);
  });

  it("moves through four live stages and penalizes firing before teammates arrive", () => {
    const called = selectTactic(fresh(), "FIVE_OUT");
    expect(tacticStageAt(called).label).toBe("落位");
    expect(calculateTacticExecutionBonus(called)).toBe(-0.015);

    const ready = {
      ...called,
      shotClock: called.shotClock - 4.5,
      motion: {
        ...called.motion,
        routes: { ...called.motion.routes, [called.homeTacticExecution!.primaryPlayerId]: [] },
      },
    };
    expect(tacticStageAt(ready).label).toBe("反制");
    expect(calculateTacticExecutionBonus(ready)).toBeGreaterThanOrEqual(-0.02);
    expect(calculateTacticExecutionBonus(ready)).toBeLessThanOrEqual(0.03);
  });

  it("marks only role-compatible screen-and-mover pairs as deliberate contact", () => {
    const called = selectTactic(fresh(), "STAGGER");
    const execution = called.homeTacticExecution!;
    const primary = players.find((player) => player.id === execution.primaryPlayerId)!;
    const screener = players.find((player) => player.team === "home" && player.position === "C")!;
    const unrelatedWing = players.find((player) => player.team === "home" && player.position === "PG")!;
    expect(isHomeTacticContactPair(execution, primary, screener)).toBe(true);
    expect(isHomeTacticContactPair(execution, primary, unrelatedWing)).toBe(false);
  });
});
