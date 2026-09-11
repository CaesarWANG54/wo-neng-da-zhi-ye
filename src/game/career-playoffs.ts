import { simulatePostseasonScore } from "./career-season";
import type { Conference } from "./player-creation";

/**
 * M6B-2 — deterministic best-of-seven playoff bracket.
 *
 * This module deliberately knows nothing about the M6B-1 play-in state. The
 * integration layer supplies the final 1–8 seeds only after both conferences'
 * play-in brackets are complete. Keeping this domain isolated makes the fixed
 * bracket replayable without importing or mutating the regular-season freeze.
 */

export const PLAYOFF_BRACKET_SCHEMA_VERSION = 1 as const;
export const PLAYOFF_RULES_VERSION = "m6b2-playoff-v1" as const;
export const PLAYOFF_WINS_NEEDED = 4 as const;
export const PLAYOFF_HOME_PATTERN = ["HCA", "HCA", "OTHER", "OTHER", "HCA", "OTHER", "HCA"] as const;

export type PlayoffRound = "FIRST_ROUND" | "CONFERENCE_SEMIFINALS" | "CONFERENCE_FINALS" | "FINALS";
export type PlayoffSeriesSlot = "F1" | "F2" | "F3" | "F4" | "S1" | "S2" | "C1" | "FINALS";
export type PlayoffSeriesStatus = "ACTIVE" | "FINAL";
export type PlayoffBracketStatus = "WAITING_FOR_PLAY_IN" | "IN_PROGRESS" | "COMPLETE";
export type PlayoffGameStatus = "SCHEDULED" | "FINAL";
export type HomeCourtReason = "BETTER_RECORD" | "BETTER_SEED" | "HEAD_TO_HEAD" | "OPPOSITE_CONFERENCE" | "DETERMINISTIC_DRAW";

export interface PostseasonScore {
  homeScore: number;
  awayScore: number;
}

export interface PlayoffHeadToHeadRecord {
  wins: number;
  losses: number;
}

/** Immutable regular-season evidence needed by all later home-court decisions. */
export interface PlayoffSeedTeam {
  teamId: string;
  conference: Conference;
  seed: number;
  wins: number;
  losses: number;
  oppositeConferenceWins: number;
  oppositeConferenceLosses: number;
  headToHead: Record<string, PlayoffHeadToHeadRecord>;
}

export interface PlayoffSeedField {
  EAST: PlayoffSeedTeam[];
  WEST: PlayoffSeedTeam[];
}

export type SeriesParticipantSource =
  | { kind: "SEED"; conference: Conference; seed: number }
  | { kind: "WINNER"; seriesId: string };

export interface PlayoffGame {
  gameId: string;
  gameNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  status: PlayoffGameStatus;
  homeTeamId: string;
  awayTeamId: string;
  score: PostseasonScore | null;
  winnerTeamId: string | null;
  loserTeamId: string | null;
  eventId: string | null;
}

export interface PlayoffSeries {
  seriesId: string;
  round: PlayoffRound;
  conference: Conference | null;
  slot: PlayoffSeriesSlot;
  participantSources: [SeriesParticipantSource, SeriesParticipantSource];
  teamAId: string;
  teamBId: string;
  teamASeed: number;
  teamBSeed: number;
  homeCourtTeamId: string;
  homeCourtReason: HomeCourtReason;
  winsNeeded: typeof PLAYOFF_WINS_NEEDED;
  status: PlayoffSeriesStatus;
  revision: number;
  teamAWins: number;
  teamBWins: number;
  games: PlayoffGame[];
  winnerTeamId: string | null;
  loserTeamId: string | null;
}

export interface PlayoffBracketState {
  schemaVersion: typeof PLAYOFF_BRACKET_SCHEMA_VERSION;
  rulesVersion: typeof PLAYOFF_RULES_VERSION;
  freezeEventId: string;
  seasonSeed: number;
  status: PlayoffBracketStatus;
  /** Exactly one increment for each applied playoff game, never for derivation. */
  revision: number;
  /** Playoff-game events plus the two terminal events, kept in canonical order. */
  eventIds: string[];
  seeds: PlayoffSeedField;
  /** Deterministically ordered by conference, round and fixed bracket slot. */
  series: PlayoffSeries[];
  conferenceChampionTeamIds: Record<Conference, string | null>;
  championTeamId: string | null;
  championshipEventId: string | null;
  seasonCompletionEventId: string | null;
}

export type PlayoffInitializationResult =
  | { status: "APPLIED"; state: PlayoffBracketState }
  | { status: "NOOP"; state: PlayoffBracketState; reason: string }
  | { status: "REJECTED"; code: "INVALID_STATE" | "INVALID_SEEDS" | "CONFLICT"; reason: string };

export type PlayoffRecordRejectionCode =
  | "INVALID_STATE"
  | "NOT_INITIALIZED"
  | "UNKNOWN_SERIES"
  | "OUT_OF_ORDER"
  | "TIED"
  | "INVALID_SCORE"
  | "CONFLICT"
  | "SERIES_COMPLETE"
  | "STALE";

export type PlayoffRecordResult =
  | { status: "APPLIED"; state: PlayoffBracketState; eventId: string }
  | { status: "NOOP"; state: PlayoffBracketState; reason: string }
  | { status: "REJECTED"; code: PlayoffRecordRejectionCode; reason: string };

export interface PlayoffRecordOptions {
  expectedRevision?: number;
}

const firstRoundPairings = [
  { slot: "F1" as const, firstSeed: 1, secondSeed: 8 },
  { slot: "F2" as const, firstSeed: 4, secondSeed: 5 },
  { slot: "F3" as const, firstSeed: 3, secondSeed: 6 },
  { slot: "F4" as const, firstSeed: 2, secondSeed: 7 },
] as const;

const seriesOrder: Record<PlayoffSeriesSlot, number> = {
  F1: 0,
  F2: 1,
  F3: 2,
  F4: 3,
  S1: 4,
  S2: 5,
  C1: 6,
  FINALS: 7,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function copyHeadToHead(value: Record<string, PlayoffHeadToHeadRecord>) {
  return Object.fromEntries(Object.entries(value).map(([teamId, record]) => [teamId, { wins: record.wins, losses: record.losses }]));
}

function copySeedTeam(team: PlayoffSeedTeam): PlayoffSeedTeam {
  return {
    teamId: team.teamId,
    conference: team.conference,
    seed: team.seed,
    wins: team.wins,
    losses: team.losses,
    oppositeConferenceWins: team.oppositeConferenceWins,
    oppositeConferenceLosses: team.oppositeConferenceLosses,
    headToHead: copyHeadToHead(team.headToHead),
  };
}

function copySeedField(seeds: PlayoffSeedField): PlayoffSeedField {
  return {
    EAST: seeds.EAST.map(copySeedTeam),
    WEST: seeds.WEST.map(copySeedTeam),
  };
}

function safeInteger(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function validTeamId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9_]+$/.test(value);
}

function seedFieldValidationError(value: unknown): string | null {
  if (!isPlainObject(value)) return "seed field must be an object";
  if (!Array.isArray(value.EAST) || !Array.isArray(value.WEST)) return "EAST and WEST seed lists must both be arrays";
  if (value.EAST.length !== 8 || value.WEST.length !== 8) return "each conference must contain exactly eight final seeds";
  const field = value as unknown as PlayoffSeedField;
  const all = [...field.EAST, ...field.WEST];
  const ids = new Set<string>();
  for (const conference of ["EAST", "WEST"] as const) {
    for (let index = 0; index < field[conference].length; index += 1) {
      const team = field[conference][index];
      const label = `${conference} seed ${index + 1}`;
      if (!isPlainObject(team)) return `${label} must be an object`;
      if (!validTeamId(team.teamId)) return `${label} has an invalid team ID`;
      if (team.conference !== conference) return `${label} has the wrong conference`;
      if (team.seed !== index + 1) return `${label} has a non-canonical seed number`;
      if (!safeInteger(team.wins, 0, 82) || !safeInteger(team.losses, 0, 82) || team.wins + team.losses !== 82) {
        return `${label} must have an 82-game regular-season record`;
      }
      if (!safeInteger(team.oppositeConferenceWins, 0, 82)
        || !safeInteger(team.oppositeConferenceLosses, 0, 82)
        || team.oppositeConferenceWins + team.oppositeConferenceLosses > 82) {
        return `${label} has an invalid opposite-conference record`;
      }
      if (!isPlainObject(team.headToHead)) return `${label} head-to-head evidence must be an object`;
      if (ids.has(team.teamId)) return `${label} duplicates team ${team.teamId}`;
      ids.add(team.teamId);
      for (const [opponentId, record] of Object.entries(team.headToHead)) {
        if (!validTeamId(opponentId)) return `${label} has an invalid head-to-head opponent ID`;
        if (opponentId === team.teamId) return `${label} cannot contain a self head-to-head record`;
        if (!isPlainObject(record)
          || !safeInteger(record.wins, 0, 82)
          || !safeInteger(record.losses, 0, 82)
          || (record.wins as number) + (record.losses as number) > 82) {
          return `${label} has an invalid head-to-head record against ${opponentId}`;
        }
      }
      // Seeds 1–6 are the frozen regular-season order. Final seeds 7 and 8
      // are assigned by play-in results, so they may be inverted relative to
      // each other (for example, final #8 can have a better record than #7).
      if (index > 0 && index <= 5) {
        const previous = field[conference][index - 1];
        if (percentage(team.wins, team.losses) > percentage(previous.wins, previous.losses) + 1e-9) {
          return `${label} cannot have a better record than the preceding direct seed`;
        }
      } else if (index >= 6) {
        const finalDirectSeed = field[conference][5];
        if (percentage(team.wins, team.losses) > percentage(finalDirectSeed.wins, finalDirectSeed.losses) + 1e-9) {
          return `${label} cannot have a better record than final direct seed 6`;
        }
      }
    }
  }
  const byId = new Map(all.map((team) => [team.teamId, team]));
  for (const team of all) {
    for (const [opponentId, record] of Object.entries(team.headToHead)) {
      const opponent = byId.get(opponentId);
      if (!opponent) continue;
      const reverse = opponent.headToHead[team.teamId];
      if (!reverse || reverse.wins !== record.losses || reverse.losses !== record.wins) {
        return `${team.teamId} and ${opponentId} have asymmetric head-to-head evidence`;
      }
    }
  }
  return null;
}

function validateSeedField(value: unknown): value is PlayoffSeedField {
  return seedFieldValidationError(value) === null;
}

function percentage(wins: number, losses: number) {
  return wins + losses === 0 ? 0.5 : wins / (wins + losses);
}

function simpleHash(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function deterministicDraw(
  freezeEventId: string,
  first: PlayoffSeedTeam,
  second: PlayoffSeedTeam,
): PlayoffSeedTeam {
  const ordered = [first.teamId, second.teamId].sort().join(":");
  const firstHash = simpleHash(`${freezeEventId}:finals-hca:${ordered}:${first.teamId}`);
  const secondHash = simpleHash(`${freezeEventId}:finals-hca:${ordered}:${second.teamId}`);
  if (firstHash !== secondHash) return firstHash < secondHash ? first : second;
  return first.teamId.localeCompare(second.teamId) <= 0 ? first : second;
}

function findTeam(state: PlayoffBracketState, teamId: string) {
  return [...state.seeds.EAST, ...state.seeds.WEST].find((team) => team.teamId === teamId)!;
}

function resolveSameConferenceHomeCourt(first: PlayoffSeedTeam, second: PlayoffSeedTeam) {
  const firstPct = percentage(first.wins, first.losses);
  const secondPct = percentage(second.wins, second.losses);
  if (Math.abs(firstPct - secondPct) > 1e-9) {
    return { team: firstPct > secondPct ? first : second, reason: "BETTER_RECORD" as const };
  }
  return { team: first.seed < second.seed ? first : second, reason: "BETTER_SEED" as const };
}

function resolveFinalsHomeCourt(state: PlayoffBracketState, east: PlayoffSeedTeam, west: PlayoffSeedTeam) {
  const eastPct = percentage(east.wins, east.losses);
  const westPct = percentage(west.wins, west.losses);
  if (Math.abs(eastPct - westPct) > 1e-9) {
    return { team: eastPct > westPct ? east : west, reason: "BETTER_RECORD" as const };
  }
  const eastHead = east.headToHead[west.teamId];
  const westHead = west.headToHead[east.teamId];
  if (eastHead && westHead && eastHead.wins + eastHead.losses > 0) {
    const eastHeadPct = percentage(eastHead.wins, eastHead.losses);
    const westHeadPct = percentage(westHead.wins, westHead.losses);
    if (Math.abs(eastHeadPct - westHeadPct) > 1e-9) {
      return { team: eastHeadPct > westHeadPct ? east : west, reason: "HEAD_TO_HEAD" as const };
    }
  }
  const eastOppositePct = percentage(east.oppositeConferenceWins, east.oppositeConferenceLosses);
  const westOppositePct = percentage(west.oppositeConferenceWins, west.oppositeConferenceLosses);
  if (Math.abs(eastOppositePct - westOppositePct) > 1e-9) {
    return { team: eastOppositePct > westOppositePct ? east : west, reason: "OPPOSITE_CONFERENCE" as const };
  }
  return { team: deterministicDraw(state.freezeEventId, east, west), reason: "DETERMINISTIC_DRAW" as const };
}

function seriesIdentity(
  state: PlayoffBracketState,
  conference: Conference | null,
  round: PlayoffRound,
  slot: PlayoffSeriesSlot,
  teamAId: string,
  teamBId: string,
) {
  return `${state.freezeEventId}:series:${conference ?? "LEAGUE"}:${round}:${slot}:${teamAId}:${teamBId}`;
}

function scheduledGame(series: Omit<PlayoffSeries, "games">, gameNumber: number): PlayoffGame {
  const pattern = PLAYOFF_HOME_PATTERN[gameNumber - 1];
  if (!pattern || gameNumber < 1 || gameNumber > 7) throw new Error("Playoff game number is outside 1..7");
  const homeTeamId = pattern === "HCA"
    ? series.homeCourtTeamId
    : series.homeCourtTeamId === series.teamAId ? series.teamBId : series.teamAId;
  const awayTeamId = homeTeamId === series.teamAId ? series.teamBId : series.teamAId;
  const gameId = `${series.seriesId}:G${gameNumber}:${homeTeamId}:${awayTeamId}`;
  return {
    gameId,
    gameNumber: gameNumber as PlayoffGame["gameNumber"],
    status: "SCHEDULED",
    homeTeamId,
    awayTeamId,
    score: null,
    winnerTeamId: null,
    loserTeamId: null,
    eventId: null,
  };
}

function createSeries(
  state: PlayoffBracketState,
  round: PlayoffRound,
  conference: Conference | null,
  slot: PlayoffSeriesSlot,
  teamAId: string,
  teamBId: string,
  participantSources: [SeriesParticipantSource, SeriesParticipantSource],
): PlayoffSeries {
  const teamA = findTeam(state, teamAId);
  const teamB = findTeam(state, teamBId);
  const homeCourt = conference
    ? resolveSameConferenceHomeCourt(teamA, teamB)
    : resolveFinalsHomeCourt(state, teamA, teamB);
  const base: Omit<PlayoffSeries, "games"> = {
    seriesId: seriesIdentity(state, conference, round, slot, teamAId, teamBId),
    round,
    conference,
    slot,
    participantSources,
    teamAId,
    teamBId,
    teamASeed: teamA.seed,
    teamBSeed: teamB.seed,
    homeCourtTeamId: homeCourt.team.teamId,
    homeCourtReason: homeCourt.reason,
    winsNeeded: PLAYOFF_WINS_NEEDED,
    status: "ACTIVE",
    revision: 0,
    teamAWins: 0,
    teamBWins: 0,
    winnerTeamId: null,
    loserTeamId: null,
  };
  return { ...base, games: [scheduledGame(base, 1)] };
}

function sortSeries(series: PlayoffSeries[]) {
  return [...series].sort((first, second) => {
    const firstConference = first.conference === "EAST" ? 0 : first.conference === "WEST" ? 1 : 2;
    const secondConference = second.conference === "EAST" ? 0 : second.conference === "WEST" ? 1 : 2;
    return firstConference - secondConference
      || seriesOrder[first.slot] - seriesOrder[second.slot]
      || first.seriesId.localeCompare(second.seriesId);
  });
}

function seriesAt(state: PlayoffBracketState, conference: Conference | null, slot: PlayoffSeriesSlot) {
  return state.series.find((series) => series.conference === conference && series.slot === slot);
}

function addReadySeries(state: PlayoffBracketState): PlayoffBracketState {
  let next = state;
  let changed = true;
  while (changed) {
    changed = false;
    for (const conference of ["EAST", "WEST"] as const) {
      const additions: Array<{
        slot: "S1" | "S2" | "C1";
        round: "CONFERENCE_SEMIFINALS" | "CONFERENCE_FINALS";
        feeders: [PlayoffSeriesSlot, PlayoffSeriesSlot];
      }> = [
        { slot: "S1", round: "CONFERENCE_SEMIFINALS", feeders: ["F1", "F2"] },
        { slot: "S2", round: "CONFERENCE_SEMIFINALS", feeders: ["F3", "F4"] },
        { slot: "C1", round: "CONFERENCE_FINALS", feeders: ["S1", "S2"] },
      ];
      for (const addition of additions) {
        if (seriesAt(next, conference, addition.slot)) continue;
        const first = seriesAt(next, conference, addition.feeders[0]);
        const second = seriesAt(next, conference, addition.feeders[1]);
        if (first?.status !== "FINAL" || second?.status !== "FINAL" || !first.winnerTeamId || !second.winnerTeamId) continue;
        const created = createSeries(
          next,
          addition.round,
          conference,
          addition.slot,
          first.winnerTeamId,
          second.winnerTeamId,
          [{ kind: "WINNER", seriesId: first.seriesId }, { kind: "WINNER", seriesId: second.seriesId }],
        );
        next = { ...next, series: sortSeries([...next.series, created]) };
        changed = true;
      }
    }
    const eastFinal = seriesAt(next, "EAST", "C1");
    const westFinal = seriesAt(next, "WEST", "C1");
    const conferenceChampionTeamIds = {
      EAST: eastFinal?.status === "FINAL" ? eastFinal.winnerTeamId : null,
      WEST: westFinal?.status === "FINAL" ? westFinal.winnerTeamId : null,
    } satisfies Record<Conference, string | null>;
    if (next.conferenceChampionTeamIds.EAST !== conferenceChampionTeamIds.EAST
      || next.conferenceChampionTeamIds.WEST !== conferenceChampionTeamIds.WEST) {
      next = { ...next, conferenceChampionTeamIds };
      changed = true;
    }
    if (!seriesAt(next, null, "FINALS") && conferenceChampionTeamIds.EAST && conferenceChampionTeamIds.WEST) {
      const created = createSeries(
        next,
        "FINALS",
        null,
        "FINALS",
        conferenceChampionTeamIds.EAST,
        conferenceChampionTeamIds.WEST,
        [{ kind: "WINNER", seriesId: eastFinal!.seriesId }, { kind: "WINNER", seriesId: westFinal!.seriesId }],
      );
      next = { ...next, series: sortSeries([...next.series, created]) };
      changed = true;
    }
    const finals = seriesAt(next, null, "FINALS");
    if (finals?.status === "FINAL" && finals.winnerTeamId) {
      const championshipEventId = `${next.freezeEventId}:championship:${finals.winnerTeamId}`;
      const seasonCompletionEventId = `${next.freezeEventId}:season-complete`;
      next = {
        ...next,
        status: "COMPLETE",
        championTeamId: finals.winnerTeamId,
        championshipEventId,
        seasonCompletionEventId,
        eventIds: [...new Set([...next.eventIds, championshipEventId, seasonCompletionEventId])].sort(),
      };
      changed = false;
    }
  }
  return next;
}

export function createWaitingPlayoffBracket(freezeEventId: string, seasonSeed: number): PlayoffBracketState {
  if (typeof freezeEventId !== "string" || freezeEventId.trim() !== freezeEventId || freezeEventId.length === 0) {
    throw new Error("Playoff freeze event ID must be a normalized non-empty string");
  }
  if (!safeInteger(seasonSeed, 0, 0xffff_ffff)) throw new Error("Playoff season seed must be an unsigned 32-bit integer");
  return {
    schemaVersion: PLAYOFF_BRACKET_SCHEMA_VERSION,
    rulesVersion: PLAYOFF_RULES_VERSION,
    freezeEventId,
    seasonSeed,
    status: "WAITING_FOR_PLAY_IN",
    revision: 0,
    eventIds: [],
    seeds: { EAST: [], WEST: [] },
    series: [],
    conferenceChampionTeamIds: { EAST: null, WEST: null },
    championTeamId: null,
    championshipEventId: null,
    seasonCompletionEventId: null,
  };
}

function initializeInternal(state: PlayoffBracketState, seeds: PlayoffSeedField): PlayoffBracketState {
  const next: PlayoffBracketState = {
    ...state,
    status: "IN_PROGRESS",
    seeds: copySeedField(seeds),
    series: [],
  };
  const series: PlayoffSeries[] = [];
  for (const conference of ["EAST", "WEST"] as const) {
    for (const pairing of firstRoundPairings) {
      const first = next.seeds[conference][pairing.firstSeed - 1];
      const second = next.seeds[conference][pairing.secondSeed - 1];
      series.push(createSeries(
        next,
        "FIRST_ROUND",
        conference,
        pairing.slot,
        first.teamId,
        second.teamId,
        [
          { kind: "SEED", conference, seed: pairing.firstSeed },
          { kind: "SEED", conference, seed: pairing.secondSeed },
        ],
      ));
    }
  }
  return { ...next, series: sortSeries(series) };
}

export function initializePlayoffFirstRound(
  state: PlayoffBracketState,
  seeds: PlayoffSeedField,
): PlayoffInitializationResult {
  if (!isPlayoffBracketState(state)) {
    return { status: "REJECTED", code: "INVALID_STATE", reason: "季后赛系列赛状态无效" };
  }
  const seedError = seedFieldValidationError(seeds);
  if (seedError) {
    return { status: "REJECTED", code: "INVALID_SEEDS", reason: `季后赛最终种子或常规赛证据无效：${seedError}` };
  }
  if (state.status !== "WAITING_FOR_PLAY_IN") {
    if (canonicalString(state.seeds) === canonicalString(seeds)) {
      return { status: "NOOP", state, reason: "季后赛首轮已按相同种子生成" };
    }
    return { status: "REJECTED", code: "CONFLICT", reason: "季后赛首轮已生成，不能更换种子" };
  }
  const next = initializeInternal(state, seeds);
  assertPlayoffBracketState(next);
  return { status: "APPLIED", state: next };
}

export function nextPlayoffGame(state: PlayoffBracketState, seriesId: string): PlayoffGame | null {
  const series = state.series.find((candidate) => candidate.seriesId === seriesId);
  if (!series || series.status === "FINAL") return null;
  return series.games.find((game) => game.status === "SCHEDULED") ?? null;
}

export function scheduledPlayoffGames(state: PlayoffBracketState): PlayoffGame[] {
  return sortSeries(state.series)
    .map((series) => nextPlayoffGame(state, series.seriesId))
    .filter((game): game is PlayoffGame => Boolean(game));
}

export function seriesScore(series: PlayoffSeries) {
  return { teamAWins: series.teamAWins, teamBWins: series.teamBWins };
}

function validScore(score: PostseasonScore) {
  return safeInteger(score.homeScore, 0, 300) && safeInteger(score.awayScore, 0, 300);
}

function finalGame(game: PlayoffGame, score: PostseasonScore): PlayoffGame {
  const homeWon = score.homeScore > score.awayScore;
  return {
    ...game,
    status: "FINAL",
    score: { homeScore: score.homeScore, awayScore: score.awayScore },
    winnerTeamId: homeWon ? game.homeTeamId : game.awayTeamId,
    loserTeamId: homeWon ? game.awayTeamId : game.homeTeamId,
    // Bind the immutable event identity to the exact payload. This mirrors
    // the play-in ledger and makes a same-winner score edit detectable during
    // deterministic replay instead of leaving a valid-looking stale event ID.
    eventId: `${game.gameId}:FINAL:${score.homeScore}-${score.awayScore}`,
  };
}

function recordInternal(
  state: PlayoffBracketState,
  seriesId: string,
  gameNumber: number,
  score: PostseasonScore,
  options: PlayoffRecordOptions,
): PlayoffRecordResult {
  if (state.status === "WAITING_FOR_PLAY_IN") {
    return { status: "REJECTED", code: "NOT_INITIALIZED", reason: "附加赛尚未全部结束" };
  }
  const seriesIndex = state.series.findIndex((candidate) => candidate.seriesId === seriesId);
  if (seriesIndex < 0) return { status: "REJECTED", code: "UNKNOWN_SERIES", reason: "系列赛不存在或尚未生成" };
  const series = state.series[seriesIndex];
  const existing = series.games.find((game) => game.gameNumber === gameNumber);
  if (existing?.status === "FINAL") {
    if (existing.score?.homeScore === score.homeScore && existing.score.awayScore === score.awayScore) {
      return { status: "NOOP", state, reason: "该场季后赛结果已记录" };
    }
    return { status: "REJECTED", code: "CONFLICT", reason: "该场比赛已结束，不能以不同比分重放" };
  }
  if (state.status === "COMPLETE" || series.status === "FINAL") {
    return { status: "REJECTED", code: "SERIES_COMPLETE", reason: "系列赛已结束，不能追加比赛" };
  }
  const scheduled = series.games.find((game) => game.status === "SCHEDULED");
  if (!safeInteger(gameNumber, 1, 7) || !scheduled || scheduled.gameNumber !== gameNumber) {
    return { status: "REJECTED", code: "OUT_OF_ORDER", reason: "只能结算该系列赛当前待赛场次" };
  }
  if (options.expectedRevision !== undefined && options.expectedRevision !== state.revision) {
    return { status: "REJECTED", code: "STALE", reason: "季后赛状态已更新，请刷新后重试" };
  }
  if (!validScore(score)) return { status: "REJECTED", code: "INVALID_SCORE", reason: "季后赛比分无效" };
  if (score.homeScore === score.awayScore) return { status: "REJECTED", code: "TIED", reason: "季后赛比赛不能以平局结束" };

  const completedGame = finalGame(scheduled, score);
  const teamAWon = completedGame.winnerTeamId === series.teamAId;
  const teamAWins = series.teamAWins + (teamAWon ? 1 : 0);
  const teamBWins = series.teamBWins + (teamAWon ? 0 : 1);
  const clinched = teamAWins === PLAYOFF_WINS_NEEDED || teamBWins === PLAYOFF_WINS_NEEDED;
  const winnerTeamId = clinched ? (teamAWins === PLAYOFF_WINS_NEEDED ? series.teamAId : series.teamBId) : null;
  const loserTeamId = clinched ? (winnerTeamId === series.teamAId ? series.teamBId : series.teamAId) : null;
  const updatedWithoutGames: Omit<PlayoffSeries, "games"> = {
    ...series,
    status: clinched ? "FINAL" : "ACTIVE",
    revision: series.revision + 1,
    teamAWins,
    teamBWins,
    winnerTeamId,
    loserTeamId,
  };
  const games = [...series.games.filter((game) => game.gameId !== scheduled.gameId), completedGame];
  if (!clinched) games.push(scheduledGame(updatedWithoutGames, gameNumber + 1));
  const updatedSeries: PlayoffSeries = { ...updatedWithoutGames, games };
  const nextSeries = [...state.series];
  nextSeries[seriesIndex] = updatedSeries;
  let next: PlayoffBracketState = {
    ...state,
    revision: state.revision + 1,
    eventIds: [...new Set([...state.eventIds, completedGame.eventId!])].sort(),
    series: sortSeries(nextSeries),
  };
  next = addReadySeries(next);
  return { status: "APPLIED", state: next, eventId: completedGame.eventId! };
}

export function recordPlayoffGameResult(
  state: PlayoffBracketState,
  seriesId: string,
  gameNumber: number,
  score: PostseasonScore,
  options: PlayoffRecordOptions = {},
): PlayoffRecordResult {
  if (!isPlayoffBracketState(state)) {
    return { status: "REJECTED", code: "INVALID_STATE", reason: "季后赛系列赛状态无效" };
  }
  const result = recordInternal(state, seriesId, gameNumber, score, options);
  if (result.status === "APPLIED") assertPlayoffBracketState(result.state);
  return result;
}

export function derivePlayoffSimulationSeed(state: PlayoffBracketState, seriesId: string, gameNumber: number) {
  const series = state.series.find((candidate) => candidate.seriesId === seriesId);
  const game = series?.games.find((candidate) => candidate.gameNumber === gameNumber);
  if (!series || !game) throw new Error("Cannot derive a seed for an unknown playoff game");
  return simpleHash(`${state.seasonSeed}:${state.freezeEventId}:${seriesId}:${gameNumber}:${game.homeTeamId}:${game.awayTeamId}`);
}

export function simulateNextPlayoffGame(
  state: PlayoffBracketState,
  seriesId: string,
  options: PlayoffRecordOptions = {},
): PlayoffRecordResult {
  if (!isPlayoffBracketState(state)) {
    return { status: "REJECTED", code: "INVALID_STATE", reason: "季后赛系列赛状态无效" };
  }
  const series = state.series.find((candidate) => candidate.seriesId === seriesId);
  if (!series) return { status: "REJECTED", code: "UNKNOWN_SERIES", reason: "系列赛不存在或尚未生成" };
  const game = nextPlayoffGame(state, seriesId);
  if (!game) return { status: "REJECTED", code: "SERIES_COMPLETE", reason: "系列赛已结束，不能继续模拟" };
  const seed = derivePlayoffSimulationSeed(state, seriesId, game.gameNumber);
  const simulated = simulatePostseasonScore(game.awayTeamId, game.homeTeamId, seed);
  return recordPlayoffGameResult(state, seriesId, game.gameNumber, simulated.result, options);
}

export function playoffComplete(state: PlayoffBracketState) {
  return state.status === "COMPLETE" && state.championTeamId !== null;
}

function basicCandidateShape(value: unknown): value is PlayoffBracketState {
  if (!isPlainObject(value)) return false;
  const candidate = value as unknown as PlayoffBracketState;
  if (candidate.schemaVersion !== PLAYOFF_BRACKET_SCHEMA_VERSION
    || candidate.rulesVersion !== PLAYOFF_RULES_VERSION
    || typeof candidate.freezeEventId !== "string"
    || candidate.freezeEventId.length === 0
    || candidate.freezeEventId.trim() !== candidate.freezeEventId
    || !safeInteger(candidate.seasonSeed, 0, 0xffff_ffff)
    || !["WAITING_FOR_PLAY_IN", "IN_PROGRESS", "COMPLETE"].includes(candidate.status)
    || !safeInteger(candidate.revision, 0, 105)
    || !Array.isArray(candidate.eventIds)
    || candidate.eventIds.some((eventId) => typeof eventId !== "string")
    || new Set(candidate.eventIds).size !== candidate.eventIds.length
    || canonicalString(candidate.eventIds) !== canonicalString([...candidate.eventIds].sort())
    || !isPlainObject(candidate.seeds)
    || !Array.isArray(candidate.series)
    || !isPlainObject(candidate.conferenceChampionTeamIds)) return false;
  for (const series of candidate.series) {
    if (!isPlainObject(series)
      || typeof series.seriesId !== "string"
      || !Array.isArray(series.participantSources)
      || !Array.isArray(series.games)) return false;
    for (const game of series.games) {
      if (!isPlainObject(game) || typeof game.gameId !== "string") return false;
      if (game.score !== null && !isPlainObject(game.score)) return false;
    }
  }
  return true;
}

function canonicalValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("Cyclic playoff state");
    seen.add(value);
    const result = value.map((item) => canonicalValue(item, seen));
    seen.delete(value);
    return result;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) throw new Error("Cyclic playoff state");
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalValue(value[key], seen);
    seen.delete(value);
    return result;
  }
  return value;
}

function canonicalString(value: unknown) {
  return JSON.stringify(canonicalValue(value, new WeakSet<object>()));
}

/**
 * Strict validator by deterministic replay. Every stored FINAL game is applied
 * from a fresh bracket; the fully rebuilt value must equal the candidate.
 */
export function assertPlayoffBracketState(value: unknown): asserts value is PlayoffBracketState {
  if (!basicCandidateShape(value)) throw new Error("Playoff bracket has an invalid root shape");
  const candidate = value;
  if (candidate.status === "WAITING_FOR_PLAY_IN") {
    const expected = createWaitingPlayoffBracket(candidate.freezeEventId, candidate.seasonSeed);
    if (canonicalString(candidate) !== canonicalString(expected)) throw new Error("Waiting playoff bracket contains derived state");
    return;
  }
  const seedError = seedFieldValidationError(candidate.seeds);
  if (seedError) throw new Error(`Playoff seed field is invalid: ${seedError}`);
  let replayed = initializeInternal(
    createWaitingPlayoffBracket(candidate.freezeEventId, candidate.seasonSeed),
    candidate.seeds,
  );
  let appliedCount = 0;
  while (appliedCount <= 105) {
    let progressed = false;
    for (const replaySeries of [...replayed.series]) {
      const frontier = nextPlayoffGame(replayed, replaySeries.seriesId);
      if (!frontier) continue;
      const storedSeries = candidate.series.find((series) => series.seriesId === replaySeries.seriesId);
      const storedGame = storedSeries?.games.find((game) => game.gameId === frontier.gameId);
      if (!storedGame || storedGame.status !== "FINAL") continue;
      if (!storedGame.score || !validScore(storedGame.score) || storedGame.score.homeScore === storedGame.score.awayScore) {
        throw new Error("Stored playoff FINAL game has an invalid score");
      }
      const result = recordInternal(replayed, replaySeries.seriesId, frontier.gameNumber, storedGame.score, {});
      if (result.status !== "APPLIED") throw new Error("Stored playoff game cannot be replayed");
      replayed = result.state;
      appliedCount += 1;
      progressed = true;
      break;
    }
    if (!progressed) break;
  }
  if (appliedCount > 105) throw new Error("Playoff bracket exceeds the maximum game count");
  if (canonicalString(candidate) !== canonicalString(replayed)) {
    throw new Error("Playoff bracket drifts from deterministic replay");
  }
}

export function isPlayoffBracketState(value: unknown): value is PlayoffBracketState {
  try {
    assertPlayoffBracketState(value);
    return true;
  } catch {
    return false;
  }
}

export const careerPlayoffsPublicApi = {
  createWaitingPlayoffBracket,
  initializePlayoffFirstRound,
  nextPlayoffGame,
  scheduledPlayoffGames,
  seriesScore,
  recordPlayoffGameResult,
  simulateNextPlayoffGame,
  derivePlayoffSimulationSeed,
  playoffComplete,
  isPlayoffBracketState,
  assertPlayoffBracketState,
};
