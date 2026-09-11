import { describe, expect, it } from "vitest";
import { players } from "./data";
import { averageRating, RATING_IDS, RATING_SCHEMA_VERSION, validateRatings } from "./ratings";

describe("38-field synthetic rating foundation", () => {
  it("publishes exactly 38 unique stable fields under schema version 1", () => {
    expect(RATING_SCHEMA_VERSION).toBe(1);
    expect(RATING_IDS).toHaveLength(38);
    expect(new Set(RATING_IDS).size).toBe(38);
  });

  it("validates every prototype player as complete integer data in the 25..99 range", () => {
    for (const player of players) {
      expect(Object.keys(player.ratings)).toHaveLength(38);
      expect(validateRatings(player.ratings)).toEqual({ valid: true, errors: [] });
      expect(averageRating(player.ratings)).toBeGreaterThanOrEqual(65);
      expect(averageRating(player.ratings)).toBeLessThanOrEqual(76);
    }
  });
});
