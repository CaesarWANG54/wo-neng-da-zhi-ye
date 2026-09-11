import { describe, expect, it } from "vitest";
import { regularSeasonSchedule2026 } from "./schedule-2026";

describe("2026-27 published schedule import", () => {
  it("contains every one of the 1200 assigned games exactly once", () => {
    expect(regularSeasonSchedule2026).toHaveLength(1200);
    expect(new Set(regularSeasonSchedule2026.map(([gameId]) => gameId)).size).toBe(1200);
    expect(regularSeasonSchedule2026[0]).toEqual([1, "2026-10-20", "CELTICS", "PISTONS", "3:00PM", false]);
    expect(regularSeasonSchedule2026.at(-1)?.[0]).toBe(1200);
  });

  it("gives all 30 teams 80 assigned games without a same-day duplicate", () => {
    const teams = new Set(regularSeasonSchedule2026.flatMap(([, , away, home]) => [away, home]));
    expect(teams.size).toBe(30);
    for (const teamId of teams) {
      const games = regularSeasonSchedule2026.filter(([, , away, home]) => away === teamId || home === teamId);
      expect(games).toHaveLength(80);
      expect(new Set(games.map(([, date]) => date)).size).toBe(80);
    }
  });

  it("keeps the 30 Cup-derived games outside the fixed source table", () => {
    expect(regularSeasonSchedule2026.some(([gameId]) => gameId > 1200)).toBe(false);
    expect(regularSeasonSchedule2026.some(([, date]) => date >= "2026-12-04" && date <= "2026-12-10")).toBe(false);
  });
});
