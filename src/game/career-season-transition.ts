import {
  assertPostseasonPerformanceState,
  createPostseasonPerformanceState,
  postseasonPerformanceTotals,
  type CareerPostseasonPerformanceState,
  type PostseasonPerformanceCompetition,
} from "./career-postseason-performance";
import type { PlayoffRound } from "./career-playoffs";
import {
  assertFrozenConsistency,
  isPostseasonState,
  REGULAR_SEASON_TOTAL_GAMES,
  type PostseasonState,
} from "./career-postseason";
import {
  assertCareerProgression,
  completeCareerSeason,
  type CareerProgressionState,
  type ProgressionLedgerEntry,
} from "./career-progression";
import {
  CAREER_MAX_SEASONS,
  CAREER_SCHEDULE_RULES_VERSION,
  createCareerSeason,
  getCareerSeasonDescriptor,
  type CareerAward,
  type CareerSeasonState,
  type PlayerSeasonLine,
} from "./career-season";
import { leagueTeams } from "./player-creation";
import { RATING_IDS, type RatingId } from "./ratings";

export const CAREER_LIFECYCLE_SCHEMA_VERSION = 1 as const;

export type CareerPostseasonFinish =
  | "MISSED_POSTSEASON"
  | "PLAY_IN"
  | PlayoffRound
  | "CHAMPION";

export interface CareerAgeDeclineSummary {
  ratingId: RatingId;
  previousValue: number;
  nextValue: number;
}

export interface RetirementNotice {
  id: string;
  playerName: string;
  teamId: string;
  age: number;
  kind: "LEAGUE" | "CREATED_PLAYER";
  contentStatus: "SYNTHETIC" | "APPROVED";
  reason: string;
}

export interface ApprovedRetirementContentEvent {
  id: string;
  seasonNumber: number;
  playerName: string;
  teamId: string;
  age: number;
  reason: string;
  rightsStatus: "APPROVED" | "REVIEW" | "BLOCKED";
}

export interface CareerSeasonSummary {
  id: string;
  seasonNumber: number;
  seasonId: string;
  startDate: string;
  endDate: string;
  scheduleBasis: CareerSeasonState["scheduleBasis"];
  scheduleRulesVersion: CareerSeasonState["scheduleRulesVersion"];
  teamId: string;
  wins: number;
  losses: number;
  ageBefore: number;
  ageAfter: number;
  retired: boolean;
  regularSeasonStats: PlayerSeasonLine;
  postseasonCoverage: CareerPostseasonPerformanceState["coverage"];
  playInStats: PlayerSeasonLine;
  playoffStats: PlayerSeasonLine;
  postseasonStats: PlayerSeasonLine;
  awards: CareerAward[];
  postseasonFinish: CareerPostseasonFinish;
  eastChampionTeamId: string;
  westChampionTeamId: string;
  championTeamId: string;
  seasonCompletionEventId: string;
  ageDeclines: CareerAgeDeclineSummary[];
  retirementNotices: RetirementNotice[];
}

export interface CareerLifecycleState {
  schemaVersion: typeof CAREER_LIFECYCLE_SCHEMA_VERSION;
  currentSeasonNumber: number;
  postseasonPerformance: CareerPostseasonPerformanceState;
  completedSeasons: CareerSeasonSummary[];
  pendingSeasonSummaryId: string | null;
  acknowledgedSeasonSummaryIds: string[];
}

export interface FinalPlayerPostseasonGame {
  gameId: string;
  eventId: string;
  competition: PostseasonPerformanceCompetition;
  round?: PlayoffRound;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
}

export type CareerSeasonTransitionResult =
  | {
      status: "APPLIED";
      lifecycle: CareerLifecycleState;
      progression: CareerProgressionState;
      summary: CareerSeasonSummary;
    }
  | {
      status: "NOOP" | "NOT_READY" | "REJECTED";
      lifecycle: CareerLifecycleState;
      progression: CareerProgressionState;
      reason: string;
    };

export type BeginNextCareerSeasonResult =
  | {
      status: "APPLIED";
      lifecycle: CareerLifecycleState;
      progression: CareerProgressionState;
      season: CareerSeasonState;
    }
  | {
      status: "NOOP" | "REJECTED";
      lifecycle: CareerLifecycleState;
      progression: CareerProgressionState;
      reason: string;
    };

const teamIds = new Set(leagueTeams.map((team) => team.id));
const ratingIds = new Set<RatingId>(RATING_IDS);
const finishValues = new Set<CareerPostseasonFinish>([
  "MISSED_POSTSEASON",
  "PLAY_IN",
  "FIRST_ROUND",
  "CONFERENCE_SEMIFINALS",
  "CONFERENCE_FINALS",
  "FINALS",
  "CHAMPION",
]);
const statFields = [
  "games",
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "made",
  "attempts",
  "threesMade",
  "threesAttempted",
  "freeThrowsMade",
  "freeThrowsAttempted",
] as const satisfies readonly (keyof PlayerSeasonLine)[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be a normalized non-empty string`);
  }
}

function assertInteger(value: unknown, minimum: number, maximum: number, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
}

function assertPlayerTotals(value: unknown, label: string): asserts value is PlayerSeasonLine {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  for (const field of statFields) assertInteger(value[field], 0, Number.MAX_SAFE_INTEGER, `${label}.${field}`);
  const totals = value as unknown as PlayerSeasonLine;
  if (totals.made > totals.attempts
    || totals.threesMade > totals.threesAttempted
    || totals.threesMade > totals.made
    || totals.threesAttempted > totals.attempts
    || totals.freeThrowsMade > totals.freeThrowsAttempted) {
    throw new Error(`${label} has inconsistent shooting totals`);
  }
  const derivedPoints = (totals.made - totals.threesMade) * 2
    + totals.threesMade * 3
    + totals.freeThrowsMade;
  if (derivedPoints !== totals.points) throw new Error(`${label}.points do not match shooting totals`);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function finalPlayerPostseasonGames(postseason: PostseasonState, playerTeamId: string) {
  const games: FinalPlayerPostseasonGame[] = [];
  for (const conference of ["EAST", "WEST"] as const) {
    const bracket = postseason.playIn[conference];
    for (const game of [bracket.gameA, bracket.gameB, bracket.gameC]) {
      if (!game || game.status !== "FINAL" || !game.score || !game.eventId) continue;
      if (game.homeTeamId !== playerTeamId && game.awayTeamId !== playerTeamId) continue;
      games.push({
        gameId: game.gameId,
        eventId: game.eventId,
        competition: "PLAY_IN",
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeScore: game.score.homeScore,
        awayScore: game.score.awayScore,
      });
    }
  }
  for (const series of postseason.playoffs.series) {
    for (const game of series.games) {
      if (game.status !== "FINAL" || !game.score || !game.eventId) continue;
      if (game.homeTeamId !== playerTeamId && game.awayTeamId !== playerTeamId) continue;
      games.push({
        gameId: game.gameId,
        eventId: game.eventId,
        competition: "PLAYOFF",
        round: series.round,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeScore: game.score.homeScore,
        awayScore: game.score.awayScore,
      });
    }
  }
  return games.sort((first, second) => first.gameId.localeCompare(second.gameId));
}

export function assertPostseasonPerformanceConsistency(
  performance: CareerPostseasonPerformanceState,
  postseason: PostseasonState | null | undefined,
) {
  assertPostseasonPerformanceState(performance);
  if (!postseason) {
    const totals = postseasonPerformanceTotals(performance);
    if (totals.games !== 0
      || performance.legacyUntrackedGameIds.length !== 0
      || performance.trackingStartRevision !== 0) {
      throw new Error("Postseason performance exists without a current postseason");
    }
    return;
  }
  if (!isPostseasonState(postseason)) throw new Error("Postseason state is invalid");
  if (performance.trackingStartRevision > postseason.revision) {
    throw new Error("Postseason statistic tracking starts after the current bracket revision");
  }
  if (performance.coverage === "PARTIAL_LEGACY" && performance.trackingStartRevision === 0) {
    throw new Error("Legacy postseason statistics require a non-zero tracking start revision");
  }
  const finals = finalPlayerPostseasonGames(postseason, performance.playerTeamId);
  const finalByGameId = new Map(finals.map((game) => [game.gameId, game]));
  const accounted = new Set<string>(performance.legacyUntrackedGameIds);
  for (const gameId of performance.legacyUntrackedGameIds) {
    if (!finalByGameId.has(gameId)) throw new Error("Legacy postseason statistic marker does not reference a final player-team game");
  }
  for (const competition of ["PLAY_IN", "PLAYOFF"] as const) {
    for (const record of performance.byCompetition[competition].games) {
      const final = finalByGameId.get(record.gameId);
      if (!final) throw new Error("Postseason statistic record does not reference a final player-team game");
      if (record.eventId !== final.eventId
        || record.competition !== final.competition
        || record.round !== final.round
        || record.teamId !== performance.playerTeamId
        || record.opponentTeamId !== (final.homeTeamId === performance.playerTeamId ? final.awayTeamId : final.homeTeamId)
        || record.venue !== (final.homeTeamId === performance.playerTeamId ? "HOME" : "AWAY")
        || record.teamScore !== (final.homeTeamId === performance.playerTeamId ? final.homeScore : final.awayScore)
        || record.opponentScore !== (final.homeTeamId === performance.playerTeamId ? final.awayScore : final.homeScore)) {
        throw new Error("Postseason statistic record drifts from its final bracket game");
      }
      accounted.add(record.gameId);
    }
  }
  if (finals.some((game) => !accounted.has(game.gameId)) || accounted.size !== finals.length) {
    throw new Error("Final player-team postseason games are not fully accounted for");
  }
}

export function createCareerLifecycleState(
  playerTeamId: string,
  seasonNumber = 1,
  options: { legacyPostseason?: PostseasonState | null } = {},
): CareerLifecycleState {
  if (!teamIds.has(playerTeamId)) throw new Error(`Unknown lifecycle team: ${playerTeamId}`);
  assertInteger(seasonNumber, 1, 20, "career lifecycle seasonNumber");
  const legacyGames = options.legacyPostseason
    ? finalPlayerPostseasonGames(options.legacyPostseason, playerTeamId).map((game) => game.gameId)
    : [];
  const state: CareerLifecycleState = {
    schemaVersion: CAREER_LIFECYCLE_SCHEMA_VERSION,
    currentSeasonNumber: seasonNumber,
    postseasonPerformance: createPostseasonPerformanceState(playerTeamId, {
      legacyUntrackedGameIds: legacyGames,
      trackingStartRevision: options.legacyPostseason?.revision ?? 0,
    }),
    completedSeasons: [],
    pendingSeasonSummaryId: null,
    acknowledgedSeasonSummaryIds: [],
  };
  assertCareerLifecycleState(state);
  return state;
}

function assertRetirementNotice(value: unknown, label: string): asserts value is RetirementNotice {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  assertId(value.id, `${label}.id`);
  assertId(value.playerName, `${label}.playerName`);
  if (typeof value.teamId !== "string" || !teamIds.has(value.teamId)) throw new Error(`${label}.teamId is invalid`);
  assertInteger(value.age, 20, 40, `${label}.age`);
  if (value.kind !== "LEAGUE" && value.kind !== "CREATED_PLAYER") throw new Error(`${label}.kind is invalid`);
  if (value.contentStatus !== "SYNTHETIC" && value.contentStatus !== "APPROVED") throw new Error(`${label}.contentStatus is invalid`);
  if (value.kind === "CREATED_PLAYER" && value.contentStatus !== "SYNTHETIC") throw new Error(`${label} created-player status is invalid`);
  assertId(value.reason, `${label}.reason`);
}

function assertSeasonSummary(value: unknown, expectedSeasonNumber: number, label: string): asserts value is CareerSeasonSummary {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  assertId(value.id, `${label}.id`);
  assertInteger(value.seasonNumber, expectedSeasonNumber, expectedSeasonNumber, `${label}.seasonNumber`);
  for (const field of ["seasonId", "startDate", "endDate", "teamId", "championTeamId", "eastChampionTeamId", "westChampionTeamId", "seasonCompletionEventId"] as const) {
    assertId(value[field], `${label}.${field}`);
  }
  if (!teamIds.has(value.teamId as string)
    || !teamIds.has(value.championTeamId as string)
    || !teamIds.has(value.eastChampionTeamId as string)
    || !teamIds.has(value.westChampionTeamId as string)) throw new Error(`${label} contains an unknown team`);
  if (value.scheduleBasis !== "PUBLISHED_2026_27" && value.scheduleBasis !== "PROJECTED") throw new Error(`${label}.scheduleBasis is invalid`);
  if (value.scheduleRulesVersion !== CAREER_SCHEDULE_RULES_VERSION) throw new Error(`${label}.scheduleRulesVersion is invalid`);
  const descriptor = getCareerSeasonDescriptor(expectedSeasonNumber);
  if (value.seasonId !== descriptor.seasonId
    || value.startDate !== descriptor.startDate
    || value.endDate !== descriptor.endDate
    || value.scheduleBasis !== descriptor.scheduleBasis
    || value.scheduleRulesVersion !== descriptor.scheduleRulesVersion) {
    throw new Error(`${label} season metadata is inconsistent`);
  }
  assertInteger(value.wins, 0, 82, `${label}.wins`);
  assertInteger(value.losses, 0, 82, `${label}.losses`);
  if ((value.wins as number) + (value.losses as number) !== 82) throw new Error(`${label} regular-season record is incomplete`);
  assertInteger(value.ageBefore, 20, 39, `${label}.ageBefore`);
  assertInteger(value.ageAfter, 21, 40, `${label}.ageAfter`);
  if ((value.ageAfter as number) !== (value.ageBefore as number) + 1) throw new Error(`${label} age transition is invalid`);
  if (value.ageBefore !== expectedSeasonNumber + 19 || value.ageAfter !== expectedSeasonNumber + 20) {
    throw new Error(`${label} age does not match its career season`);
  }
  if (typeof value.retired !== "boolean" || value.retired !== (value.ageAfter === 40)) throw new Error(`${label}.retired is invalid`);
  for (const field of ["regularSeasonStats", "playInStats", "playoffStats", "postseasonStats"] as const) {
    assertPlayerTotals(value[field], `${label}.${field}`);
  }
  if (value.postseasonCoverage !== "COMPLETE" && value.postseasonCoverage !== "PARTIAL_LEGACY") throw new Error(`${label}.postseasonCoverage is invalid`);
  if (!finishValues.has(value.postseasonFinish as CareerPostseasonFinish)) throw new Error(`${label}.postseasonFinish is invalid`);
  if (!Array.isArray(value.awards) || value.awards.length === 0) throw new Error(`${label}.awards is empty`);
  assertAwardSet(value.awards, expectedSeasonNumber, `${label}.awards`);
  if (!Array.isArray(value.ageDeclines)) throw new Error(`${label}.ageDeclines must be an array`);
  const declineRatings = new Set<string>();
  for (const [index, rawDecline] of value.ageDeclines.entries()) {
    const declineLabel = `${label}.ageDeclines[${index}]`;
    if (!isPlainObject(rawDecline) || typeof rawDecline.ratingId !== "string" || !ratingIds.has(rawDecline.ratingId as RatingId)) throw new Error(`${declineLabel}.ratingId is invalid`);
    assertInteger(rawDecline.previousValue, 26, 99, `${declineLabel}.previousValue`);
    assertInteger(rawDecline.nextValue, 25, 98, `${declineLabel}.nextValue`);
    if ((rawDecline.previousValue as number) - 1 !== rawDecline.nextValue) throw new Error(`${declineLabel} is not a one-point decline`);
    if (declineRatings.has(rawDecline.ratingId)) throw new Error(`${label}.ageDeclines contains duplicate ratings`);
    declineRatings.add(rawDecline.ratingId);
  }
  if (!Array.isArray(value.retirementNotices) || value.retirementNotices.length === 0) throw new Error(`${label}.retirementNotices is empty`);
  const noticeIds = new Set<string>();
  for (const [index, notice] of value.retirementNotices.entries()) {
    assertRetirementNotice(notice, `${label}.retirementNotices[${index}]`);
    if (noticeIds.has(notice.id)) throw new Error(`${label}.retirementNotices contains duplicate IDs`);
    noticeIds.add(notice.id);
  }
  if (value.retired && !value.retirementNotices.some((notice) => notice.kind === "CREATED_PLAYER")) {
    throw new Error(`${label} is missing the created-player retirement notice`);
  }
}

export function assertCareerLifecycleState(value: unknown, context = "career-lifecycle"): asserts value is CareerLifecycleState {
  if (!isPlainObject(value)) throw new Error(`${context} must be an object`);
  if (value.schemaVersion !== CAREER_LIFECYCLE_SCHEMA_VERSION) throw new Error(`${context} has an unsupported schema version`);
  assertInteger(value.currentSeasonNumber, 1, 20, `${context}.currentSeasonNumber`);
  assertPostseasonPerformanceState(value.postseasonPerformance, `${context}.postseasonPerformance`);
  if (!Array.isArray(value.completedSeasons)) throw new Error(`${context}.completedSeasons must be an array`);
  if (value.completedSeasons.length > (value.currentSeasonNumber as number)) throw new Error(`${context} has too many season summaries`);
  const summaryIds = new Set<string>();
  const completionIds = new Set<string>();
  for (const [index, summary] of value.completedSeasons.entries()) {
    assertSeasonSummary(summary, index + 1, `${context}.completedSeasons[${index}]`);
    if (summaryIds.has(summary.id)) throw new Error(`${context} contains duplicate summary IDs`);
    if (completionIds.has(summary.seasonCompletionEventId)) throw new Error(`${context} contains duplicate season completion IDs`);
    summaryIds.add(summary.id);
    completionIds.add(summary.seasonCompletionEventId);
  }
  if (value.pendingSeasonSummaryId !== null) {
    assertId(value.pendingSeasonSummaryId, `${context}.pendingSeasonSummaryId`);
    if (value.pendingSeasonSummaryId !== value.completedSeasons.at(-1)?.id) throw new Error(`${context}.pendingSeasonSummaryId is not the latest summary`);
  }
  if (!Array.isArray(value.acknowledgedSeasonSummaryIds)) throw new Error(`${context}.acknowledgedSeasonSummaryIds must be an array`);
  const acknowledgedSeasonSummaryIds = value.acknowledgedSeasonSummaryIds as unknown[];
  if (new Set(acknowledgedSeasonSummaryIds).size !== acknowledgedSeasonSummaryIds.length) throw new Error(`${context}.acknowledgedSeasonSummaryIds contains duplicates`);
  for (const summaryId of acknowledgedSeasonSummaryIds) {
    assertId(summaryId, `${context}.acknowledgedSeasonSummaryIds[]`);
    if (!summaryIds.has(summaryId)) throw new Error(`${context} acknowledges an unknown summary`);
  }
  if (value.pendingSeasonSummaryId && acknowledgedSeasonSummaryIds.includes(value.pendingSeasonSummaryId)) {
    throw new Error(`${context} cannot acknowledge a pending summary`);
  }
  const expectedAcknowledged = value.completedSeasons
    .map((summary) => summary.id)
    .filter((summaryId) => summaryId !== value.pendingSeasonSummaryId);
  if (expectedAcknowledged.length !== acknowledgedSeasonSummaryIds.length
    || expectedAcknowledged.some((summaryId) => !acknowledgedSeasonSummaryIds.includes(summaryId))) {
    throw new Error(`${context}.acknowledgedSeasonSummaryIds must cover every non-pending summary exactly once`);
  }
}

const baseAwardIds: readonly CareerAward["id"][] = ["MVP", "DPOY", "MIP", "COY", "ALL_LEAGUE", "ALL_DEFENSE"];

function expectedAwardIds(seasonNumber: number): readonly CareerAward["id"][] {
  return seasonNumber === 1 ? [...baseAwardIds, "ROOKIE", "ALL_ROOKIE"] : baseAwardIds;
}

function assertAwardSet(value: unknown, seasonNumber: number, label: string): asserts value is CareerAward[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const expected = expectedAwardIds(seasonNumber);
  const actual = value.map((award, index) => {
    if (!isPlainObject(award)) throw new Error(`${label}[${index}] must be an object`);
    if (!expected.includes(award.id as CareerAward["id"])) throw new Error(`${label}[${index}].id is invalid`);
    assertId(award.label, `${label}[${index}].label`);
    assertId(award.winnerName, `${label}[${index}].winnerName`);
    assertId(award.reason, `${label}[${index}].reason`);
    if (award.teamId !== undefined && (typeof award.teamId !== "string" || !teamIds.has(award.teamId))) {
      throw new Error(`${label}[${index}].teamId is invalid`);
    }
    return award.id as CareerAward["id"];
  });
  if (actual.length !== expected.length
    || new Set(actual).size !== actual.length
    || expected.some((awardId) => !actual.includes(awardId))) {
    throw new Error(`${label} does not contain the exact season award set`);
  }
}

function postseasonFinish(postseason: PostseasonState, playerTeamId: string): CareerPostseasonFinish {
  if (postseason.playoffs.championTeamId === playerTeamId) return "CHAMPION";
  const losingSeries = postseason.playoffs.series
    .filter((series) => series.loserTeamId === playerTeamId)
    .sort((first, second) => postseason.playoffs.series.indexOf(second) - postseason.playoffs.series.indexOf(first))[0];
  if (losingSeries) return losingSeries.round;
  if (["EAST", "WEST"].some((conference) => postseason.playIn[conference as "EAST" | "WEST"].eliminatedTeamIds.includes(playerTeamId))) return "PLAY_IN";
  return "MISSED_POSTSEASON";
}

function hashText(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

const syntheticFirstNames = ["Cassian", "Tavian", "Elio", "Kellan", "Breckin", "Orson", "Marek", "Soren", "Kyro", "Darian"];
const syntheticLastNames = ["Mercer", "Vance", "Sloane", "Hale", "Quill", "Vale", "Morrow", "Caldwell", "Rowe", "Thorne"];

function retirementNotices(
  season: CareerSeasonState,
  progression: CareerProgressionState,
  summaryId: string,
  approvedContent: readonly ApprovedRetirementContentEvent[],
) {
  const notices: RetirementNotice[] = [];
  for (let index = 0; index < 2; index += 1) {
    const hash = hashText(`${season.seasonId}:${season.seed}:retirement:${index}`);
    const team = leagueTeams[(hash + index * 7) % leagueTeams.length];
    notices.push({
      id: `${summaryId}:synthetic-retirement:${index + 1}`,
      playerName: `${syntheticFirstNames[hash % syntheticFirstNames.length]} ${syntheticLastNames[(hash >>> 7) % syntheticLastNames.length]}`,
      teamId: team.id,
      age: 36 + ((hash >>> 13) % 5),
      kind: "LEAGUE",
      contentStatus: "SYNTHETIC",
      reason: "合成联盟老将于本赛季后结束职业生涯",
    });
  }
  const approvedIds = new Set<string>();
  for (const event of approvedContent) {
    if (!isPlainObject(event)
      || event.rightsStatus !== "APPROVED"
      || event.seasonNumber !== season.seasonNumber
      || !teamIds.has(event.teamId)
      || !Number.isSafeInteger(event.age)
      || event.age < 20
      || event.age > 40
      || typeof event.id !== "string"
      || event.id.length === 0
      || event.id.trim() !== event.id
      || approvedIds.has(event.id)
      || typeof event.playerName !== "string"
      || event.playerName.trim().length === 0
      || typeof event.reason !== "string"
      || event.reason.trim().length === 0) continue;
    approvedIds.add(event.id);
    notices.push({
      id: `${summaryId}:approved:${event.id}`,
      playerName: event.playerName.trim(),
      teamId: event.teamId,
      age: event.age,
      kind: "LEAGUE",
      contentStatus: "APPROVED",
      reason: event.reason.trim(),
    });
  }
  if (progression.retired) {
    notices.unshift({
      id: `${summaryId}:created-player-retirement`,
      playerName: season.playerName,
      teamId: season.playerTeamId,
      age: progression.age,
      kind: "CREATED_PLAYER",
      contentStatus: "SYNTHETIC",
      reason: "40岁强制退役 · 创建球员职业生涯结束",
    });
  }
  return notices;
}

export function settleCareerSeasonTransition(
  season: CareerSeasonState,
  progression: CareerProgressionState,
  postseason: PostseasonState | null,
  lifecycle: CareerLifecycleState,
  approvedContent: readonly ApprovedRetirementContentEvent[] = [],
): CareerSeasonTransitionResult {
  assertCareerLifecycleState(lifecycle);
  try {
    assertCareerProgression(progression, "career-season-transition.progression");
  } catch (error) {
    return { status: "REJECTED", lifecycle, progression, reason: error instanceof Error ? error.message : "成长状态无效" };
  }
  if (!postseason || !isPostseasonState(postseason)
    || postseason.playoffs.status !== "COMPLETE"
    || !postseason.playoffs.championTeamId
    || !postseason.playoffs.seasonCompletionEventId
    || !postseason.playoffs.conferenceChampionTeamIds.EAST
    || !postseason.playoffs.conferenceChampionTeamIds.WEST
    || !postseason.eventIds.includes(postseason.playoffs.seasonCompletionEventId)
    || !postseason.playoffs.eventIds.includes(postseason.playoffs.seasonCompletionEventId)) {
    return { status: "NOT_READY", lifecycle, progression, reason: "联盟总冠军与赛季完成事件尚未锁定" };
  }
  const completionId = postseason.playoffs.seasonCompletionEventId;
  try {
    assertFrozenConsistency(season, postseason);
  } catch (error) {
    return { status: "REJECTED", lifecycle, progression, reason: error instanceof Error ? error.message : "季后赛与常规赛快照不一致" };
  }
  const existing = lifecycle.completedSeasons.find((summary) => summary.seasonCompletionEventId === completionId);
  if (existing) {
    if (existing.seasonNumber !== season.seasonNumber || existing.seasonId !== season.seasonId) {
      return { status: "REJECTED", lifecycle, progression, reason: "赛季完成事件已绑定其他赛季" };
    }
    return { status: "NOOP", lifecycle, progression, reason: "本赛季已经完成结算" };
  }
  if (progression.retired) return { status: "REJECTED", lifecycle, progression, reason: "退役生涯不能再次结算赛季" };
  if (lifecycle.postseasonPerformance.playerTeamId !== season.playerTeamId) {
    return { status: "REJECTED", lifecycle, progression, reason: "季后赛个人统计不属于创建球员当前球队" };
  }
  if (progression.age !== season.seasonNumber + 19) {
    return { status: "REJECTED", lifecycle, progression, reason: "年龄与可比赛赛季编号不一致" };
  }
  if (lifecycle.currentSeasonNumber !== season.seasonNumber || progression.season !== season.seasonNumber) {
    return { status: "REJECTED", lifecycle, progression, reason: "赛季、成长与生涯编号不一致" };
  }
  const conflictingSeason = lifecycle.completedSeasons.find((summary) => summary.seasonNumber === season.seasonNumber);
  if (conflictingSeason) {
    return { status: "REJECTED", lifecycle, progression, reason: "本赛季已绑定不同的赛季完成事件" };
  }
  if (progression.processedSeasonIds.includes(completionId)) {
    return { status: "REJECTED", lifecycle, progression, reason: "成长账本已处理该赛季，但缺少对应赛季摘要" };
  }
  const archivedCompletionIds = lifecycle.completedSeasons.map((summary) => summary.seasonCompletionEventId);
  if (archivedCompletionIds.length !== season.seasonNumber - 1
    || progression.processedSeasonIds.length !== archivedCompletionIds.length
    || archivedCompletionIds.some((eventId) => !progression.processedSeasonIds.includes(eventId))) {
    return { status: "REJECTED", lifecycle, progression, reason: "历史赛季摘要与成长账本不完整或不一致" };
  }
  const descriptor = getCareerSeasonDescriptor(season.seasonNumber);
  if (season.seasonId !== descriptor.seasonId
    || season.startDate !== descriptor.startDate
    || season.endDate !== descriptor.endDate
    || season.scheduleBasis !== descriptor.scheduleBasis
    || season.scheduleRulesVersion !== descriptor.scheduleRulesVersion) {
    return { status: "REJECTED", lifecycle, progression, reason: "当前赛季元数据与赛季编号不一致" };
  }
  if (season.currentDate !== season.endDate
    || !season.cupResolved
    || season.games.length !== REGULAR_SEASON_TOTAL_GAMES
    || season.games.some((game) => game.status !== "FINAL")) {
    return { status: "NOT_READY", lifecycle, progression, reason: "常规赛尚未完整结束" };
  }
  try {
    assertAwardSet(season.awards, season.seasonNumber, "career season awards");
  } catch {
    return { status: "NOT_READY", lifecycle, progression, reason: "本赛季奖项尚未完成" };
  }
  try {
    assertPostseasonPerformanceConsistency(lifecycle.postseasonPerformance, postseason);
  } catch (error) {
    return { status: "REJECTED", lifecycle, progression, reason: error instanceof Error ? error.message : "季后赛个人统计不完整" };
  }

  // M6B-3 deliberately passes no hidden protected rating. Every AGE change is
  // therefore explainable from the frozen public age budget.
  const nextProgression = completeCareerSeason(progression, completionId, []);
  const addedLedger = nextProgression.ledger.slice(progression.ledger.length);
  const ageDeclines = addedLedger
    .filter((entry): entry is ProgressionLedgerEntry => entry.source === "AGE")
    .map((entry) => ({ ratingId: entry.ratingId, previousValue: entry.previousValue, nextValue: entry.nextValue }));
  const playInStats = postseasonPerformanceTotals(lifecycle.postseasonPerformance, "PLAY_IN");
  const playoffStats = postseasonPerformanceTotals(lifecycle.postseasonPerformance, "PLAYOFF");
  const postseasonStats = postseasonPerformanceTotals(lifecycle.postseasonPerformance);
  const standing = season.standings[season.playerTeamId];
  if (!standing || standing.wins + standing.losses !== 82) {
    return { status: "NOT_READY", lifecycle, progression, reason: "创建球员球队的常规赛战绩尚未完整" };
  }
  const summaryId = `${completionId}:summary`;
  const summary: CareerSeasonSummary = {
    id: summaryId,
    seasonNumber: season.seasonNumber,
    seasonId: season.seasonId,
    startDate: season.startDate,
    endDate: season.endDate,
    scheduleBasis: season.scheduleBasis,
    scheduleRulesVersion: season.scheduleRulesVersion,
    teamId: season.playerTeamId,
    wins: standing.wins,
    losses: standing.losses,
    ageBefore: progression.age,
    ageAfter: nextProgression.age,
    retired: nextProgression.retired,
    regularSeasonStats: clone(season.playerStats),
    postseasonCoverage: lifecycle.postseasonPerformance.coverage,
    playInStats,
    playoffStats,
    postseasonStats,
    awards: clone(season.awards),
    postseasonFinish: postseasonFinish(postseason, season.playerTeamId),
    eastChampionTeamId: postseason.playoffs.conferenceChampionTeamIds.EAST,
    westChampionTeamId: postseason.playoffs.conferenceChampionTeamIds.WEST,
    championTeamId: postseason.playoffs.championTeamId,
    seasonCompletionEventId: completionId,
    ageDeclines,
    retirementNotices: [],
  };
  summary.retirementNotices = retirementNotices(season, nextProgression, summaryId, approvedContent);
  const nextLifecycle: CareerLifecycleState = {
    ...lifecycle,
    completedSeasons: [...lifecycle.completedSeasons, summary],
    pendingSeasonSummaryId: summary.id,
  };
  assertCareerLifecycleState(nextLifecycle);
  return { status: "APPLIED", lifecycle: nextLifecycle, progression: nextProgression, summary };
}

function nextSeasonSeed(season: CareerSeasonState, nextSeasonNumber: number) {
  return (season.seed ^ Math.imul(nextSeasonNumber, 0x9e37_79b1) ^ 0xa511_e9b3) >>> 0;
}

export function beginNextCareerSeason(
  season: CareerSeasonState,
  progression: CareerProgressionState,
  lifecycle: CareerLifecycleState,
): BeginNextCareerSeasonResult {
  assertCareerLifecycleState(lifecycle);
  try {
    assertCareerProgression(progression, "career-next-season.progression");
  } catch (error) {
    return { status: "REJECTED", lifecycle, progression, reason: error instanceof Error ? error.message : "成长状态无效" };
  }
  const pending = lifecycle.completedSeasons.find((summary) => summary.id === lifecycle.pendingSeasonSummaryId);
  if (!pending) {
    const latest = lifecycle.completedSeasons.at(-1);
    if (latest
      && lifecycle.acknowledgedSeasonSummaryIds.includes(latest.id)
      && latest.seasonNumber === season.seasonNumber
      && lifecycle.currentSeasonNumber === season.seasonNumber + 1
      && progression.season === lifecycle.currentSeasonNumber) {
      return { status: "NOOP", lifecycle, progression, reason: "下一赛季已经创建" };
    }
    return { status: "REJECTED", lifecycle, progression, reason: "没有待确认的季末总结" };
  }
  if (pending.retired || progression.retired) return { status: "REJECTED", lifecycle, progression, reason: "40岁退役后不能创建下一赛季" };
  const nextSeasonNumber = season.seasonNumber + 1;
  if (nextSeasonNumber > CAREER_MAX_SEASONS) {
    return { status: "REJECTED", lifecycle, progression, reason: "职业生涯没有可创建的第21赛季" };
  }
  if (lifecycle.currentSeasonNumber !== season.seasonNumber
    || pending.seasonNumber !== season.seasonNumber
    || progression.season !== nextSeasonNumber) {
    return { status: "REJECTED", lifecycle, progression, reason: "下一赛季状态已经更新或编号不一致" };
  }
  const nextSeason = {
    ...createCareerSeason(
      season.playerTeamId,
      season.playerName,
      nextSeasonSeed(season, nextSeasonNumber),
      nextSeasonNumber,
    ),
    coins: progression.coins,
  };
  const nextLifecycle: CareerLifecycleState = {
    ...lifecycle,
    currentSeasonNumber: nextSeasonNumber,
    postseasonPerformance: createPostseasonPerformanceState(season.playerTeamId),
    pendingSeasonSummaryId: null,
    acknowledgedSeasonSummaryIds: [...lifecycle.acknowledgedSeasonSummaryIds, pending.id],
  };
  assertCareerLifecycleState(nextLifecycle);
  return { status: "APPLIED", lifecycle: nextLifecycle, progression, season: nextSeason };
}

export function acknowledgeCareerRetirement(
  progression: CareerProgressionState,
  lifecycle: CareerLifecycleState,
) {
  assertCareerLifecycleState(lifecycle);
  const pending = lifecycle.completedSeasons.find((summary) => summary.id === lifecycle.pendingSeasonSummaryId);
  if (!pending || !pending.retired || !progression.retired) return lifecycle;
  const next: CareerLifecycleState = {
    ...lifecycle,
    pendingSeasonSummaryId: null,
    acknowledgedSeasonSummaryIds: [...lifecycle.acknowledgedSeasonSummaryIds, pending.id],
  };
  assertCareerLifecycleState(next);
  return next;
}
