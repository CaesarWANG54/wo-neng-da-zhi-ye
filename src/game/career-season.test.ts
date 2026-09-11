import { describe, expect, it } from "vitest";
import { createPlayerProfile } from "./player-creation";
import {
  CAREER_MAX_SEASONS,
  CAREER_SCHEDULE_RULES_VERSION,
  CAREER_SEASON_END,
  careerGameReward,
  createCareerSeason,
  getCareerSeasonCupGameDates,
  getCareerSeasonDescriptor,
  getTeamCalendar,
  playerAverages,
  simulateCreatedPlayerStatLine,
  simulateCareerToDate,
} from "./career-season";

const profile = createPlayerProfile({ displayName: "林远", position: "PG", templateId: "PG_FLOOR_GENERAL", jerseyNumber: 1 });

describe("career season calendar", () => {
  it("starts with 1200 fixed games and two honest Cup placeholders per team", () => {
    const state = createCareerSeason("WIZARDS", profile.displayName);
    expect(state).toMatchObject({
      seasonNumber: 1,
      seasonId: "2026-27",
      scheduleRulesVersion: CAREER_SCHEDULE_RULES_VERSION,
      startYear: 2026,
      startDate: "2026-10-19",
      endDate: "2027-04-11",
      cupResolutionDate: "2026-12-04",
      scheduleBasis: "PUBLISHED_2026_27",
    });
    expect(state.games).toHaveLength(1200);
    expect(state.games[0]).toMatchObject({ id: "published-1", date: "2026-10-20", source: "PUBLISHED" });
    expect(getTeamCalendar(state)).toHaveLength(82);
    expect(getTeamCalendar(state).filter((game) => game.status === "TBD")).toHaveLength(2);
    expect(getTeamCalendar(state).filter((game) => game.status === "TBD").map((game) => game.id)).toEqual([
      "cup-tbd-1-WIZARDS",
      "cup-tbd-2-WIZARDS",
    ]);
    expect(state.cupResolved).toBe(false);
  });

  it("describes bounded career seasons and labels every post-launch schedule as projected", () => {
    expect(getCareerSeasonDescriptor(2)).toEqual({
      seasonNumber: 2,
      seasonId: "2027-28",
      scheduleRulesVersion: CAREER_SCHEDULE_RULES_VERSION,
      startYear: 2027,
      startDate: "2027-10-19",
      endDate: "2028-04-11",
      cupResolutionDate: "2027-12-04",
      scheduleBasis: "PROJECTED",
    });
    expect(getCareerSeasonCupGameDates(2)).toEqual(["2027-12-05", "2027-12-09"]);
    expect(getCareerSeasonDescriptor(CAREER_MAX_SEASONS).seasonId).toBe("2045-46");
    expect(() => getCareerSeasonDescriptor(0)).toThrow(/integer from 1/i);
    expect(() => getCareerSeasonDescriptor(CAREER_MAX_SEASONS + 1)).toThrow(/integer from 1/i);
    expect(() => getCareerSeasonDescriptor(1.5)).toThrow(/integer from 1/i);

    const first = createCareerSeason("WIZARDS", profile.displayName, 101);
    const projected = createCareerSeason("WIZARDS", profile.displayName, 101, 2);
    expect(projected.games).toHaveLength(1200);
    expect(projected.games.every((game) => game.source === "PROJECTED")).toBe(true);
    expect(projected.games[0]).toMatchObject({
      id: "season-2-projected-1",
      date: "2027-10-20",
      source: "PROJECTED",
    });
    const firstIds = new Set(first.games.map((game) => game.id));
    expect(projected.games.every((game) => !firstIds.has(game.id))).toBe(true);
    expect(getTeamCalendar(projected)).toHaveLength(82);
    expect(getTeamCalendar(projected).filter((game) => game.status === "TBD").map((game) => game.id)).toEqual([
      "2027-28-cup-tbd-1-WIZARDS",
      "2027-28-cup-tbd-2-WIZARDS",
    ]);
  });

  it("resolves exactly 30 dynamic Cup games before simulating their dates", () => {
    const resolved = simulateCareerToDate(createCareerSeason("WIZARDS", profile.displayName), "2026-12-04", profile.ratings);
    expect(resolved.cupResolved).toBe(true);
    expect(resolved.games).toHaveLength(1230);
    const dynamicGames = resolved.games.filter((game) => game.source === "DYNAMIC_CUP");
    expect(dynamicGames).toHaveLength(30);
    expect(new Set(dynamicGames.map((game) => [game.awayTeamId, game.homeTeamId].sort().join(":"))).size).toBe(30);
    for (const teamId of Object.keys(resolved.standings)) {
      expect(getTeamCalendar(resolved, teamId)).toHaveLength(82);
      expect(dynamicGames.filter((game) => game.homeTeamId === teamId)).toHaveLength(1);
      expect(dynamicGames.filter((game) => game.awayTeamId === teamId)).toHaveLength(1);
    }
  });

  it("simulates the complete league, player line, standings and season awards", () => {
    const final = simulateCareerToDate(createCareerSeason("WIZARDS", profile.displayName), CAREER_SEASON_END, profile.ratings);
    expect(final.games).toHaveLength(1230);
    expect(final.games.every((game) => game.status === "FINAL")).toBe(true);
    expect(final.playerStats.games).toBe(82);
    expect(final.awards.map((award) => award.id)).toEqual(["MVP", "DPOY", "MIP", "COY", "ALL_LEAGUE", "ALL_DEFENSE", "ROOKIE", "ALL_ROOKIE"]);
    for (const standing of Object.values(final.standings)) expect(standing.wins + standing.losses).toBe(82);
    for (const game of final.games) {
      expect(game.result!.awayScore).toBeGreaterThanOrEqual(85);
      expect(game.result!.homeScore).toBeLessThanOrEqual(139);
      expect(game.result!.awayScore).not.toBe(game.result!.homeScore);
    }
    const averages = playerAverages(final.playerStats);
    expect(averages.points).toBeGreaterThan(0);
    expect(averages.points).toBeLessThan(45);
    expect(averages.fieldGoalPercentage).toBeGreaterThanOrEqual(0.35);
    expect(averages.fieldGoalPercentage).toBeLessThanOrEqual(0.62);
  });

  it("finishes a projected second season with 82 games per team and no rookie awards", () => {
    const state = createCareerSeason("WIZARDS", profile.displayName, 101, 2);
    const final = simulateCareerToDate(state, state.endDate, profile.ratings);
    const dynamicGames = final.games.filter((game) => game.source === "DYNAMIC_CUP");
    expect(final.games).toHaveLength(1230);
    expect(final.games.every((game) => game.status === "FINAL")).toBe(true);
    expect(dynamicGames).toHaveLength(30);
    expect(dynamicGames.every((game) => game.id.startsWith("season-2-dynamic-cup-"))).toBe(true);
    expect(final.playerStats.games).toBe(82);
    expect(final.awards.map((award) => award.id)).toEqual(["MVP", "DPOY", "MIP", "COY", "ALL_LEAGUE", "ALL_DEFENSE"]);
    for (const standing of Object.values(final.standings)) expect(standing.wins + standing.losses).toBe(82);
    expect(() => simulateCareerToDate(state, "2028-04-12", profile.ratings)).toThrow(/beyond/i);
  });

  it("exposes a deterministic single-game created-player line for postseason reuse", () => {
    const first = simulateCreatedPlayerStatLine(profile.ratings, 123_456, 108);
    const repeated = simulateCreatedPlayerStatLine(profile.ratings, 123_456, 108);
    expect(repeated).toEqual(first);
    expect(first.line.points).toBeLessThanOrEqual(108);
    expect(first.line.made).toBeLessThanOrEqual(first.line.attempts);
    expect(first.line.threesMade).toBeLessThanOrEqual(first.line.threesAttempted);
    expect(first.line.freeThrowsMade).toBeLessThanOrEqual(first.line.freeThrowsAttempted);
    expect(first.seed).not.toBe(123_456);
  });

  it("does not publish awards while a deferred final-day game is still unplayed", () => {
    const state = createCareerSeason("WIZARDS", profile.displayName);
    const finalDayGame = state.games.find((game) => game.date === CAREER_SEASON_END)!;
    const deferred = simulateCareerToDate(state, CAREER_SEASON_END, profile.ratings, { deferGameIds: [finalDayGame.id] });
    expect(deferred.games.find((game) => game.id === finalDayGame.id)?.status).toBe("SCHEDULED");
    expect(deferred.awards).toEqual([]);
    const completed = simulateCareerToDate(deferred, CAREER_SEASON_END, profile.ratings);
    expect(completed.games.every((game) => game.status === "FINAL")).toBe(true);
    expect(completed.awards).toHaveLength(8);
  });

  it("keeps simulated games from becoming a free coin loop and preserves played rewards", () => {
    expect(careerGameReward("ROOKIE", true)).toBe(90);
    expect(careerGameReward("PRO", true)).toBe(240);
    expect(careerGameReward("STARTER", true)).toBe(300);
    expect(careerGameReward("ALL_STAR", true)).toBe(330);
    expect(careerGameReward("HALL_OF_FAME", true)).toBe(390);
    expect(careerGameReward("ROOKIE", true, 24)).toBe(130);
    expect(careerGameReward("HALL_OF_FAME", true, 24)).toBe(565);
    expect(careerGameReward("HALL_OF_FAME", false)).toBe(0);
  });

  it("rejects backwards and out-of-season simulation", () => {
    const state = createCareerSeason("WIZARDS", profile.displayName);
    expect(() => simulateCareerToDate(state, "2026-10-18", profile.ratings)).toThrow(/backwards/);
    expect(() => simulateCareerToDate(state, "2027-04-12", profile.ratings)).toThrow(/beyond/);
  });
});
