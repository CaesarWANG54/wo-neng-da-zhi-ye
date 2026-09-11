import type { CareerPlayerGameLine } from "./career-game-settlement";
import type { PlayoffRound } from "./career-playoffs";
import type { PlayerSeasonLine } from "./career-season";

export const CAREER_POSTSEASON_PERFORMANCE_SCHEMA_VERSION = 1 as const;

export type PostseasonPerformanceCompetition = "PLAY_IN" | "PLAYOFF";
export type PostseasonPerformanceSource = "PLAYED" | "SIMULATED";
export type PostseasonPerformanceCoverage = "COMPLETE" | "PARTIAL_LEGACY";

export interface PostseasonPlayerGameRecord {
  gameId: string;
  eventId: string;
  competition: PostseasonPerformanceCompetition;
  round?: PlayoffRound;
  source: PostseasonPerformanceSource;
  teamId: string;
  opponentTeamId: string;
  venue: "HOME" | "AWAY";
  teamScore: number;
  opponentScore: number;
  won: boolean;
  playerLine: CareerPlayerGameLine;
}

export interface PostseasonPerformanceBucket {
  games: PostseasonPlayerGameRecord[];
  totals: PlayerSeasonLine;
}

export interface CareerPostseasonPerformanceState {
  schemaVersion: typeof CAREER_POSTSEASON_PERFORMANCE_SCHEMA_VERSION;
  playerTeamId: string;
  coverage: PostseasonPerformanceCoverage;
  /** Root postseason revision from which v1 player-stat tracking is authoritative. */
  trackingStartRevision: number;
  /** Games finalized by an older schema for which truthful player data does not exist. */
  legacyUntrackedGameIds: string[];
  byCompetition: Record<PostseasonPerformanceCompetition, PostseasonPerformanceBucket>;
}

export type PostseasonPerformanceRecordResult =
  | { status: "APPLIED"; state: CareerPostseasonPerformanceState }
  | { status: "NOOP"; state: CareerPostseasonPerformanceState; reason: string }
  | {
      status: "REJECTED";
      code: "INVALID_RECORD" | "CONFLICT" | "LEGACY_UNTRACKED";
      state: CareerPostseasonPerformanceState;
      reason: string;
    };

const competitions: readonly PostseasonPerformanceCompetition[] = ["PLAY_IN", "PLAYOFF"];
const playoffRounds = new Set<PlayoffRound>([
  "FIRST_ROUND",
  "CONFERENCE_SEMIFINALS",
  "CONFERENCE_FINALS",
  "FINALS",
]);
const lineFields = [
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
] as const satisfies readonly (keyof CareerPlayerGameLine)[];
const totalFields = ["games", ...lineFields] as const satisfies readonly (keyof PlayerSeasonLine)[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertNormalizedId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be a normalized non-empty string`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function emptyTotals(): PlayerSeasonLine {
  return {
    games: 0,
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    made: 0,
    attempts: 0,
    threesMade: 0,
    threesAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
  };
}

function cloneLine(line: CareerPlayerGameLine): CareerPlayerGameLine {
  return Object.fromEntries(lineFields.map((field) => [field, line[field]])) as unknown as CareerPlayerGameLine;
}

function cloneRecord(record: PostseasonPlayerGameRecord): PostseasonPlayerGameRecord {
  return {
    gameId: record.gameId,
    eventId: record.eventId,
    competition: record.competition,
    ...(record.round === undefined ? {} : { round: record.round }),
    source: record.source,
    teamId: record.teamId,
    opponentTeamId: record.opponentTeamId,
    venue: record.venue,
    teamScore: record.teamScore,
    opponentScore: record.opponentScore,
    won: record.won,
    playerLine: cloneLine(record.playerLine),
  };
}

function assertPlayerLine(value: unknown, teamScore: number, label: string): asserts value is CareerPlayerGameLine {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  for (const field of lineFields) assertNonNegativeInteger(value[field], `${label}.${field}`);
  const line = value as unknown as CareerPlayerGameLine;
  if (line.made > line.attempts
    || line.threesMade > line.threesAttempted
    || line.threesMade > line.made
    || line.threesAttempted > line.attempts
    || line.freeThrowsMade > line.freeThrowsAttempted) {
    throw new Error(`${label} has inconsistent shooting totals`);
  }
  const derivedPoints = (line.made - line.threesMade) * 2 + line.threesMade * 3 + line.freeThrowsMade;
  if (line.points !== derivedPoints) throw new Error(`${label}.points do not match shooting totals`);
  if (line.points > teamScore) throw new Error(`${label}.points cannot exceed the team score`);
}

function assertRecord(
  value: unknown,
  playerTeamId: string,
  expectedCompetition?: PostseasonPerformanceCompetition,
  label = "postseason performance record",
): asserts value is PostseasonPlayerGameRecord {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  assertNormalizedId(value.gameId, `${label}.gameId`);
  assertNormalizedId(value.eventId, `${label}.eventId`);
  if (!competitions.includes(value.competition as PostseasonPerformanceCompetition)) {
    throw new Error(`${label}.competition is invalid`);
  }
  if (expectedCompetition !== undefined && value.competition !== expectedCompetition) {
    throw new Error(`${label}.competition does not match its bucket`);
  }
  if (value.round !== undefined && !playoffRounds.has(value.round as PlayoffRound)) {
    throw new Error(`${label}.round is invalid`);
  }
  if (value.competition === "PLAY_IN" && value.round !== undefined) {
    throw new Error(`${label}.round is not valid for play-in games`);
  }
  if (value.source !== "PLAYED" && value.source !== "SIMULATED") throw new Error(`${label}.source is invalid`);
  assertNormalizedId(value.teamId, `${label}.teamId`);
  assertNormalizedId(value.opponentTeamId, `${label}.opponentTeamId`);
  if (value.teamId !== playerTeamId) throw new Error(`${label}.teamId is not the created player's team`);
  if (value.teamId === value.opponentTeamId) throw new Error(`${label} cannot use the same team twice`);
  if (value.venue !== "HOME" && value.venue !== "AWAY") throw new Error(`${label}.venue is invalid`);
  assertNonNegativeInteger(value.teamScore, `${label}.teamScore`);
  assertNonNegativeInteger(value.opponentScore, `${label}.opponentScore`);
  if (value.teamScore === value.opponentScore) throw new Error(`${label} cannot end tied`);
  if (typeof value.won !== "boolean" || value.won !== (value.teamScore > value.opponentScore)) {
    throw new Error(`${label}.won is inconsistent with the final score`);
  }
  assertPlayerLine(value.playerLine, value.teamScore, `${label}.playerLine`);
}

function addLine(total: PlayerSeasonLine, line: CareerPlayerGameLine): PlayerSeasonLine {
  const next = { ...total, games: total.games + 1 };
  for (const field of lineFields) next[field] += line[field];
  return next;
}

function replayTotals(games: readonly PostseasonPlayerGameRecord[]) {
  return games.reduce((total, game) => addLine(total, game.playerLine), emptyTotals());
}

function totalsEqual(first: PlayerSeasonLine, second: PlayerSeasonLine) {
  return totalFields.every((field) => first[field] === second[field]);
}

function assertTotals(value: unknown, label: string): asserts value is PlayerSeasonLine {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  for (const field of totalFields) assertNonNegativeInteger(value[field], `${label}.${field}`);
  const totals = value as unknown as PlayerSeasonLine;
  if (totals.made > totals.attempts
    || totals.threesMade > totals.threesAttempted
    || totals.threesMade > totals.made
    || totals.threesAttempted > totals.attempts
    || totals.freeThrowsMade > totals.freeThrowsAttempted) {
    throw new Error(`${label} has inconsistent shooting totals`);
  }
  const derivedPoints = (totals.made - totals.threesMade) * 2 + totals.threesMade * 3 + totals.freeThrowsMade;
  if (totals.points !== derivedPoints) throw new Error(`${label}.points do not match shooting totals`);
}

export function createPostseasonPerformanceState(
  playerTeamId: string,
  options: { legacyUntrackedGameIds?: readonly string[]; trackingStartRevision?: number } = {},
): CareerPostseasonPerformanceState {
  assertNormalizedId(playerTeamId, "postseason performance playerTeamId");
  const legacyUntrackedGameIds = [...new Set(options.legacyUntrackedGameIds ?? [])].sort();
  for (const [index, gameId] of legacyUntrackedGameIds.entries()) {
    assertNormalizedId(gameId, `legacyUntrackedGameIds[${index}]`);
  }
  const trackingStartRevision = options.trackingStartRevision ?? 0;
  assertNonNegativeInteger(trackingStartRevision, "postseason performance trackingStartRevision");
  const state: CareerPostseasonPerformanceState = {
    schemaVersion: CAREER_POSTSEASON_PERFORMANCE_SCHEMA_VERSION,
    playerTeamId,
    coverage: legacyUntrackedGameIds.length === 0 ? "COMPLETE" : "PARTIAL_LEGACY",
    trackingStartRevision,
    legacyUntrackedGameIds,
    byCompetition: {
      PLAY_IN: { games: [], totals: emptyTotals() },
      PLAYOFF: { games: [], totals: emptyTotals() },
    },
  };
  assertPostseasonPerformanceState(state);
  return state;
}

export function assertPostseasonPerformanceState(
  value: unknown,
  context = "career-postseason-performance",
): asserts value is CareerPostseasonPerformanceState {
  if (!isPlainObject(value)) throw new Error(`${context} must be an object`);
  if (value.schemaVersion !== CAREER_POSTSEASON_PERFORMANCE_SCHEMA_VERSION) {
    throw new Error(`${context} has an unsupported schema version`);
  }
  assertNormalizedId(value.playerTeamId, `${context}.playerTeamId`);
  assertNonNegativeInteger(value.trackingStartRevision, `${context}.trackingStartRevision`);
  if (value.coverage !== "COMPLETE" && value.coverage !== "PARTIAL_LEGACY") {
    throw new Error(`${context}.coverage is invalid`);
  }
  if (!Array.isArray(value.legacyUntrackedGameIds)) throw new Error(`${context}.legacyUntrackedGameIds must be an array`);
  const legacyIds = value.legacyUntrackedGameIds as unknown[];
  legacyIds.forEach((gameId, index) => assertNormalizedId(gameId, `${context}.legacyUntrackedGameIds[${index}]`));
  if (new Set(legacyIds).size !== legacyIds.length) throw new Error(`${context}.legacyUntrackedGameIds contains duplicates`);
  const expectedLegacyOrder = [...legacyIds].sort();
  if (legacyIds.some((gameId, index) => gameId !== expectedLegacyOrder[index])) {
    throw new Error(`${context}.legacyUntrackedGameIds is not in canonical order`);
  }
  if ((legacyIds.length === 0) !== (value.coverage === "COMPLETE")) {
    throw new Error(`${context}.coverage does not match legacy game tracking`);
  }
  if (!isPlainObject(value.byCompetition)) throw new Error(`${context}.byCompetition must be an object`);

  const seenGameIds = new Set<string>();
  const seenEventIds = new Set<string>();
  for (const competition of competitions) {
    const bucket = value.byCompetition[competition];
    if (!isPlainObject(bucket) || !Array.isArray(bucket.games)) {
      throw new Error(`${context}.${competition} bucket is invalid`);
    }
    const games = bucket.games as unknown[];
    for (const [index, game] of games.entries()) {
      assertRecord(game, value.playerTeamId, competition, `${context}.${competition}.games[${index}]`);
      if (seenGameIds.has(game.gameId)) throw new Error(`${context} contains duplicate game IDs`);
      if (seenEventIds.has(game.eventId)) throw new Error(`${context} contains duplicate event IDs`);
      if ((legacyIds as string[]).includes(game.gameId)) throw new Error(`${context} tracks a legacy-untracked game`);
      seenGameIds.add(game.gameId);
      seenEventIds.add(game.eventId);
    }
    assertTotals(bucket.totals, `${context}.${competition}.totals`);
    const replayed = replayTotals(games as PostseasonPlayerGameRecord[]);
    if (!totalsEqual(bucket.totals, replayed)) {
      throw new Error(`${context}.${competition}.totals cannot be replayed from its games`);
    }
  }
}

function recordsEqual(first: PostseasonPlayerGameRecord, second: PostseasonPlayerGameRecord) {
  return first.gameId === second.gameId
    && first.eventId === second.eventId
    && first.competition === second.competition
    && first.round === second.round
    && first.source === second.source
    && first.teamId === second.teamId
    && first.opponentTeamId === second.opponentTeamId
    && first.venue === second.venue
    && first.teamScore === second.teamScore
    && first.opponentScore === second.opponentScore
    && first.won === second.won
    && lineFields.every((field) => first.playerLine[field] === second.playerLine[field]);
}

export function recordPostseasonPlayerGame(
  state: CareerPostseasonPerformanceState,
  record: PostseasonPlayerGameRecord,
): PostseasonPerformanceRecordResult {
  assertPostseasonPerformanceState(state);
  const existing = competitions
    .flatMap((competition) => state.byCompetition[competition].games)
    .find((game) => game.gameId === record?.gameId || game.eventId === record?.eventId);
  if (existing) {
    // Once an identity has been bound, every differing replay is a conflict,
    // even if the replacement payload is itself malformed. This prevents an
    // invalid payload from weakening the stronger immutable-ID guarantee.
    try {
      assertRecord(record, state.playerTeamId);
    } catch {
      return {
        status: "REJECTED",
        code: "CONFLICT",
        state,
        reason: "The game or event ID is already bound to different postseason player statistics",
      };
    }
    if (existing.gameId === record.gameId && existing.eventId === record.eventId && recordsEqual(existing, record)) {
      return { status: "NOOP", state, reason: "This postseason player game is already recorded" };
    }
    return {
      status: "REJECTED",
      code: "CONFLICT",
      state,
      reason: "The game or event ID is already bound to different postseason player statistics",
    };
  }
  try {
    assertRecord(record, state.playerTeamId);
  } catch (error) {
    return {
      status: "REJECTED",
      code: "INVALID_RECORD",
      state,
      reason: error instanceof Error ? error.message : "Postseason player game record is invalid",
    };
  }
  if (state.legacyUntrackedGameIds.includes(record.gameId)) {
    return {
      status: "REJECTED",
      code: "LEGACY_UNTRACKED",
      state,
      reason: "This legacy game was finalized without recoverable player statistics",
    };
  }
  const stored = cloneRecord(record);
  const bucket = state.byCompetition[stored.competition];
  const next: CareerPostseasonPerformanceState = {
    ...state,
    legacyUntrackedGameIds: [...state.legacyUntrackedGameIds],
    byCompetition: {
      PLAY_IN: state.byCompetition.PLAY_IN,
      PLAYOFF: state.byCompetition.PLAYOFF,
      [stored.competition]: {
        games: [...bucket.games, stored],
        totals: addLine(bucket.totals, stored.playerLine),
      },
    },
  };
  assertPostseasonPerformanceState(next);
  return { status: "APPLIED", state: next };
}

export function postseasonPerformanceTotals(
  state: CareerPostseasonPerformanceState,
  competition?: PostseasonPerformanceCompetition,
): PlayerSeasonLine {
  assertPostseasonPerformanceState(state);
  if (competition !== undefined) {
    if (!competitions.includes(competition)) throw new Error(`Unknown postseason competition: ${competition}`);
    return { ...state.byCompetition[competition].totals };
  }
  const playIn = state.byCompetition.PLAY_IN.totals;
  const playoffs = state.byCompetition.PLAYOFF.totals;
  return Object.fromEntries(totalFields.map((field) => [field, playIn[field] + playoffs[field]])) as unknown as PlayerSeasonLine;
}

export function markLegacyUntrackedGames(
  state: CareerPostseasonPerformanceState,
  gameIds: readonly string[],
): CareerPostseasonPerformanceState {
  assertPostseasonPerformanceState(state);
  const trackedIds = new Set(competitions.flatMap((competition) => state.byCompetition[competition].games.map((game) => game.gameId)));
  const additions = [...new Set(gameIds)];
  for (const [index, gameId] of additions.entries()) {
    assertNormalizedId(gameId, `legacy gameIds[${index}]`);
    if (trackedIds.has(gameId)) throw new Error(`Cannot mark tracked game ${gameId} as legacy-untracked`);
  }
  const legacyUntrackedGameIds = [...new Set([...state.legacyUntrackedGameIds, ...additions])].sort();
  if (legacyUntrackedGameIds.length === state.legacyUntrackedGameIds.length
    && legacyUntrackedGameIds.every((gameId, index) => gameId === state.legacyUntrackedGameIds[index])) {
    return state;
  }
  const next: CareerPostseasonPerformanceState = {
    ...state,
    coverage: "PARTIAL_LEGACY",
    legacyUntrackedGameIds,
  };
  assertPostseasonPerformanceState(next);
  return next;
}
