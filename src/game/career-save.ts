import {
  assertFrozenConsistency,
  isPostseasonState,
  migratePostseasonStateV1,
  type PostseasonState,
} from "./career-postseason";
import {
  assertCareerProgression,
  type CareerProgressionState,
} from "./career-progression";
import {
  CAREER_MAX_SEASONS,
  getCareerSeasonDescriptor,
  type CareerSeasonState,
} from "./career-season";
import {
  assertCareerLifecycleState,
  assertPostseasonPerformanceConsistency,
  createCareerLifecycleState,
  type CareerLifecycleState,
} from "./career-season-transition";
import { postseasonPerformanceTotals } from "./career-postseason-performance";
import { assertJerseyNumber } from "./jersey-number";
import {
  creationTemplateById,
  creationTemplateLabel,
  leagueTeams,
  type CareerDestination,
  type CreatedPlayerProfile,
} from "./player-creation";
import { assertRatings, averageRating, RATING_IDS } from "./ratings";
import type { DifficultyId } from "./types";

export const CAREER_SAVE_KIND = "WO_NENG_DA_ZHI_YE_CAREER" as const;
export const CAREER_SAVE_SCHEMA_VERSION = 4 as const;
/** v1 (pre-postseason), v2 (M6B-1) and v3 (M6B-2) remain loadable. */
export const CAREER_SAVE_LEGACY_SCHEMA_VERSION = 1 as const;
export const CAREER_SAVE_POSTSEASON_V1_SCHEMA_VERSION = 2 as const;
export const CAREER_SAVE_PLAYOFF_SCHEMA_VERSION = 3 as const;

export type CareerSaveStage = "DRAFT_CEREMONY" | "CAREER_HOME";

export interface CareerSaveSettings {
  difficulty: DifficultyId;
  volume: number;
  gameMinutes: 8 | 12 | 24;
}

export interface CareerSaveData {
  stage: CareerSaveStage;
  profile: CreatedPlayerProfile;
  destination: CareerDestination;
  season: CareerSeasonState;
  progression: CareerProgressionState;
  /** M6B-3 lifecycle, postseason personal lines and immutable season summaries. */
  lifecycle: CareerLifecycleState;
  settings: CareerSaveSettings;
  /** A persisted one-way marker: M7 saves begin only after the first-year route is final. */
  firstYearRouteResolved: true;
  /** Optional M6B-2 slice: present once the regular season is frozen. Absent before postseason starts. */
  postseason?: PostseasonState;
}

/**
 * One transactional, JSON-safe root save. Browser/file/cloud IO deliberately
 * lives outside this module; React owns storage and calls these pure helpers.
 */
export interface CareerSaveEnvelope {
  kind: typeof CAREER_SAVE_KIND;
  schemaVersion: typeof CAREER_SAVE_SCHEMA_VERSION;
  saveId: string;
  revision: number;
  data: CareerSaveData;
}

export type CareerSaveParseResult =
  | { status: "VALID"; save: CareerSaveEnvelope }
  | { status: "FUTURE_VERSION"; foundVersion: number; error: string }
  | { status: "INVALID"; error: string };

/**
 * NO_SAVE and RECOVERY_REQUIRED intentionally contain no replacement career:
 * the UI returns to creation instead of silently assigning a team. A trusted
 * backup may be supplied later by calling createCareerSave explicitly.
 */
export type CareerSaveLoadResult =
  | { status: "LOADED"; save: CareerSaveEnvelope }
  | { status: "NO_SAVE"; save: null }
  | { status: "RECOVERY_REQUIRED"; reason: "CORRUPT_SAVE"; error: string; save: null }
  | { status: "FUTURE_VERSION_REJECTED"; foundVersion: number; error: string; save: null };

export type CareerSaveMutablePatch = Partial<
  Pick<CareerSaveData, "stage" | "season" | "progression" | "lifecycle" | "settings">
> & { postseason?: PostseasonState | null };
export type CareerSaveCreateData = Omit<CareerSaveData, "firstYearRouteResolved" | "postseason">
  & { postseason?: PostseasonState | null };

const difficultyIds = new Set<DifficultyId>(["ROOKIE", "PRO", "STARTER", "ALL_STAR", "HALL_OF_FAME"]);
const leagueTeamById = new Map(leagueTeams.map((team) => [team.id, team]));
const mutablePatchKeys = new Set(["stage", "season", "progression", "lifecycle", "settings", "postseason"]);
const awardIds = new Set(["MVP", "DPOY", "MIP", "COY", "ALL_LEAGUE", "ALL_DEFENSE", "ROOKIE", "ALL_ROOKIE"]);

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertSafeInteger(value: unknown, minimum: number, maximum: number, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be a safe integer from ${minimum} to ${maximum}`);
  }
}

function assertIsoDate(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be an ISO date`);
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`${label} is not a real date`);
  }
}

function assertDateInsideSeason(value: unknown, startDate: string, endDate: string, label: string): asserts value is string {
  assertIsoDate(value, label);
  if (value < startDate || value > endDate) throw new Error(`${label} is outside its career season`);
}

function sameRatings(first: CreatedPlayerProfile["ratings"], second: CreatedPlayerProfile["ratings"]) {
  return RATING_IDS.every((ratingId) => first[ratingId] === second[ratingId]);
}

function assertProfile(value: unknown): asserts value is CreatedPlayerProfile {
  assertPlainObject(value, "career-save.data.profile");
  assertNonEmptyString(value.displayName, "career-save.data.profile.displayName");
  if (value.displayName !== value.displayName.trim()) throw new Error("Career profile display name must be normalized");
  if (value.age !== 20) throw new Error("Career profile must preserve rookie age 20");
  const template = typeof value.templateId === "string" ? creationTemplateById.get(value.templateId as never) : undefined;
  if (!template || template.position !== value.position) throw new Error("Career profile template and position do not match");
  if (value.templateName !== template.name
    || value.templateReferenceName !== template.referenceName
    || value.templateLabel !== creationTemplateLabel(template)) {
    throw new Error("Career profile template metadata is inconsistent");
  }
  assertJerseyNumber(value.jerseyNumber);
  assertRatings(value.ratings as CreatedPlayerProfile["ratings"], "career-save.data.profile.ratings");
  if (typeof value.simpleAverage !== "number"
    || !Number.isFinite(value.simpleAverage)
    || Math.abs(value.simpleAverage - averageRating(value.ratings as CreatedPlayerProfile["ratings"])) > Number.EPSILON) {
    throw new Error("Career profile average is inconsistent with its ratings");
  }
}

function assertDestination(value: unknown): asserts value is CareerDestination {
  assertPlainObject(value, "career-save.data.destination");
  if (value.route !== "DRAFT" && value.route !== "DIRECT_SIGNING") throw new Error("Career destination route is invalid");
  assertPlainObject(value.team, "career-save.data.destination.team");
  const canonicalTeam = typeof value.team.id === "string" ? leagueTeamById.get(value.team.id) : undefined;
  if (!canonicalTeam
    || value.team.shortName !== canonicalTeam.shortName
    || value.team.conference !== canonicalTeam.conference
    || value.team.homeColor !== canonicalTeam.homeColor
    || value.team.contentStatus !== canonicalTeam.contentStatus) {
    throw new Error("Career destination team is unknown or inconsistent");
  }
  assertSafeInteger(value.seed, 0, 0xffff_ffff, "career-save.data.destination.seed");
  assertNonEmptyString(value.explanation, "career-save.data.destination.explanation");
  if (value.route === "DRAFT") {
    assertSafeInteger(value.draftPick, 1, 30, "career-save.data.destination.draftPick");
  } else if (value.draftPick !== undefined) {
    throw new Error("Direct signing destination cannot contain a draft pick");
  }
}

function assertGameResult(value: unknown, label: string) {
  assertPlainObject(value, label);
  assertSafeInteger(value.awayScore, 0, 300, `${label}.awayScore`);
  assertSafeInteger(value.homeScore, 0, 300, `${label}.homeScore`);
}

const seasonMetadataFields = [
  "seasonNumber",
  "seasonId",
  "scheduleRulesVersion",
  "startYear",
  "startDate",
  "endDate",
  "cupResolutionDate",
  "scheduleBasis",
] as const satisfies readonly (keyof CareerSeasonState)[];

function assertSeasonGameNamespace(gameId: string, source: CareerSeasonState["games"][number]["source"], seasonNumber: number) {
  const published = /^published-(\d+)$/.exec(gameId);
  const projected = /^season-(\d+)-projected-(\d+)$/.exec(gameId);
  const firstCup = /^dynamic-cup-([12])-(\d+)$/.exec(gameId);
  const projectedCup = /^season-(\d+)-dynamic-cup-([12])-(\d+)$/.exec(gameId);
  if (source === "PUBLISHED") {
    if (seasonNumber !== 1 || !published || Number(published[1]) < 1 || Number(published[1]) > 1_200) {
      throw new Error("Published career game ID is outside the first-season namespace");
    }
    return;
  }
  if (source === "PROJECTED") {
    if (seasonNumber === 1 || !projected || Number(projected[1]) !== seasonNumber
      || Number(projected[2]) < 1 || Number(projected[2]) > 1_200) {
      throw new Error("Projected career game ID does not match its season");
    }
    return;
  }
  const cup = seasonNumber === 1 ? firstCup : projectedCup;
  const cupSeason = seasonNumber === 1 ? 1 : Number(cup?.[1]);
  const slot = Number(cup?.[seasonNumber === 1 ? 2 : 3]);
  if (!cup || cupSeason !== seasonNumber || slot < 1 || slot > 15) {
    throw new Error("Dynamic Cup game ID does not match its season");
  }
}

function assertCareerSeason(value: unknown): asserts value is CareerSeasonState {
  assertPlainObject(value, "career-save.data.season");
  assertSafeInteger(value.seasonNumber, 1, CAREER_MAX_SEASONS, "career-save.data.season.seasonNumber");
  const descriptor = getCareerSeasonDescriptor(value.seasonNumber);
  for (const field of seasonMetadataFields) {
    if (value[field] !== descriptor[field]) throw new Error(`Career season ${field} does not match season ${value.seasonNumber}`);
  }
  if (typeof value.playerTeamId !== "string" || !leagueTeamById.has(value.playerTeamId)) {
    throw new Error("Career season player team is unknown");
  }
  assertNonEmptyString(value.playerName, "career-save.data.season.playerName");
  assertDateInsideSeason(value.currentDate, descriptor.startDate, descriptor.endDate, "career-save.data.season.currentDate");
  if (!Array.isArray(value.games) || value.games.length === 0) throw new Error("Career season games must be non-empty");
  const gameIds = new Set<string>();
  const calculatedStandings = new Map(leagueTeams.map((team) => [team.id, {
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  }]));
  for (const [index, rawGame] of value.games.entries()) {
    const label = `career-save.data.season.games[${index}]`;
    assertPlainObject(rawGame, label);
    assertNonEmptyString(rawGame.id, `${label}.id`);
    if (gameIds.has(rawGame.id)) throw new Error("Career season contains duplicate game IDs");
    gameIds.add(rawGame.id);
    assertDateInsideSeason(rawGame.date, descriptor.startDate, descriptor.endDate, `${label}.date`);
    if (typeof rawGame.awayTeamId !== "string" || !leagueTeamById.has(rawGame.awayTeamId)
      || typeof rawGame.homeTeamId !== "string" || !leagueTeamById.has(rawGame.homeTeamId)
      || rawGame.awayTeamId === rawGame.homeTeamId) {
      throw new Error(`${label} contains invalid teams`);
    }
    assertNonEmptyString(rawGame.easternTime, `${label}.easternTime`);
    if (typeof rawGame.neutralSite !== "boolean") throw new Error(`${label}.neutralSite must be boolean`);
    if (rawGame.source !== "PUBLISHED" && rawGame.source !== "PROJECTED" && rawGame.source !== "DYNAMIC_CUP") {
      throw new Error(`${label}.source is invalid`);
    }
    if ((descriptor.scheduleBasis === "PUBLISHED_2026_27" && rawGame.source === "PROJECTED")
      || (descriptor.scheduleBasis === "PROJECTED" && rawGame.source === "PUBLISHED")) {
      throw new Error(`${label}.source does not match its season schedule basis`);
    }
    assertSeasonGameNamespace(rawGame.id, rawGame.source, descriptor.seasonNumber);
    if (rawGame.status !== "SCHEDULED" && rawGame.status !== "FINAL") throw new Error(`${label}.status is invalid`);
    if (rawGame.status === "FINAL") {
      assertGameResult(rawGame.result, `${label}.result`);
      const result = rawGame.result as { awayScore: number; homeScore: number };
      const away = calculatedStandings.get(rawGame.awayTeamId)!;
      const home = calculatedStandings.get(rawGame.homeTeamId)!;
      away.pointsFor += result.awayScore;
      away.pointsAgainst += result.homeScore;
      home.pointsFor += result.homeScore;
      home.pointsAgainst += result.awayScore;
      if (result.awayScore > result.homeScore) {
        away.wins += 1;
        home.losses += 1;
      } else if (result.homeScore > result.awayScore) {
        home.wins += 1;
        away.losses += 1;
      } else {
        throw new Error(`${label}.result cannot end tied`);
      }
    } else if (rawGame.result !== undefined) {
      throw new Error(`${label} cannot have a result before it is final`);
    }
  }
  const baseScheduleSource = descriptor.scheduleBasis === "PUBLISHED_2026_27" ? "PUBLISHED" : "PROJECTED";
  const baseGameCount = value.games.filter((game) => game.source === baseScheduleSource).length;
  const cupGameCount = value.games.filter((game) => game.source === "DYNAMIC_CUP").length;
  if (baseGameCount !== 1_200 || cupGameCount !== (value.cupResolved ? 30 : 0)) {
    throw new Error("Career season schedule-source counts are inconsistent with Cup resolution");
  }

  assertPlainObject(value.standings, "career-save.data.season.standings");
  const standingKeys = Object.keys(value.standings);
  if (standingKeys.length !== leagueTeams.length || standingKeys.some((teamId) => !leagueTeamById.has(teamId))) {
    throw new Error("Career season standings must contain exactly all 30 teams");
  }
  for (const team of leagueTeams) {
    const line = value.standings[team.id];
    const label = `career-save.data.season.standings.${team.id}`;
    assertPlainObject(line, label);
    if (line.teamId !== team.id) throw new Error(`${label}.teamId does not match its key`);
    for (const field of ["wins", "losses", "pointsFor", "pointsAgainst"] as const) {
      assertSafeInteger(line[field], 0, Number.MAX_SAFE_INTEGER, `${label}.${field}`);
      if (line[field] !== calculatedStandings.get(team.id)![field]) {
        throw new Error(`${label}.${field} is inconsistent with final games`);
      }
    }
  }

  assertPlainObject(value.playerStats, "career-save.data.season.playerStats");
  const playerStatKeys = [
    "games", "points", "rebounds", "assists", "steals", "blocks", "turnovers",
    "made", "attempts", "threesMade", "threesAttempted", "freeThrowsMade", "freeThrowsAttempted",
  ] as const;
  for (const field of playerStatKeys) {
    assertSafeInteger(value.playerStats[field], 0, Number.MAX_SAFE_INTEGER, `career-save.data.season.playerStats.${field}`);
  }
  const playerStats = value.playerStats as unknown as CareerSeasonState["playerStats"];
  if (playerStats.made > playerStats.attempts
    || playerStats.threesMade > playerStats.threesAttempted
    || playerStats.threesMade > playerStats.made
    || playerStats.threesAttempted > playerStats.attempts
    || playerStats.freeThrowsMade > playerStats.freeThrowsAttempted) {
    throw new Error("Career season player shooting totals are inconsistent");
  }
  const playerFinalGames = value.games.filter((rawGame) => {
    const game = rawGame as unknown as CareerSeasonState["games"][number];
    return game.status === "FINAL" && (game.awayTeamId === value.playerTeamId || game.homeTeamId === value.playerTeamId);
  }).length;
  if (playerStats.games !== playerFinalGames) {
    throw new Error("Career season player game count does not match final team games");
  }
  assertSafeInteger(value.coins, 0, Number.MAX_SAFE_INTEGER, "career-save.data.season.coins");
  assertSafeInteger(value.seed, 0, 0xffff_ffff, "career-save.data.season.seed");
  if (typeof value.cupResolved !== "boolean") throw new Error("Career season cupResolved must be boolean");
  const expectedGameCount = value.cupResolved ? 1_230 : 1_200;
  if (value.games.length !== expectedGameCount) throw new Error(`Career season must contain exactly ${expectedGameCount} games`);
  if (!Array.isArray(value.awards)) throw new Error("Career season awards must be an array");
  for (const [index, rawAward] of value.awards.entries()) {
    const label = `career-save.data.season.awards[${index}]`;
    assertPlainObject(rawAward, label);
    if (typeof rawAward.id !== "string" || !awardIds.has(rawAward.id)) throw new Error(`${label}.id is invalid`);
    assertNonEmptyString(rawAward.label, `${label}.label`);
    assertNonEmptyString(rawAward.winnerName, `${label}.winnerName`);
    assertNonEmptyString(rawAward.reason, `${label}.reason`);
    if (rawAward.teamId !== undefined && (typeof rawAward.teamId !== "string" || !leagueTeamById.has(rawAward.teamId))) {
      throw new Error(`${label}.teamId is invalid`);
    }
  }
  if (descriptor.seasonNumber > 1 && value.awards.some((award) => award.id === "ROOKIE" || award.id === "ALL_ROOKIE")) {
    throw new Error("Rookie awards are valid only in the first career season");
  }
}

function assertSettings(value: unknown): asserts value is CareerSaveSettings {
  assertPlainObject(value, "career-save.data.settings");
  if (!difficultyIds.has(value.difficulty as DifficultyId)) throw new Error("Career save difficulty is invalid");
  assertSafeInteger(value.volume, 0, 100, "career-save.data.settings.volume");
  if (value.gameMinutes !== 8 && value.gameMinutes !== 12 && value.gameMinutes !== 24) {
    throw new Error("Career save gameMinutes must be 8, 12, or 24");
  }
}

function assertStoredPostseason(value: unknown) {
  assertPlainObject(value, "career-save.data");
  const data = value as unknown as CareerSaveData;
  const postseason = data.postseason;
  if (postseason === undefined) return; // absent is legal for migrated pre-postseason careers or an unfinished season
  if (!isPostseasonState(postseason)) {
    throw new Error("Career postseason slice is structurally invalid");
  }
  try {
    assertFrozenConsistency(data.season, postseason);
  } catch (error) {
    throw new Error(`Career postseason is inconsistent with the final schedule: ${safeError(error)}`);
  }
}

function markerSeasonNumber(gameId: string): number | null {
  const firstPublished = /^published-(\d+)$/.exec(gameId);
  if (firstPublished) {
    const id = Number(firstPublished[1]);
    return id >= 1 && id <= 1_200 ? 1 : null;
  }
  const firstCup = /^dynamic-cup-[12]-(\d+)$/.exec(gameId);
  if (firstCup) {
    const slot = Number(firstCup[1]);
    return slot >= 1 && slot <= 15 ? 1 : null;
  }
  const projected = /^season-(\d+)-projected-(\d+)$/.exec(gameId);
  if (projected) {
    const seasonNumber = Number(projected[1]);
    const id = Number(projected[2]);
    return seasonNumber >= 2 && seasonNumber <= CAREER_MAX_SEASONS && id >= 1 && id <= 1_200
      ? seasonNumber
      : null;
  }
  const projectedCup = /^season-(\d+)-dynamic-cup-[12]-(\d+)$/.exec(gameId);
  if (projectedCup) {
    const seasonNumber = Number(projectedCup[1]);
    const slot = Number(projectedCup[2]);
    return seasonNumber >= 2 && seasonNumber <= CAREER_MAX_SEASONS && slot >= 1 && slot <= 15
      ? seasonNumber
      : null;
  }
  return null;
}

function sameStringSet(first: readonly string[], second: readonly string[]) {
  return first.length === second.length && first.every((id) => second.includes(id));
}

function sameJsonValue(first: unknown, second: unknown) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function assertSettledCurrentSeason(data: CareerSaveData, summary: CareerLifecycleState["completedSeasons"][number]) {
  const { lifecycle, postseason, season } = data;
  const standing = season.standings[season.playerTeamId];
  if (summary.wins !== standing.wins
    || summary.losses !== standing.losses
    || !sameJsonValue(summary.regularSeasonStats, season.playerStats)
    || !sameJsonValue(summary.awards, season.awards)
    || summary.postseasonCoverage !== lifecycle.postseasonPerformance.coverage
    || !sameJsonValue(summary.playInStats, postseasonPerformanceTotals(lifecycle.postseasonPerformance, "PLAY_IN"))
    || !sameJsonValue(summary.playoffStats, postseasonPerformanceTotals(lifecycle.postseasonPerformance, "PLAYOFF"))
    || !sameJsonValue(summary.postseasonStats, postseasonPerformanceTotals(lifecycle.postseasonPerformance))
    || summary.eastChampionTeamId !== postseason?.playoffs.conferenceChampionTeamIds.EAST
    || summary.westChampionTeamId !== postseason?.playoffs.conferenceChampionTeamIds.WEST
    || summary.championTeamId !== postseason?.playoffs.championTeamId) {
    throw new Error("Settled current-season summary differs from its source slices");
  }
}

function assertLifecycleCrossSlice(data: CareerSaveData) {
  const { lifecycle, progression, season } = data;
  if (lifecycle.currentSeasonNumber !== season.seasonNumber) {
    throw new Error("Career lifecycle and current season numbers differ");
  }
  if (lifecycle.postseasonPerformance.playerTeamId !== season.playerTeamId) {
    throw new Error("Career postseason performance belongs to another team");
  }
  try {
    assertPostseasonPerformanceConsistency(lifecycle.postseasonPerformance, data.postseason);
  } catch (error) {
    throw new Error(`Career postseason performance is inconsistent: ${safeError(error)}`);
  }

  const completed = lifecycle.completedSeasons;
  const pending = lifecycle.pendingSeasonSummaryId === null
    ? null
    : completed.find((summary) => summary.id === lifecycle.pendingSeasonSummaryId) ?? null;
  const expectedCompletedCount = pending || progression.retired
    ? season.seasonNumber
    : season.seasonNumber - 1;
  if (completed.length !== expectedCompletedCount) {
    throw new Error("Career season-summary history is not contiguous with the current season");
  }
  for (const [index, summary] of completed.entries()) {
    if (summary.seasonNumber !== index + 1
      || summary.teamId !== season.playerTeamId
      || summary.ageBefore !== 20 + index
      || summary.ageAfter !== 21 + index) {
      throw new Error("Career season-summary identity or age chain is inconsistent");
    }
    const ledgerDeclines = progression.ledger
      .filter((entry) => entry.source === "AGE" && entry.age === summary.ageAfter)
      .map(({ ratingId, previousValue, nextValue }) => ({ ratingId, previousValue, nextValue }));
    if (!sameJsonValue(summary.ageDeclines, ledgerDeclines)) {
      throw new Error("Career age-decline summary differs from the permanent rating ledger");
    }
  }
  const expectedAge = 20 + completed.length;
  if (progression.age !== expectedAge) throw new Error("Career age does not match completed season history");

  const completionIds = completed.map((summary) => summary.seasonCompletionEventId);
  if (!sameStringSet(progression.processedSeasonIds, completionIds)) {
    throw new Error("Career progression season ledger differs from completed summaries");
  }
  const expectedAcknowledged = completed
    .filter((summary) => summary.id !== lifecycle.pendingSeasonSummaryId)
    .map((summary) => summary.id);
  if (!sameStringSet(lifecycle.acknowledgedSeasonSummaryIds, expectedAcknowledged)) {
    throw new Error("Career season-summary acknowledgements are incomplete or forged");
  }

  if (pending) {
    if (pending.seasonNumber !== season.seasonNumber
      || pending.seasonId !== season.seasonId
      || pending.startDate !== season.startDate
      || pending.endDate !== season.endDate
      || pending.scheduleBasis !== season.scheduleBasis
      || pending.teamId !== season.playerTeamId) {
      throw new Error("Pending career summary differs from the settled current season");
    }
    assertSettledCurrentSeason(data, pending);
    if (!data.postseason
      || data.postseason.playoffs.status !== "COMPLETE"
      || data.postseason.playoffs.seasonCompletionEventId !== pending.seasonCompletionEventId) {
      throw new Error("Pending career summary lacks its completed postseason");
    }
    const expectedProgressionSeason = progression.retired ? season.seasonNumber : season.seasonNumber + 1;
    if (progression.season !== expectedProgressionSeason || pending.retired !== progression.retired) {
      throw new Error("Pending career summary and progression transition differ");
    }
  } else if (progression.retired) {
    const finalSummary = completed.at(-1);
    if (!finalSummary?.retired
      || finalSummary.seasonNumber !== season.seasonNumber
      || finalSummary.seasonId !== season.seasonId
      || finalSummary.seasonCompletionEventId !== data.postseason?.playoffs.seasonCompletionEventId
      || data.postseason?.playoffs.status !== "COMPLETE"
      || progression.season !== season.seasonNumber
      || season.seasonNumber !== CAREER_MAX_SEASONS) {
      throw new Error("Retired career does not have one acknowledged final season");
    }
    assertSettledCurrentSeason(data, finalSummary);
  } else if (progression.season !== season.seasonNumber) {
    throw new Error("Active career progression and season numbers differ");
  }
}

function assertCareerSaveData(value: unknown): asserts value is CareerSaveData {
  assertPlainObject(value, "career-save.data");
  if (value.stage !== "DRAFT_CEREMONY" && value.stage !== "CAREER_HOME") throw new Error("Career save stage is invalid");
  if (value.firstYearRouteResolved !== true) throw new Error("Career save first-year route must be resolved");
  assertProfile(value.profile);
  assertDestination(value.destination);
  assertCareerSeason(value.season);
  assertCareerProgression(value.progression, "career-save.data.progression");
  assertCareerLifecycleState(value.lifecycle, "career-save.data.lifecycle");
  assertSettings(value.settings);

  const isUndraftedCeremony = value.destination.route === "DIRECT_SIGNING"
    && value.destination.explanation.startsWith("未进入首轮");
  if (value.stage === "DRAFT_CEREMONY" && value.destination.route !== "DRAFT" && !isUndraftedCeremony) {
    throw new Error("Draft ceremony requires a drafted player or a first-round undrafted signing");
  }
  if (value.stage === "DRAFT_CEREMONY"
    && (value.season.seasonNumber !== 1
      || value.lifecycle.completedSeasons.length !== 0
      || value.lifecycle.pendingSeasonSummaryId !== null
      || value.postseason !== undefined)) {
    throw new Error("Draft ceremony is valid only before the first career season begins");
  }
  if (value.season.playerTeamId !== value.destination.team.id) throw new Error("Career season and destination teams differ");
  if (value.season.playerName !== value.profile.displayName) throw new Error("Career season and profile player names differ");
  if (!sameRatings(value.profile.ratings, value.progression.rookieBaseline)) {
    throw new Error("Career progression rookie baseline differs from the created profile");
  }
  if (value.season.coins !== value.progression.coins) throw new Error("Career coin balances differ across saved slices");
  assertStoredPostseason(value);
  assertLifecycleCrossSlice(value as unknown as CareerSaveData);

  const rewardPrefix = "career-game:";
  const rewardSuffix = ":reward";
  const outcomeSuffix = ":outcome";
  const rewardGameIds = new Set(value.progression.processedRewardIds
    .filter((id) => id.startsWith(rewardPrefix) && id.endsWith(rewardSuffix))
    .map((id) => id.slice(rewardPrefix.length, -rewardSuffix.length)));
  const outcomeGameIds = new Set(value.progression.processedChemistryEventIds
    .filter((id) => id.startsWith(rewardPrefix) && id.endsWith(outcomeSuffix))
    .map((id) => id.slice(rewardPrefix.length, -outcomeSuffix.length)));
  const markedGameIds = new Set([...rewardGameIds, ...outcomeGameIds]);
  for (const gameId of markedGameIds) {
    if (!gameId || !rewardGameIds.has(gameId) || !outcomeGameIds.has(gameId)) {
      throw new Error("Career game reward and outcome settlement markers must be paired");
    }
    const game = value.season.games.find((candidate) => candidate.id === gameId);
    if (game) {
      if (game.status !== "FINAL"
        || (game.awayTeamId !== value.season.playerTeamId && game.homeTeamId !== value.season.playerTeamId)) {
        throw new Error("Career game settlement marker must reference a final player-team game");
      }
      continue;
    }
    const historicalSeason = markerSeasonNumber(gameId);
    if (historicalSeason === null
      || historicalSeason >= value.season.seasonNumber
      || !value.lifecycle.completedSeasons.some((summary) => summary.seasonNumber === historicalSeason)) {
      throw new Error("Historical career game marker must belong to an archived season");
    }
  }
}

export function assertCareerSaveEnvelope(value: unknown): asserts value is CareerSaveEnvelope {
  assertPlainObject(value, "career-save");
  if (value.kind !== CAREER_SAVE_KIND) throw new Error("Career save kind is invalid");
  if (value.schemaVersion !== CAREER_SAVE_SCHEMA_VERSION) throw new Error("Career save schema version is unsupported");
  assertNonEmptyString(value.saveId, "career-save.saveId");
  if (value.saveId !== value.saveId.trim()) throw new Error("Career save ID must be normalized");
  assertSafeInteger(value.revision, 1, Number.MAX_SAFE_INTEGER, "career-save.revision");
  assertCareerSaveData(value.data);
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown career save error";
}

/** Creates a root save only after a real first-year destination has been resolved. */
export function createCareerSave(
  saveId: string,
  data: CareerSaveCreateData,
): CareerSaveEnvelope {
  assertNonEmptyString(saveId, "career-save.saveId");
  const normalizedData = jsonClone(data) as CareerSaveCreateData;
  if (normalizedData.postseason === null) delete normalizedData.postseason;
  const save: CareerSaveEnvelope = {
    kind: CAREER_SAVE_KIND,
    schemaVersion: CAREER_SAVE_SCHEMA_VERSION,
    saveId: saveId.trim(),
    revision: 1,
    data: { ...normalizedData, firstYearRouteResolved: true } as CareerSaveData,
  };
  assertCareerSaveEnvelope(save);
  return save;
}

export function serializeCareerSave(save: CareerSaveEnvelope): string {
  assertCareerSaveEnvelope(save);
  return JSON.stringify(save);
}

function migrateLegacySeasonMetadata(value: unknown): CareerSeasonState {
  assertPlainObject(value, "career-save.data.season");
  const presentMetadata = seasonMetadataFields.filter((field) => value[field] !== undefined);
  if (presentMetadata.length === 0) {
    return {
      ...jsonClone(value),
      ...getCareerSeasonDescriptor(1),
    } as unknown as CareerSeasonState;
  }
  // Partially-written metadata is corruption, not a migration opportunity.
  if (presentMetadata.length !== seasonMetadataFields.length) {
    throw new Error("Legacy career season has partial multi-season metadata");
  }
  return jsonClone(value) as unknown as CareerSeasonState;
}

/**
 * Upgrades a root v1/v2/v3 envelope without changing its save revision or any
 * gameplay revision/event. Pre-v4 roots did not own season metadata or the
 * lifecycle slice. Completed player postseason games are therefore retained
 * as explicit PARTIAL_LEGACY coverage rather than assigned fabricated stats.
 */
function migrateLegacyCareerSave(value: Record<string, unknown>): CareerSaveEnvelope {
  assertPlainObject(value.data, "career-save.data");
  const data = value.data;
  const season = migrateLegacySeasonMetadata(data.season);
  const storedPostseason = data.postseason;
  let postseason: PostseasonState | undefined;
  if (storedPostseason !== undefined) {
    if (isPostseasonState(storedPostseason)) {
      postseason = jsonClone(storedPostseason);
    } else {
      postseason = migratePostseasonStateV1(season, storedPostseason);
    }
  }
  const lifecycle = createCareerLifecycleState(season.playerTeamId, season.seasonNumber, {
    legacyPostseason: postseason,
  });
  const migrated = {
    ...value,
    schemaVersion: CAREER_SAVE_SCHEMA_VERSION,
    data: {
      ...data,
      season,
      lifecycle,
      ...(postseason === undefined ? {} : { postseason }),
    },
  } as unknown as CareerSaveEnvelope;
  assertCareerSaveEnvelope(migrated);
  return jsonClone(migrated);
}

export function parseCareerSave(serialized: string): CareerSaveParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    return { status: "INVALID", error: safeError(error) };
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const schemaVersion = (parsed as Record<string, unknown>).schemaVersion;
    if (Number.isSafeInteger(schemaVersion) && (schemaVersion as number) > CAREER_SAVE_SCHEMA_VERSION) {
      return {
        status: "FUTURE_VERSION",
        foundVersion: schemaVersion as number,
        error: `Career save version ${schemaVersion as number} is newer than supported version ${CAREER_SAVE_SCHEMA_VERSION}`,
      };
    }
    if (schemaVersion === CAREER_SAVE_LEGACY_SCHEMA_VERSION
      || schemaVersion === CAREER_SAVE_POSTSEASON_V1_SCHEMA_VERSION
      || schemaVersion === CAREER_SAVE_PLAYOFF_SCHEMA_VERSION) {
      // v1, v2 and v3 careers are valid; migrate in memory to the current root.
      try {
        return { status: "VALID", save: migrateLegacyCareerSave(parsed as Record<string, unknown>) };
      } catch (error) {
        return { status: "INVALID", error: safeError(error) };
      }
    }
  }
  try {
    assertCareerSaveEnvelope(parsed);
    return { status: "VALID", save: jsonClone(parsed) };
  } catch (error) {
    return { status: "INVALID", error: safeError(error) };
  }
}

/** Reads stored JSON without IO and without inventing a replacement team. */
export function loadCareerSave(serialized: string | null | undefined): CareerSaveLoadResult {
  if (serialized === null || serialized === undefined || serialized.trim().length === 0) {
    return { status: "NO_SAVE", save: null };
  }
  const parsed = parseCareerSave(serialized);
  if (parsed.status === "VALID") return { status: "LOADED", save: parsed.save };
  if (parsed.status === "FUTURE_VERSION") {
    return {
      status: "FUTURE_VERSION_REJECTED",
      foundVersion: parsed.foundVersion,
      error: parsed.error,
      save: null,
    };
  }
  return { status: "RECOVERY_REQUIRED", reason: "CORRUPT_SAVE", error: parsed.error, save: null };
}

/**
 * Atomically updates mutable career slices. Profile/destination and the route
 * marker are intentionally absent and cannot be rewritten after creation.
 */
export function updateCareerSave(save: CareerSaveEnvelope, patch: CareerSaveMutablePatch): CareerSaveEnvelope {
  assertCareerSaveEnvelope(save);
  assertPlainObject(patch, "career-save patch");
  const unexpectedKey = Object.keys(patch).find((key) => !mutablePatchKeys.has(key));
  if (unexpectedKey) throw new Error(`Career save patch cannot update ${unexpectedKey}`);
  if (save.data.stage === "CAREER_HOME" && patch.stage === "DRAFT_CEREMONY") {
    throw new Error("Career save cannot return to the draft ceremony");
  }
  const nextData: CareerSaveData = {
    ...save.data,
    ...(patch.stage === undefined ? {} : { stage: patch.stage }),
    ...(patch.season === undefined ? {} : { season: jsonClone(patch.season) }),
    ...(patch.progression === undefined ? {} : { progression: jsonClone(patch.progression) }),
    ...(patch.lifecycle === undefined ? {} : { lifecycle: jsonClone(patch.lifecycle) }),
    ...(patch.settings === undefined ? {} : { settings: jsonClone(patch.settings) }),
    ...(patch.postseason === undefined || patch.postseason === null
      ? {}
      : { postseason: jsonClone(patch.postseason) }),
  };
  if (patch.postseason === null) delete nextData.postseason;
  const next: CareerSaveEnvelope = {
    ...save,
    revision: save.revision + 1,
    data: nextData,
  };
  assertCareerSaveEnvelope(next);
  return next;
}
