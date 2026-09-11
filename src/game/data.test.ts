import { afterEach, describe, expect, it } from "vitest";
import { baseMatchups, configureCreatedPlayer, CREATED_PLAYER_ID, homeSetFormation, initialMatchState, playerById, players } from "./data";
import type { Position } from "./types";

const controlled = playerById.get(CREATED_PLAYER_ID)!;
const defaultRatings = structuredClone(controlled.ratings);

function resetCreatedPlayer() {
  configureCreatedPlayer({
    displayName: "Rookie One",
    number: 1,
    position: "PG",
    ratings: defaultRatings,
  });
}

afterEach(resetCreatedPlayer);

describe("created-player lineup geometry", () => {
  it("assigns every created position its role spot and same-position defender", () => {
    for (const position of ["PG", "SG", "SF", "PF", "C"] as Position[]) {
      configureCreatedPlayer({ displayName: `测试${position}`, number: 0, position, ratings: defaultRatings });

      const home = players.filter((player) => player.team === "home");
      expect(home).toHaveLength(5);
      expect(home.map((player) => player.position).sort()).toEqual(["C", "PF", "PG", "SF", "SG"]);
      expect(new Set(home.map((player) => player.position)).size).toBe(5);
      expect(controlled.position).toBe(position);
      expect(initialMatchState.motion.positions[controlled.id]).toEqual(homeSetFormation[position]);

      for (const player of home) {
        expect({ x: player.x, y: player.y }).toEqual(homeSetFormation[player.position]);
        expect(initialMatchState.motion.positions[player.id]).toEqual(homeSetFormation[player.position]);
        const opponent = playerById.get(baseMatchups[player.id]);
        expect(opponent?.team).toBe("away");
        expect(opponent?.position).toBe(player.position);
        expect(initialMatchState.currentMatchups[player.id]).toBe(opponent?.id);
      }
    }
  });

  it("rebuilds the same complete lineup deterministically on repeated configuration", () => {
    configureCreatedPlayer({ displayName: "控卫", number: 3, position: "PG", ratings: defaultRatings });
    const first = {
      roles: players.filter((player) => player.team === "home").map((player) => [player.id, player.position]),
      matchups: { ...baseMatchups },
      positions: structuredClone(initialMatchState.motion.positions),
    };
    configureCreatedPlayer({ displayName: "中锋", number: "00", position: "C", ratings: defaultRatings });
    expect(initialMatchState.motion.positions.h1).toEqual(homeSetFormation.C);
    configureCreatedPlayer({ displayName: "控卫", number: 3, position: "PG", ratings: defaultRatings });
    expect({
      roles: players.filter((player) => player.team === "home").map((player) => [player.id, player.position]),
      matchups: { ...baseMatchups },
      positions: initialMatchState.motion.positions,
    }).toEqual(first);
  });

  it("clears transient motion when a new configured match baseline is prepared", () => {
    initialMatchState.motion.routes.h1 = [{ x: 10, y: 10 }];
    initialMatchState.motion.velocities.h1 = { x: 4, y: -2 };
    initialMatchState.motion.lastActionOwnerId = "h4";
    initialMatchState.ballHandlerId = "h4";

    configureCreatedPlayer({ displayName: "新开局", number: 8, position: "SF", ratings: defaultRatings });

    expect(initialMatchState.ballHandlerId).toBe(CREATED_PLAYER_ID);
    expect(initialMatchState.motion.routes).toEqual({});
    expect(initialMatchState.motion.lastActionOwnerId).toBeUndefined();
    expect(initialMatchState.motion.velocities.h1).toEqual({ x: 0, y: 0 });
    expect(initialMatchState.motion.intents.h1).toBe("HANDLE");
    expect(initialMatchState.motion.intents.h2).toBe("HOLD");
  });
});
