import { describe, expect, it } from "vitest";
import { RATING_IDS } from "./ratings";
import type { Ratings } from "./types";
import { applyTrainingSession, createCareerProgression } from "./career-progression";
import { createCareerSeason, getCareerSeasonDescriptor } from "./career-season";
import {
  advanceCareerCalendar,
  advanceCareerProgressionToDate,
  careerWeekForDate,
} from "./career-calendar-progression";

function ratingsAt(value: number): Ratings {
  return Object.fromEntries(RATING_IDS.map((id) => [id, value])) as unknown as Ratings;
}

describe("career calendar progression", () => {
  it("uses Monday-to-Sunday training weeks from the published season start", () => {
    expect(careerWeekForDate("2026-10-19")).toBe(1);
    expect(careerWeekForDate("2026-10-25")).toBe(1);
    expect(careerWeekForDate("2026-10-26")).toBe(2);
    expect(careerWeekForDate("2026-11-02")).toBe(3);
    expect(careerWeekForDate("2027-04-11")).toBe(25);
  });

  it("derives projected-season week bounds from the season descriptor", () => {
    const projected = getCareerSeasonDescriptor(2);
    expect(careerWeekForDate("2027-10-19", projected)).toBe(1);
    expect(careerWeekForDate("2027-10-25", projected)).toBe(1);
    expect(careerWeekForDate("2027-10-26", projected)).toBe(2);
    // The projected 2027-28 span crosses leap day, so its final partial block is week 26.
    expect(careerWeekForDate("2028-04-11", projected)).toBe(26);
    expect(() => careerWeekForDate("2027-10-18", projected)).toThrow(/outside/i);
    expect(() => careerWeekForDate("2028-04-12", projected)).toThrow(/outside/i);
  });

  it("keeps training usage inside a week and resets it only after crossing Monday", () => {
    const initial = createCareerProgression(ratingsAt(70));
    const trained = applyTrainingSession(initial, {
      sessionId: "season-1-week-1-session-1",
      groupId: "SHOOTING",
      primaryRatingId: "threePoint",
      secondaryRatingIds: ["midRange", "freeThrow"],
    });
    const sunday = advanceCareerProgressionToDate(trained, "2026-10-19", "2026-10-25");
    expect(sunday).toBe(trained);
    expect(sunday.sessionsUsedThisWeek).toBe(1);

    const monday = advanceCareerProgressionToDate(trained, "2026-10-19", "2026-10-26");
    expect(monday.week).toBe(2);
    expect(monday.sessionsUsedThisWeek).toBe(0);
    expect(monday.trainedGroupsThisWeek).toEqual([]);
    expect(monday.processedWeekIds).toEqual(["season-1-week-1"]);
  });

  it("settles every crossed week once during a long calendar simulation", () => {
    const initial = createCareerProgression(ratingsAt(70));
    const advanced = advanceCareerProgressionToDate(initial, "2026-10-19", "2026-11-09");
    expect(advanced.week).toBe(4);
    expect(advanced.processedWeekIds).toEqual([
      "season-1-week-1",
      "season-1-week-2",
      "season-1-week-3",
    ]);
    const retried = advanceCareerProgressionToDate(advanced, "2026-11-09", "2026-11-09");
    expect(retried).toBe(advanced);
  });

  it("rejects invalid, out-of-season, backwards and desynchronized dates", () => {
    const initial = createCareerProgression(ratingsAt(70));
    expect(() => careerWeekForDate("2026-02-30")).toThrow(/invalid career date/i);
    expect(() => careerWeekForDate("2026-10-18")).toThrow(/outside/i);
    expect(() => advanceCareerProgressionToDate(initial, "2026-10-20", "2026-10-19")).toThrow(/backwards/i);
    expect(() => advanceCareerProgressionToDate({ ...initial, week: 2 }, "2026-10-19", "2026-10-19")).toThrow(/out of sync/i);
  });

  it("advances season games and training one chronological week at a time", () => {
    const season = createCareerSeason("LAKERS", "新秀一号", 101);
    const progression = applyTrainingSession(createCareerProgression(ratingsAt(70)), {
      sessionId: "season-1-week-1-session-1",
      groupId: "SHOOTING",
      primaryRatingId: "threePoint",
    });
    const result = advanceCareerCalendar(season, progression, "2026-11-09");

    expect(result.season.currentDate).toBe("2026-11-09");
    expect(result.progression.week).toBe(4);
    expect(result.progression.ratings.threePoint).toBe(71);
    expect(result.progression.sessionsUsedThisWeek).toBe(0);
    expect(result.progression.processedWeekIds).toEqual([
      "season-1-week-1",
      "season-1-week-2",
      "season-1-week-3",
    ]);
    expect(result.season.games.filter((game) => game.status === "FINAL").length).toBeGreaterThan(0);
    expect(season.currentDate).toBe("2026-10-19");
    expect(progression.week).toBe(1);
  });

  it("advances a projected second season and keeps progression season IDs aligned", () => {
    const season = createCareerSeason("LAKERS", "新秀一号", 101, 2);
    const progression = createCareerProgression(ratingsAt(70), { season: 2, age: 21 });
    const result = advanceCareerCalendar(season, progression, "2027-11-09");

    expect(result.season.currentDate).toBe("2027-11-09");
    expect(result.season.games.filter((game) => game.status === "FINAL").length).toBeGreaterThan(0);
    expect(result.season.games.every((game) => game.source === "PROJECTED")).toBe(true);
    expect(result.progression.season).toBe(2);
    expect(result.progression.week).toBe(4);
    expect(result.progression.processedWeekIds).toEqual([
      "season-2-week-1",
      "season-2-week-2",
      "season-2-week-3",
    ]);
  });

  it("rejects a calendar/progression season mismatch", () => {
    const season = createCareerSeason("LAKERS", "新秀一号", 101, 2);
    const firstSeasonProgression = createCareerProgression(ratingsAt(70));
    expect(() => advanceCareerCalendar(season, firstSeasonProgression, season.currentDate)).toThrow(/season 1.*season 2/i);
  });

  it("keeps a same-day calendar advance referentially stable", () => {
    const season = createCareerSeason("LAKERS", "新秀一号", 101);
    const progression = createCareerProgression(ratingsAt(70));
    expect(advanceCareerCalendar(season, progression, season.currentDate)).toEqual({ season, progression });
  });
});
