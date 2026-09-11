import { leagueTeams, type Conference } from "./player-creation";
import { simulatePostseasonScore, type CareerSeasonState } from "./career-season";
import {
  createWaitingPlayoffBracket,
  initializePlayoffFirstRound,
  isPlayoffBracketState,
  nextPlayoffGame,
  recordPlayoffGameResult,
  scheduledPlayoffGames,
  simulateNextPlayoffGame,
  type PlayoffBracketState,
  type PlayoffGame,
  type PlayoffRecordOptions,
  type PlayoffSeedField,
  type PlayoffSeedTeam,
} from "./career-playoffs";

/**
 * M6B-1 — Final standings freeze and play-in tournament.
 *
 * Pure, JSON-safe postseason domain. Nothing here touches React or storage.
 * Rules are frozen in docs/engineering/m6b-1-rule-decisions.md:
 *
 * - Freeze only when all 1,230 regular-season games are FINAL (cup resolved).
 * - Rankings are recomputed from FINAL game results only; the mutable
 *   `season.standings` aggregate is never trusted for ordering.
 * - Division winners are resolved first. Two-team and multi-team tie-breaks
 *   then follow the official hierarchy (division-winner status, head-to-head,
 *   division/conference record, record vs postseason-eligible opponents and
 *   point differential), with a seeded deterministic random draw only after
 *   every official criterion is exhausted.
 * - Multi-team ties restart from the two-team procedure whenever the tie is
 *   reduced to exactly two teams at any criterion.
 * - Play-in: A = seed 7 hosts 8; B = seed 9 hosts 10; C (A loser hosts
 *   B winner) exists only after A and B are both FINAL.
 * - Seeds 1–6 qualify directly and never appear in any play-in game.
 * - Repeated operations are idempotent no-ops; replaying a FINAL game with a
 *   different score is a CONFLICT and never overwrites history.
 */
export const POSTSEASON_SCHEMA_VERSION = 2 as const;
export const LEGACY_POSTSEASON_SCHEMA_VERSION = 1 as const;
export const RANKING_RULES_VERSION = "m6b1-tiebreak-v1" as const;
export const REGULAR_SEASON_TOTAL_GAMES = 1_230 as const;

export type PostseasonConference = Conference;
export { type Conference } from "./player-creation";
export type DivisionId =
  | "ATLANTIC" | "CENTRAL" | "SOUTHEAST"
  | "NORTHWEST" | "PACIFIC" | "SOUTHWEST";
export type PlayInSlot = "A" | "B" | "C";
export type PostseasonGameStatus = "SCHEDULED" | "FINAL";
export type PlayInOutcome = "DIRECT" | "PLAY_IN" | "OUT";

/** Canonical division map keyed by the team IDs from player-creation.ts. */
export const DIVISION_BY_TEAM_ID: Readonly<Record<string, DivisionId>> = {
  CELTICS: "ATLANTIC", NETS: "ATLANTIC", KNICKS: "ATLANTIC", SIXERS: "ATLANTIC", RAPTORS: "ATLANTIC",
  BULLS: "CENTRAL", CAVALIERS: "CENTRAL", PISTONS: "CENTRAL", PACERS: "CENTRAL", BUCKS: "CENTRAL",
  HAWKS: "SOUTHEAST", HORNETS: "SOUTHEAST", HEAT: "SOUTHEAST", MAGIC: "SOUTHEAST", WIZARDS: "SOUTHEAST",
  NUGGETS: "NORTHWEST", TIMBERWOLVES: "NORTHWEST", THUNDER: "NORTHWEST", TRAIL_BLAZERS: "NORTHWEST", JAZZ: "NORTHWEST",
  WARRIORS: "PACIFIC", CLIPPERS: "PACIFIC", LAKERS: "PACIFIC", SUNS: "PACIFIC", KINGS: "PACIFIC",
  MAVERICKS: "SOUTHWEST", ROCKETS: "SOUTHWEST", GRIZZLIES: "SOUTHWEST", PELICANS: "SOUTHWEST", SPURS: "SOUTHWEST",
};

const teamById = new Map(leagueTeams.map((team) => [team.id, team]));
const teamsByConference: Record<Conference, string[]> = {
  EAST: leagueTeams.filter((team) => team.conference === "EAST").map((team) => team.id),
  WEST: leagueTeams.filter((team) => team.conference === "WEST").map((team) => team.id),
};

function assertConferenceMembership() {
  if (teamsByConference.EAST.length !== 15 || teamsByConference.WEST.length !== 15) {
    throw new Error("Conference membership is not exactly 15 teams per conference");
  }
}
assertConferenceMembership();

/** Head-to-head subset map; only intra-conference opponents are persisted. */
export interface HeadToHeadRecord {
  wins: number;
  losses: number;
}

export interface TeamTieBreakEvidence {
  teamId: string;
  division: DivisionId;
  /** Resolved before conference seeding, as required by the tie-break rules. */
  divisionWinner: boolean;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  divisionWins: number;
  divisionLosses: number;
  conferenceWins: number;
  conferenceLosses: number;
  /** Record against same-conference opponents with a conference record >= .500. */
  eligibleConferenceWins: number;
  eligibleConferenceLosses: number;
  /** Record against opposite-conference opponents with a conference record >= .500. */
  eligibleOppositeWins: number;
  eligibleOppositeLosses: number;
  opponent: Record<string, HeadToHeadRecord>;
}

export interface RankedTeamEntry {
  /** Final conference rank, 1..15. */
  rank: number;
  teamId: string;
  wins: number;
  losses: number;
  division: DivisionId;
  divisionWinner: boolean;
  /** Play-in seeding slot (rank 1..10) or null for teams ranked 11–15. */
  playInSeed: number | null;
  outcome: PlayInOutcome;
}

/** Immutable per-conference ranking snapshot. */
export interface ConferenceRankingSnapshot {
  conference: Conference;
  rankingRulesVersion: typeof RANKING_RULES_VERSION;
  teams: RankedTeamEntry[];
}

export interface PlayInScore {
  homeScore: number;
  awayScore: number;
}

export interface PlayInGame {
  slot: PlayInSlot;
  conference: Conference;
  gameId: string;
  status: PostseasonGameStatus;
  homeTeamId: string;
  awayTeamId: string;
  homeSeed: number;
  awaySeed: number;
  /** Home-team score first. Set only when FINAL. */
  score: PlayInScore | null;
  winnerTeamId: string | null;
  loserTeamId: string | null;
  /** Stable id of the event that made this game FINAL. */
  eventId: string | null;
}

export interface ConferencePlayInBracket {
  conference: Conference;
  revision: number;
  /** Game C does not exist until A and B are both FINAL. */
  gameA: PlayInGame;
  gameB: PlayInGame;
  gameC: PlayInGame | null;
  /** Final #7 (winner of A) once A is FINAL. */
  finalSeed7TeamId: string | null;
  /** Final #8 (winner of C) once C is FINAL. */
  finalSeed8TeamId: string | null;
  /** Direct qualifiers (seeds 1–6) — fixed at freeze time. */
  directQualifierTeamIds: string[];
  /** B loser, followed by C loser once those games are final. */
  eliminatedTeamIds: string[];
}

/**
 * Frozen regular-season evidence for all 15 teams in each conference. The
 * final eight-team seed field is selected from this pool after both play-in
 * brackets finish, so Finals home-court rules never need mutable UI data.
 */
export interface PlayoffSeedEvidencePool {
  EAST: PlayoffSeedTeam[];
  WEST: PlayoffSeedTeam[];
}

export interface PostseasonState {
  schemaVersion: typeof POSTSEASON_SCHEMA_VERSION;
  rankingRulesVersion: typeof RANKING_RULES_VERSION;
  freezeEventId: string;
  frozen: boolean;
  revision: number;
  eventIds: string[];
  east: ConferenceRankingSnapshot;
  west: ConferenceRankingSnapshot;
  playIn: {
    EAST: ConferencePlayInBracket;
    WEST: ConferencePlayInBracket;
  };
  playoffSeedPool: PlayoffSeedEvidencePool;
  playoffs: PlayoffBracketState;
}

export type PostseasonFreezeResult =
  | { status: "FROZEN"; state: PostseasonState }
  | { status: "ALREADY_FROZEN"; state: PostseasonState }
  | { status: "NOT_READY"; unfinishedCount: number; totalGames: number; reason: string }
  | { status: "REJECTED"; code: "MISMATCH"; reason: string };

export type PlayInRecordResult =
  | { status: "APPLIED"; state: PostseasonState; eventId: string }
  | { status: "NOOP"; state: PostseasonState; reason: string }
  | { status: "REJECTED"; code: "TIED" | "INVALID_MATCHUP" | "OUT_OF_ORDER" | "CONFLICT" | "NOT_SCHEDULED" | "NOT_FROZEN" | "STALE"; reason: string };

export interface PlayInRecordOptions {
  expectedRevision?: number;
}

export type PostseasonPlayoffRecordResult =
  | { status: "APPLIED"; state: PostseasonState; eventId: string }
  | { status: "NOOP"; state: PostseasonState; reason: string }
  | { status: "REJECTED"; code: "INVALID_STATE" | "NOT_INITIALIZED" | "UNKNOWN_SERIES" | "OUT_OF_ORDER" | "TIED" | "INVALID_SCORE" | "CONFLICT" | "SERIES_COMPLETE" | "STALE"; reason: string };

/* ------------------------------------------------------------------ *
 * Evidence computation (recomputed from FINAL games only)
 * ------------------------------------------------------------------ */

interface BaseEvidence {
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  divisionWins: number;
  divisionLosses: number;
  conferenceWins: number;
  conferenceLosses: number;
  opponent: Record<string, HeadToHeadRecord>;
}

function emptyBaseEvidence(): BaseEvidence {
  return {
    wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0,
    divisionWins: 0, divisionLosses: 0, conferenceWins: 0, conferenceLosses: 0,
    opponent: {},
  };
}

function recordGame(
  evidence: BaseEvidence,
  teamId: string,
  opponentId: string,
  ownScore: number,
  opponentScore: number,
  sameDivision: boolean,
  sameConference: boolean,
) {
  evidence.pointsFor += ownScore;
  evidence.pointsAgainst += opponentScore;
  const won = ownScore > opponentScore;
  if (won) evidence.wins += 1; else evidence.losses += 1;
  if (sameDivision) { if (won) evidence.divisionWins += 1; else evidence.divisionLosses += 1; }
  if (sameConference) { if (won) evidence.conferenceWins += 1; else evidence.conferenceLosses += 1; }
  const head = (evidence.opponent[opponentId] ??= { wins: 0, losses: 0 });
  if (won) head.wins += 1; else head.losses += 1;
}

function computeBaseEvidence(season: CareerSeasonState): Record<string, BaseEvidence> {
  const evidence = Object.fromEntries(leagueTeams.map((team) => [team.id, emptyBaseEvidence()]));
  for (const game of season.games) {
    if (game.status !== "FINAL" || !game.result) continue;
    if (!teamById.has(game.awayTeamId) || !teamById.has(game.homeTeamId)) {
      throw new Error(`Final game ${game.id} references an unknown team`);
    }
    const sameDivision = DIVISION_BY_TEAM_ID[game.awayTeamId] === DIVISION_BY_TEAM_ID[game.homeTeamId];
    const sameConference = teamById.get(game.awayTeamId)!.conference === teamById.get(game.homeTeamId)!.conference;
    recordGame(evidence[game.awayTeamId], game.awayTeamId, game.homeTeamId, game.result.awayScore, game.result.homeScore, sameDivision, sameConference);
    recordGame(evidence[game.homeTeamId], game.homeTeamId, game.awayTeamId, game.result.homeScore, game.result.awayScore, sameDivision, sameConference);
  }
  return evidence;
}

function buildPlayoffSeedPool(
  base: Record<string, BaseEvidence>,
  east: ConferenceRankingSnapshot,
  west: ConferenceRankingSnapshot,
): PlayoffSeedEvidencePool {
  const buildConference = (conference: Conference, snapshot: ConferenceRankingSnapshot) => snapshot.teams.map((entry) => {
    const line = base[entry.teamId];
    let oppositeConferenceWins = 0;
    let oppositeConferenceLosses = 0;
    for (const [opponentId, record] of Object.entries(line.opponent)) {
      if (teamById.get(opponentId)?.conference === conference) continue;
      oppositeConferenceWins += record.wins;
      oppositeConferenceLosses += record.losses;
    }
    return {
      teamId: entry.teamId,
      conference,
      seed: entry.rank,
      wins: line.wins,
      losses: line.losses,
      oppositeConferenceWins,
      oppositeConferenceLosses,
      headToHead: Object.fromEntries(Object.entries(line.opponent).map(([teamId, record]) => [teamId, { ...record }])),
    } satisfies PlayoffSeedTeam;
  });
  return {
    EAST: buildConference("EAST", east),
    WEST: buildConference("WEST", west),
  };
}

function winPercentage(wins: number, losses: number) {
  return wins + losses === 0 ? 0.5 : wins / (wins + losses);
}

/**
 * The eligible-opponent criteria use the ten best regular-season records in
 * each conference, including every team tied with the tenth-best record. The
 * set is derived from overall record before the seeding tie-break itself, so
 * the criterion never becomes circular.
 */
function postseasonEligibleIds(base: Record<string, BaseEvidence>, conference: Conference) {
  const records = teamsByConference[conference]
    .map((teamId) => ({ teamId, percentage: winPercentage(base[teamId].wins, base[teamId].losses) }))
    .sort((first, second) => second.percentage - first.percentage || first.teamId.localeCompare(second.teamId));
  const threshold = records[9]?.percentage ?? Number.POSITIVE_INFINITY;
  return new Set(records.filter((entry) => entry.percentage + 1e-9 >= threshold).map((entry) => entry.teamId));
}

function finalizeEvidence(
  base: Record<string, BaseEvidence>,
  conference: Conference,
): Record<string, TeamTieBreakEvidence> {
  const eastEligible = postseasonEligibleIds(base, "EAST");
  const westEligible = postseasonEligibleIds(base, "WEST");
  const eligibleInConference = conference === "EAST" ? eastEligible : westEligible;
  const eligibleOpposite = conference === "EAST" ? westEligible : eastEligible;
  const result: Record<string, TeamTieBreakEvidence> = {};
  for (const teamId of teamsByConference[conference]) {
    const line = base[teamId];
    let eligibleConferenceWins = 0;
    let eligibleConferenceLosses = 0;
    let eligibleOppositeWins = 0;
    let eligibleOppositeLosses = 0;
    for (const [opponentId, head] of Object.entries(line.opponent)) {
      const opponentTeam = teamById.get(opponentId)!;
      if (opponentTeam.conference === conference) {
        if (eligibleInConference.has(opponentId)) {
          eligibleConferenceWins += head.wins;
          eligibleConferenceLosses += head.losses;
        }
      } else if (eligibleOpposite.has(opponentId)) {
        eligibleOppositeWins += head.wins;
        eligibleOppositeLosses += head.losses;
      }
    }
    result[teamId] = {
      teamId,
      division: DIVISION_BY_TEAM_ID[teamId],
      divisionWinner: false,
      wins: line.wins,
      losses: line.losses,
      pointsFor: line.pointsFor,
      pointsAgainst: line.pointsAgainst,
      divisionWins: line.divisionWins,
      divisionLosses: line.divisionLosses,
      conferenceWins: line.conferenceWins,
      conferenceLosses: line.conferenceLosses,
      eligibleConferenceWins,
      eligibleConferenceLosses,
      eligibleOppositeWins,
      eligibleOppositeLosses,
      opponent: { ...line.opponent },
    };
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Tie-break procedures
 * ------------------------------------------------------------------ */

interface TieBreakOptions {
  /** False only while resolving a division winner itself. */
  useDivisionWinner: boolean;
  /** Official two-team conference seeding includes this criterion. */
  includeOppositeEligible: boolean;
  /** Makes the official final random drawing reproducible across reloads. */
  fallbackKey: string;
}

const defaultTieBreakOptions: TieBreakOptions = {
  useDivisionWinner: true,
  includeOppositeEligible: true,
  fallbackKey: "postseason-draw",
};

function deterministicDrawComparison(
  first: TeamTieBreakEvidence,
  second: TeamTieBreakEvidence,
  candidates: TeamTieBreakEvidence[],
  fallbackKey: string,
) {
  const groupKey = candidates.map((team) => team.teamId).sort().join(",");
  const firstDraw = simpleHash(`${fallbackKey}:${groupKey}:${first.teamId}`);
  const secondDraw = simpleHash(`${fallbackKey}:${groupKey}:${second.teamId}`);
  if (firstDraw !== secondDraw) return firstDraw < secondDraw ? -1 : 1;
  return first.teamId.localeCompare(second.teamId);
}

/** Returns < 0 when `first` ranks ahead of `second`. */
function compareTwoTeams(
  first: TeamTieBreakEvidence,
  second: TeamTieBreakEvidence,
  options: TieBreakOptions,
): number {
  const head = first.opponent[second.teamId];
  const reverseHead = second.opponent[first.teamId];
  if (head && reverseHead && (head.wins + head.losses) > 0) {
    const diff = winPercentage(head.wins, head.losses) - winPercentage(reverseHead.wins, reverseHead.losses);
    if (Math.abs(diff) > 1e-9) return diff > 0 ? -1 : 1;
  }
  if (options.useDivisionWinner && first.divisionWinner !== second.divisionWinner) {
    return first.divisionWinner ? -1 : 1;
  }
  if (first.division === second.division) {
    const divisionDiff = winPercentage(first.divisionWins, first.divisionLosses) - winPercentage(second.divisionWins, second.divisionLosses);
    if (Math.abs(divisionDiff) > 1e-9) return divisionDiff > 0 ? -1 : 1;
  }
  const conferenceDiff = winPercentage(first.conferenceWins, first.conferenceLosses) - winPercentage(second.conferenceWins, second.conferenceLosses);
  if (Math.abs(conferenceDiff) > 1e-9) return conferenceDiff > 0 ? -1 : 1;
  const eligibleDiff = winPercentage(first.eligibleConferenceWins, first.eligibleConferenceLosses) - winPercentage(second.eligibleConferenceWins, second.eligibleConferenceLosses);
  if (Math.abs(eligibleDiff) > 1e-9) return eligibleDiff > 0 ? -1 : 1;
  if (options.includeOppositeEligible) {
    const oppositeDiff = winPercentage(first.eligibleOppositeWins, first.eligibleOppositeLosses) - winPercentage(second.eligibleOppositeWins, second.eligibleOppositeLosses);
    if (Math.abs(oppositeDiff) > 1e-9) return oppositeDiff > 0 ? -1 : 1;
  }
  const differentialFirst = first.pointsFor - first.pointsAgainst;
  const differentialSecond = second.pointsFor - second.pointsAgainst;
  if (differentialFirst !== differentialSecond) return differentialFirst > differentialSecond ? -1 : 1;
  return deterministicDrawComparison(first, second, [first, second], options.fallbackKey);
}

function headToHeadValueAgainst(team: TeamTieBreakEvidence, candidates: TeamTieBreakEvidence[]) {
  let wins = 0;
  let losses = 0;
  for (const other of candidates) {
    if (other.teamId === team.teamId) continue;
    const head = team.opponent[other.teamId];
    if (head) {
      wins += head.wins;
      losses += head.losses;
    }
  }
  return winPercentage(wins, losses);
}

function allEqualIn(values: number[]) {
  return values.every((value) => Math.abs(value - values[0]) < 1e-9);
}

/**
 * Orders a group of teams that are tied on overall record. Follows the
 * official multi-team hierarchy; when the group is reduced to two teams at
 * any criterion the two-team procedure restarts from the top. Returns a
 * deterministic total order (best first).
 */
export function orderTiedTeams(
  evidence: TeamTieBreakEvidence[],
  overrides: Partial<TieBreakOptions> = {},
): string[] {
  const options = { ...defaultTieBreakOptions, ...overrides };
  const candidates = [...evidence];
  if (candidates.length <= 1) return candidates.map((team) => team.teamId);
  if (candidates.length === 2) {
    const [first, second] = candidates;
    const comparison = compareTwoTeams(first, second, options);
    return comparison <= 0 ? [first.teamId, second.teamId] : [second.teamId, first.teamId];
  }
  const criteria: Array<(team: TeamTieBreakEvidence) => number> = [
    ...(options.useDivisionWinner ? [(team: TeamTieBreakEvidence) => team.divisionWinner ? 1 : 0] : []),
    (team) => headToHeadValueAgainst(team, candidates),
    (team) => (candidates.every((item) => item.division === candidates[0].division)
      ? winPercentage(team.divisionWins, team.divisionLosses)
      : 0),
    (team) => winPercentage(team.conferenceWins, team.conferenceLosses),
    (team) => winPercentage(team.eligibleConferenceWins, team.eligibleConferenceLosses),
    (team) => team.pointsFor - team.pointsAgainst,
  ];
  for (const criterion of criteria) {
    const values = candidates.map(criterion);
    if (allEqualIn(values)) continue;
    const sorted = candidates
      .map((team) => ({ team, value: criterion(team) }))
      .sort((first, second) => second.value - first.value || first.team.teamId.localeCompare(second.team.teamId));
    const groups: TeamTieBreakEvidence[][] = [];
    for (const item of sorted) {
      const current = groups.at(-1);
      if (!current || Math.abs(criterion(current[0]) - item.value) >= 1e-9) groups.push([item.team]);
      else current.push(item.team);
    }
    // A complete break keeps this criterion's full order. A partial break
    // restarts the appropriate procedure independently inside each tied group.
    return groups.flatMap((group) => group.length === 1 ? group[0].teamId : orderTiedTeams(group, options));
  }
  // Official random drawing, made deterministic for save/replay identity.
  return candidates
    .sort((first, second) => deterministicDrawComparison(first, second, candidates, options.fallbackKey))
    .map((team) => team.teamId);
}

function resolveDivisionWinnerIds(
  evidence: Record<string, TeamTieBreakEvidence>,
  fallbackKey: string,
) {
  const winners = new Set<string>();
  const divisions = [...new Set(Object.values(DIVISION_BY_TEAM_ID))];
  for (const division of divisions) {
    const divisionTeams = Object.values(evidence).filter((team) => team.division === division);
    const bestPercentage = Math.max(...divisionTeams.map((team) => winPercentage(team.wins, team.losses)));
    const tiedForLead = divisionTeams.filter(
      (team) => Math.abs(winPercentage(team.wins, team.losses) - bestPercentage) < 1e-9,
    );
    const winner = tiedForLead.length === 1
      ? tiedForLead[0].teamId
      : orderTiedTeams(tiedForLead, {
        useDivisionWinner: false,
        includeOppositeEligible: false,
        fallbackKey: `${fallbackKey}:division:${division}`,
      })[0];
    winners.add(winner);
  }
  return winners;
}

function markDivisionWinners(
  evidence: Record<string, TeamTieBreakEvidence>,
  winnerIds: Set<string>,
) {
  return Object.fromEntries(Object.entries(evidence).map(([teamId, team]) => [
    teamId,
    { ...team, divisionWinner: winnerIds.has(teamId) },
  ])) as Record<string, TeamTieBreakEvidence>;
}

function rankConference(
  conference: Conference,
  evidence: Record<string, TeamTieBreakEvidence>,
  fallbackKey: string,
): RankedTeamEntry[] {
  const teams = teamsByConference[conference].map((teamId) => evidence[teamId]);
  const primary = [...teams].sort((first, second) => {
    const recordDiff = winPercentage(second.wins, second.losses) - winPercentage(first.wins, first.losses);
    if (Math.abs(recordDiff) > 1e-9) return recordDiff;
    return 0;
  });
  const ranked: RankedTeamEntry[] = [];
  let index = 0;
  while (index < primary.length) {
    const team = primary[index];
    let end = index + 1;
    while (
      end < primary.length
      && Math.abs(winPercentage(primary[end].wins, primary[end].losses) - winPercentage(team.wins, team.losses)) < 1e-9
    ) {
      end += 1;
    }
    const group = primary.slice(index, end);
    const orderedIds = group.length > 1
      ? orderTiedTeams(group, { fallbackKey: `${fallbackKey}:${conference}:${team.wins}-${team.losses}` })
      : [group[0].teamId];
    for (const teamId of orderedIds) {
      const entry = evidence[teamId];
      const rank = ranked.length + 1;
      const outcome: PlayInOutcome = rank <= 6 ? "DIRECT" : rank <= 10 ? "PLAY_IN" : "OUT";
      ranked.push({
        rank,
        teamId,
        wins: entry.wins,
        losses: entry.losses,
        division: entry.division,
        divisionWinner: entry.divisionWinner,
        playInSeed: rank <= 10 ? rank : null,
        outcome,
      });
    }
    index = end;
  }
  if (ranked.length !== 15) throw new Error("Conference ranking did not produce 15 teams");
  return ranked;
}

/* ------------------------------------------------------------------ *
 * Freeze
 * ------------------------------------------------------------------ */

function contentFingerprint(season: CareerSeasonState) {
  const lines = season.games
    .filter((game) => game.status === "FINAL")
    .map((game) => `${game.id}:${game.result!.awayScore}-${game.result!.homeScore}`)
    .sort();
  return simpleHash(lines.join("|")).toString(16).padStart(8, "0");
}

function postseasonFreezeEventId(season: CareerSeasonState) {
  return `postseason-freeze-${season.startYear}-${contentFingerprint(season)}`;
}

function simpleHash(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function regularSeasonComplete(season: CareerSeasonState) {
  if (!season.cupResolved) return { complete: false, unfinishedCount: season.games.filter((game) => game.status !== "FINAL").length, reason: "杯赛赛程尚未生成" };
  if (season.games.length !== REGULAR_SEASON_TOTAL_GAMES) {
    return {
      complete: false,
      unfinishedCount: Math.max(0, REGULAR_SEASON_TOTAL_GAMES - season.games.filter((game) => game.status === "FINAL").length),
      reason: `常规赛总场次为 ${season.games.length}，应为 ${REGULAR_SEASON_TOTAL_GAMES}`,
    };
  }
  const unfinishedCount = season.games.filter((game) => game.status !== "FINAL").length;
  if (unfinishedCount > 0) return { complete: false, unfinishedCount, reason: `仍有 ${unfinishedCount} 场常规赛未结束` };
  const gameIds = new Set<string>();
  const gamesByTeam = new Map(leagueTeams.map((team) => [team.id, 0]));
  for (const game of season.games) {
    if (gameIds.has(game.id)) return { complete: false, unfinishedCount: 0, reason: `常规赛包含重复场次 ${game.id}` };
    gameIds.add(game.id);
    if (!teamById.has(game.awayTeamId) || !teamById.has(game.homeTeamId) || game.awayTeamId === game.homeTeamId) {
      return { complete: false, unfinishedCount: 0, reason: `常规赛场次 ${game.id} 的球队无效` };
    }
    if (!game.result
      || !Number.isSafeInteger(game.result.awayScore)
      || !Number.isSafeInteger(game.result.homeScore)
      || game.result.awayScore < 0
      || game.result.homeScore < 0
      || game.result.awayScore > 300
      || game.result.homeScore > 300
      || game.result.awayScore === game.result.homeScore) {
      return { complete: false, unfinishedCount: 0, reason: `常规赛场次 ${game.id} 的终场比分无效` };
    }
    gamesByTeam.set(game.awayTeamId, gamesByTeam.get(game.awayTeamId)! + 1);
    gamesByTeam.set(game.homeTeamId, gamesByTeam.get(game.homeTeamId)! + 1);
  }
  const invalidTeam = leagueTeams.find((team) => gamesByTeam.get(team.id) !== 82);
  if (invalidTeam) {
    return {
      complete: false,
      unfinishedCount: 0,
      reason: `${invalidTeam.shortName}常规赛场次为 ${gamesByTeam.get(invalidTeam.id)}，应为 82`,
    };
  }
  return { complete: true, unfinishedCount: 0, reason: "" };
}

function buildPlayInGame(
  conference: Conference,
  slot: PlayInSlot,
  homeSeed: number,
  awaySeed: number,
  snapshot: ConferenceRankingSnapshot,
): PlayInGame {
  const home = snapshot.teams.find((entry) => entry.playInSeed === homeSeed)!;
  const away = snapshot.teams.find((entry) => entry.playInSeed === awaySeed)!;
  return {
    slot,
    conference,
    gameId: `playin-${conference}-${slot}`,
    status: "SCHEDULED",
    homeTeamId: home.teamId,
    awayTeamId: away.teamId,
    homeSeed,
    awaySeed,
    score: null,
    winnerTeamId: null,
    loserTeamId: null,
    eventId: null,
  };
}

export function createPostseasonState(season: CareerSeasonState): PostseasonState {
  const readiness = regularSeasonComplete(season);
  if (!readiness.complete) {
    throw new Error(`Cannot freeze before the regular season ends: ${readiness.reason}`);
  }
  const base = computeBaseEvidence(season);
  const fingerprint = contentFingerprint(season);
  const preliminaryEast = finalizeEvidence(base, "EAST");
  const preliminaryWest = finalizeEvidence(base, "WEST");
  const divisionWinners = resolveDivisionWinnerIds(
    { ...preliminaryEast, ...preliminaryWest },
    `season:${season.seed}:${fingerprint}`,
  );
  const eastEvidence = markDivisionWinners(preliminaryEast, divisionWinners);
  const westEvidence = markDivisionWinners(preliminaryWest, divisionWinners);
  const east = {
    conference: "EAST" as const,
    rankingRulesVersion: RANKING_RULES_VERSION,
    teams: rankConference("EAST", eastEvidence, `season:${season.seed}:${fingerprint}`),
  };
  const west = {
    conference: "WEST" as const,
    rankingRulesVersion: RANKING_RULES_VERSION,
    teams: rankConference("WEST", westEvidence, `season:${season.seed}:${fingerprint}`),
  };
  const playoffSeedPool = buildPlayoffSeedPool(base, east, west);
  const eastDirect = east.teams.filter((entry) => entry.outcome === "DIRECT").map((entry) => entry.teamId);
  const westDirect = west.teams.filter((entry) => entry.outcome === "DIRECT").map((entry) => entry.teamId);
  const freezeEventId = `postseason-freeze-${season.startYear}-${fingerprint}`;
  const bracket = (conference: Conference, snapshot: ConferenceRankingSnapshot): ConferencePlayInBracket => ({
    conference,
    revision: 0,
    gameA: buildPlayInGame(conference, "A", 7, 8, snapshot),
    gameB: buildPlayInGame(conference, "B", 9, 10, snapshot),
    gameC: null,
    finalSeed7TeamId: null,
    finalSeed8TeamId: null,
    directQualifierTeamIds: conference === "EAST" ? eastDirect : westDirect,
    eliminatedTeamIds: [],
  });
  return {
    schemaVersion: POSTSEASON_SCHEMA_VERSION,
    rankingRulesVersion: RANKING_RULES_VERSION,
    freezeEventId,
    frozen: true,
    revision: 0,
    eventIds: [freezeEventId],
    east,
    west,
    playIn: {
      EAST: bracket("EAST", east),
      WEST: bracket("WEST", west),
    },
    playoffSeedPool,
    playoffs: createWaitingPlayoffBracket(freezeEventId, season.seed),
  };
}

/** Idempotent freeze: a completed season freezes exactly once. */
export function freezeRegularSeason(season: CareerSeasonState, existing?: PostseasonState): PostseasonFreezeResult {
  if (existing?.frozen) {
    try {
      assertFrozenConsistency(season, existing);
      return { status: "ALREADY_FROZEN", state: existing };
    } catch (error) {
      return {
        status: "REJECTED",
        code: "MISMATCH",
        reason: error instanceof Error ? error.message : "冻结快照与常规赛不一致",
      };
    }
  }
  const readiness = regularSeasonComplete(season);
  if (!readiness.complete) {
    return { status: "NOT_READY", unfinishedCount: readiness.unfinishedCount, totalGames: season.games.length, reason: readiness.reason };
  }
  return { status: "FROZEN", state: createPostseasonState(season) };
}

/* ------------------------------------------------------------------ *
 * Play-in state machine
 * ------------------------------------------------------------------ */

function snapshotFor(state: PostseasonState, conference: Conference) {
  return conference === "EAST" ? state.east : state.west;
}

function bracketFor(state: PostseasonState, conference: Conference) {
  return conference === "EAST" ? state.playIn.EAST : state.playIn.WEST;
}

function bracketUpdate(state: PostseasonState, conference: Conference, nextBracket: ConferencePlayInBracket): PostseasonState {
  const next = { ...state, revision: state.revision + 1 };
  if (conference === "EAST") next.playIn = { ...next.playIn, EAST: nextBracket };
  else next.playIn = { ...next.playIn, WEST: nextBracket };
  return next;
}

function seedLabel(snapshot: ConferenceRankingSnapshot, teamId: string) {
  return snapshot.teams.find((entry) => entry.teamId === teamId)?.playInSeed ?? null;
}

function assertQualificationInvariants(bracket: ConferencePlayInBracket, snapshot: ConferenceRankingSnapshot) {
  const expectedDirect = snapshot.teams.slice(0, 6).map((entry) => entry.teamId);
  if (JSON.stringify(bracket.directQualifierTeamIds) !== JSON.stringify(expectedDirect)) {
    throw new Error("Direct qualifiers must be frozen seeds 1–6 in order");
  }
  const participants = new Set<string>([...new Set([
    bracket.gameA.homeTeamId, bracket.gameA.awayTeamId,
    bracket.gameB.homeTeamId, bracket.gameB.awayTeamId,
  ])]);
  // Seeds 7-10 are the only legal first-round participants, each exactly once.
  for (const teamId of participants) {
    const seed = seedLabel(snapshot, teamId);
    if (seed === null || seed < 7 || seed > 10) throw new Error("Play-in game references a team outside seeds 7–10");
  }
  if (participants.size !== 4) throw new Error("Play-in first round must involve four distinct teams");
  if (bracket.directQualifierTeamIds.some((teamId) => participants.has(teamId))) {
    throw new Error("Direct qualifiers cannot appear in the play-in");
  }
  if (bracket.gameA.homeTeamId === bracket.gameA.awayTeamId
    || bracket.gameB.homeTeamId === bracket.gameB.awayTeamId) {
    throw new Error("Play-in game has identical home and away teams");
  }
  if (bracket.gameC) {
    if (bracket.gameC.homeTeamId !== bracket.gameA.loserTeamId
      || bracket.gameC.awayTeamId !== bracket.gameB.winnerTeamId) {
      throw new Error("Game C matchup does not derive from A loser and B winner");
    }
    if (bracket.gameC.homeTeamId === bracket.gameC.awayTeamId) {
      throw new Error("Game C has identical home and away teams");
    }
  }
  for (const game of [bracket.gameA, bracket.gameB, bracket.gameC].filter((item): item is PlayInGame => Boolean(item))) {
    if (game.status !== "FINAL") continue;
    if (game.winnerTeamId === null || game.loserTeamId === null || game.score === null) {
      throw new Error("Final play-in game is missing a winner, loser or score");
    }
  }
  if (bracket.gameA.status === "FINAL") {
    if (bracket.finalSeed7TeamId !== bracket.gameA.winnerTeamId) throw new Error("Final seed 7 must be the Game A winner");
  } else if (bracket.finalSeed7TeamId !== null) {
    throw new Error("Final seed 7 cannot exist before Game A is final");
  }
  const expectedEliminated: string[] = [];
  if (bracket.gameB.status === "FINAL") expectedEliminated.push(bracket.gameB.loserTeamId!);
  if (bracket.gameC?.status === "FINAL") expectedEliminated.push(bracket.gameC.loserTeamId!);
  if (JSON.stringify(bracket.eliminatedTeamIds) !== JSON.stringify(expectedEliminated)) {
    throw new Error("Play-in elimination ledger does not match Games B and C");
  }
  if (bracket.gameC?.status === "FINAL") {
    if (bracket.finalSeed8TeamId !== bracket.gameC.winnerTeamId) throw new Error("Final seed 8 must be the Game C winner");
  } else if (bracket.finalSeed8TeamId !== null) {
    throw new Error("Final seed 8 cannot exist before Game C is final");
  }
  if (bracket.finalSeed7TeamId && !snapshot.teams.some((entry) => entry.teamId === bracket.finalSeed7TeamId)) {
    throw new Error("Final seed 7 must come from the same conference");
  }
  if (bracket.finalSeed8TeamId && !snapshot.teams.some((entry) => entry.teamId === bracket.finalSeed8TeamId)) {
    throw new Error("Final seed 8 must come from the same conference");
  }
  if (bracket.finalSeed7TeamId && bracket.finalSeed8TeamId && bracket.finalSeed7TeamId === bracket.finalSeed8TeamId) {
    throw new Error("Final seeds 7 and 8 must be different teams");
  }
}

function ensureGameValid(
  state: PostseasonState,
  conference: Conference,
  slot: PlayInSlot,
  score: PlayInScore,
): { bracket: ConferencePlayInBracket; game: PlayInGame } | { error: PlayInRecordResult } {
  if (!state.frozen) return { error: { status: "REJECTED", code: "NOT_FROZEN", reason: "排名尚未冻结" } };
  const bracket = bracketFor(state, conference);
  const game = slot === "A" ? bracket.gameA : slot === "B" ? bracket.gameB : bracket.gameC;
  if (!game) return { error: { status: "REJECTED", code: "OUT_OF_ORDER", reason: "附加赛C场尚未生成" } };
  if (game.status === "FINAL") {
    const alreadyApplied = game.score !== null
      && game.score.homeScore === score.homeScore
      && game.score.awayScore === score.awayScore;
    if (alreadyApplied) return { error: { status: "NOOP", state, reason: "该场次结果已记录" } };
    return { error: { status: "REJECTED", code: "CONFLICT", reason: "该场次已结束，不能以不同比分重放" } };
  }
  if (!Number.isSafeInteger(score.homeScore) || !Number.isSafeInteger(score.awayScore)
    || score.homeScore < 0 || score.awayScore < 0 || score.homeScore > 300 || score.awayScore > 300) {
    return { error: { status: "REJECTED", code: "NOT_SCHEDULED", reason: "比分无效" } };
  }
  if (score.homeScore === score.awayScore) return { error: { status: "REJECTED", code: "TIED", reason: "附加赛不能以平局结束" } };
  return { bracket, game };
}

/** Returns the next legal play-in game for a conference (the earliest SCHEDULED one). */
export function nextPlayInGame(state: PostseasonState, conference: Conference): PlayInGame | null {
  if (!state.frozen) return null;
  const bracket = bracketFor(state, conference);
  if (bracket.gameA.status === "SCHEDULED") return bracket.gameA;
  if (bracket.gameB.status === "SCHEDULED") return bracket.gameB;
  if (bracket.gameC && bracket.gameC.status === "SCHEDULED") return bracket.gameC;
  return null;
}

function gameAfterScore(game: PlayInGame, score: PlayInScore, eventId: string): PlayInGame {
  const homeWon = score.homeScore > score.awayScore;
  return {
    ...game,
    status: "FINAL",
    score: { ...score },
    winnerTeamId: homeWon ? game.homeTeamId : game.awayTeamId,
    loserTeamId: homeWon ? game.awayTeamId : game.homeTeamId,
    eventId,
  };
}

function maybeCreateGameC(bracket: ConferencePlayInBracket, snapshot: ConferenceRankingSnapshot): ConferencePlayInBracket {
  if (bracket.gameC) return bracket;
  if (bracket.gameA.status !== "FINAL" || bracket.gameB.status !== "FINAL") return bracket;
  const homeTeamId = bracket.gameA.loserTeamId!; // A loser hosts
  const awayTeamId = bracket.gameB.winnerTeamId!; // B winner visits
  const homeSeed = seedLabel(snapshot, homeTeamId)!;
  const awaySeed = seedLabel(snapshot, awayTeamId)!;
  const gameC: PlayInGame = {
    slot: "C",
    conference: bracket.conference,
    gameId: `playin-${bracket.conference}-C`,
    status: "SCHEDULED",
    homeTeamId,
    awayTeamId,
    homeSeed,
    awaySeed,
    score: null,
    winnerTeamId: null,
    loserTeamId: null,
    eventId: null,
  };
  return { ...bracket, gameC };
}

function playInEventId(
  state: PostseasonState,
  conference: Conference,
  slot: PlayInSlot,
  score: PlayInScore,
) {
  return `${state.freezeEventId}:playin:${conference}:${slot}:${score.homeScore}-${score.awayScore}`;
}

export function recordPlayInResult(
  state: PostseasonState,
  conference: Conference,
  slot: PlayInSlot,
  score: PlayInScore,
  options: PlayInRecordOptions = {},
): PlayInRecordResult {
  const validated = ensureGameValid(state, conference, slot, score);
  if ("error" in validated) return validated.error;
  const { bracket, game } = validated;
  if (options.expectedRevision !== undefined && options.expectedRevision !== state.revision) {
    return { status: "REJECTED", code: "STALE", reason: "附加赛状态已更新，请刷新后重试" };
  }
  if (slot === "C") {
    // C participants are fixed: A loser (home) vs B winner (away).
    if (bracket.gameA.status !== "FINAL" || bracket.gameB.status !== "FINAL") {
      return { status: "REJECTED", code: "OUT_OF_ORDER", reason: "A、B两场都结束后才能进行C场" };
    }
    if (game.homeTeamId !== bracket.gameA.loserTeamId || game.awayTeamId !== bracket.gameB.winnerTeamId) {
      return { status: "REJECTED", code: "INVALID_MATCHUP", reason: "C场对阵与A/B结果不一致" };
    }
  }
  const snapshot = snapshotFor(state, conference);
  const eventId = playInEventId(state, conference, slot, score);
  let nextBracket = { ...bracket };
  if (slot === "A") {
    nextBracket = {
      ...nextBracket,
      gameA: gameAfterScore(bracket.gameA, score, eventId),
      finalSeed7TeamId: (score.homeScore > score.awayScore ? bracket.gameA.homeTeamId : bracket.gameA.awayTeamId),
    };
  } else if (slot === "B") {
    const finalGame = gameAfterScore(bracket.gameB, score, eventId);
    nextBracket = {
      ...nextBracket,
      gameB: finalGame,
      eliminatedTeamIds: [...nextBracket.eliminatedTeamIds, finalGame.loserTeamId!],
    };
  } else {
    const finalGame = gameAfterScore(bracket.gameC!, score, eventId);
    nextBracket = {
      ...nextBracket,
      gameC: finalGame,
      eliminatedTeamIds: [...nextBracket.eliminatedTeamIds, finalGame.loserTeamId!],
    };
  }
  nextBracket = maybeCreateGameC(nextBracket, snapshot);
  if (slot === "C") {
    nextBracket = {
      ...nextBracket,
      finalSeed8TeamId: score.homeScore > score.awayScore ? nextBracket.gameC!.homeTeamId : nextBracket.gameC!.awayTeamId,
    };
  }
  nextBracket = { ...nextBracket, revision: bracket.revision + 1 };
  assertQualificationInvariants(nextBracket, snapshot);
  let next = bracketUpdate(state, conference, nextBracket);
  next.eventIds = [...next.eventIds, eventId];
  next = maybeInitializePlayoffs(next);
  return { status: "APPLIED", state: next, eventId };
}

/** Deterministically simulates the next SCHEDULED play-in game; the UI owns player-choice eligibility. */
export function simulateNextPlayInGame(state: PostseasonState, conference: Conference, seed: number): PlayInRecordResult {
  const game = nextPlayInGame(state, conference);
  if (!game) return { status: "NOOP", state, reason: "该区附加赛已全部结束" };
  const simulated = simulatePostseasonScore(game.awayTeamId, game.homeTeamId, seed);
  return recordPlayInResult(state, conference, game.slot, simulated.result);
}

/** True when a conference's play-in is complete (seeds 7 and 8 both locked). */
export function playInComplete(state: PostseasonState, conference: Conference) {
  const bracket = bracketFor(state, conference);
  return bracket.finalSeed7TeamId !== null && bracket.finalSeed8TeamId !== null;
}

export function conferenceQualifiers(state: PostseasonState, conference: Conference) {
  const bracket = bracketFor(state, conference);
  const finalSeeds = [...bracket.directQualifierTeamIds];
  if (bracket.finalSeed7TeamId) finalSeeds.push(bracket.finalSeed7TeamId);
  if (bracket.finalSeed8TeamId) finalSeeds.push(bracket.finalSeed8TeamId);
  return finalSeeds;
}

function finalPlayoffSeedField(state: PostseasonState): PlayoffSeedField | null {
  if (!playInComplete(state, "EAST") || !playInComplete(state, "WEST")) return null;
  const buildConference = (conference: Conference): PlayoffSeedTeam[] => {
    const evidence = new Map(state.playoffSeedPool[conference].map((team) => [team.teamId, team]));
    return conferenceQualifiers(state, conference).map((teamId, index) => {
      const source = evidence.get(teamId);
      if (!source) throw new Error(`Final playoff seed ${teamId} is missing frozen evidence`);
      return {
        ...source,
        seed: index + 1,
        headToHead: Object.fromEntries(Object.entries(source.headToHead).map(([opponentId, record]) => [opponentId, { ...record }])),
      };
    });
  };
  return { EAST: buildConference("EAST"), WEST: buildConference("WEST") };
}

function maybeInitializePlayoffs(state: PostseasonState): PostseasonState {
  if (state.playoffs.status !== "WAITING_FOR_PLAY_IN") return state;
  const seeds = finalPlayoffSeedField(state);
  if (!seeds) return state;
  const initialized = initializePlayoffFirstRound(state.playoffs, seeds);
  if (initialized.status === "REJECTED") throw new Error(`Cannot initialize playoff bracket: ${initialized.reason}`);
  if (initialized.status === "NOOP") return state;
  return { ...state, playoffs: initialized.state };
}

export function playoffSeries(state: PostseasonState) {
  return state.playoffs.series;
}

export function legalPlayoffGames(state: PostseasonState) {
  return scheduledPlayoffGames(state.playoffs);
}

export function nextSeriesGame(state: PostseasonState, seriesId: string): PlayoffGame | null {
  return nextPlayoffGame(state.playoffs, seriesId);
}

function applyPlayoffBracketResult(
  state: PostseasonState,
  result: ReturnType<typeof recordPlayoffGameResult>,
): PostseasonPlayoffRecordResult {
  if (result.status === "REJECTED") return result;
  if (result.status === "NOOP") return { status: "NOOP", state, reason: result.reason };
  const newlyCreatedEvents = result.state.eventIds.filter((eventId) => !state.playoffs.eventIds.includes(eventId));
  return {
    status: "APPLIED",
    state: {
      ...state,
      revision: state.revision + 1,
      eventIds: [...new Set([...state.eventIds, ...newlyCreatedEvents])].sort(),
      playoffs: result.state,
    },
    eventId: result.eventId,
  };
}

export function recordPostseasonPlayoffResult(
  state: PostseasonState,
  seriesId: string,
  gameNumber: number,
  score: PlayInScore,
  options: PlayoffRecordOptions = {},
): PostseasonPlayoffRecordResult {
  if (!isPostseasonState(state)) {
    return { status: "REJECTED", code: "INVALID_STATE", reason: "季后赛状态无效" };
  }
  if (options.expectedRevision !== undefined && options.expectedRevision !== state.revision) {
    return { status: "REJECTED", code: "STALE", reason: "季后赛状态已更新，请使用最新版本" };
  }
  const bracketOptions = options.expectedRevision === undefined
    ? {}
    : { expectedRevision: state.playoffs.revision };
  return applyPlayoffBracketResult(
    state,
    recordPlayoffGameResult(state.playoffs, seriesId, gameNumber, score, bracketOptions),
  );
}

export function simulatePostseasonPlayoffGame(
  state: PostseasonState,
  seriesId: string,
  options: PlayoffRecordOptions = {},
): PostseasonPlayoffRecordResult {
  if (!isPostseasonState(state)) {
    return { status: "REJECTED", code: "INVALID_STATE", reason: "季后赛状态无效" };
  }
  if (options.expectedRevision !== undefined && options.expectedRevision !== state.revision) {
    return { status: "REJECTED", code: "STALE", reason: "季后赛状态已更新，请使用最新版本" };
  }
  const bracketOptions = options.expectedRevision === undefined
    ? {}
    : { expectedRevision: state.playoffs.revision };
  return applyPlayoffBracketResult(state, simulateNextPlayoffGame(state.playoffs, seriesId, bracketOptions));
}

function validPlayInGameShape(
  state: PostseasonState,
  game: PlayInGame,
  conference: Conference,
  slot: PlayInSlot,
  seen: Set<string>,
) {
  if (game.slot !== slot || game.conference !== conference || game.gameId !== `playin-${conference}-${slot}`) return false;
  if (!seen.has(game.homeTeamId) || !seen.has(game.awayTeamId) || game.homeTeamId === game.awayTeamId) return false;
  if (!Number.isSafeInteger(game.homeSeed) || !Number.isSafeInteger(game.awaySeed)) return false;
  if (game.status === "SCHEDULED") {
    return game.score === null && game.winnerTeamId === null && game.loserTeamId === null && game.eventId === null;
  }
  if (game.status !== "FINAL" || !game.score
    || !Number.isSafeInteger(game.score.homeScore)
    || !Number.isSafeInteger(game.score.awayScore)
    || game.score.homeScore < 0
    || game.score.awayScore < 0
    || game.score.homeScore > 300
    || game.score.awayScore > 300
    || game.score.homeScore === game.score.awayScore) return false;
  const homeWon = game.score.homeScore > game.score.awayScore;
  if (game.winnerTeamId !== (homeWon ? game.homeTeamId : game.awayTeamId)) return false;
  if (game.loserTeamId !== (homeWon ? game.awayTeamId : game.homeTeamId)) return false;
  return game.eventId === playInEventId(state, conference, slot, game.score)
    && state.eventIds.includes(game.eventId);
}

function validPlayoffSeedPoolConference(
  pool: unknown,
  conference: Conference,
  snapshot: ConferenceRankingSnapshot,
) {
  if (!Array.isArray(pool) || pool.length !== 15) return false;
  for (let index = 0; index < pool.length; index += 1) {
    const team = pool[index] as PlayoffSeedTeam | undefined;
    const ranked = snapshot.teams[index];
    if (!team
      || team.teamId !== ranked.teamId
      || team.conference !== conference
      || team.seed !== ranked.rank
      || team.wins !== ranked.wins
      || team.losses !== ranked.losses
      || !Number.isSafeInteger(team.oppositeConferenceWins)
      || !Number.isSafeInteger(team.oppositeConferenceLosses)
      || team.oppositeConferenceWins < 0
      || team.oppositeConferenceLosses < 0
      || team.oppositeConferenceWins + team.oppositeConferenceLosses > 82
      || !team.headToHead
      || typeof team.headToHead !== "object"
      || Array.isArray(team.headToHead)) return false;
    for (const [opponentId, record] of Object.entries(team.headToHead)) {
      if (!teamById.has(opponentId)
        || opponentId === team.teamId
        || !record
        || !Number.isSafeInteger(record.wins)
        || !Number.isSafeInteger(record.losses)
        || record.wins < 0
        || record.losses < 0
        || record.wins + record.losses > 82) return false;
    }
  }
  return true;
}

/** Serialization helpers: plain JSON round-trip with strict structural validation. */
export function isPostseasonState(value: unknown): value is PostseasonState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as PostseasonState;
  if (candidate.schemaVersion !== POSTSEASON_SCHEMA_VERSION) return false;
  if (candidate.rankingRulesVersion !== RANKING_RULES_VERSION) return false;
  if (candidate.frozen !== true) return false;
  if (typeof candidate.freezeEventId !== "string"
    || !/^postseason-freeze-\d{4}-[0-9a-f]{8}$/.test(candidate.freezeEventId)) return false;
  if (!Number.isSafeInteger(candidate.revision) || candidate.revision < 0) return false;
  if (!Array.isArray(candidate.eventIds)
    || candidate.eventIds.some((eventId) => typeof eventId !== "string")
    || candidate.eventIds[0] !== candidate.freezeEventId
    || new Set(candidate.eventIds).size !== candidate.eventIds.length) return false;
  const allTeams = new Set<string>();
  let finalGameCount = 0;
  for (const conference of ["EAST", "WEST"] as const) {
    const snapshot = candidate[conference === "EAST" ? "east" : "west"];
    if (!snapshot
      || snapshot.conference !== conference
      || snapshot.rankingRulesVersion !== RANKING_RULES_VERSION
      || !Array.isArray(snapshot.teams)
      || snapshot.teams.length !== 15) return false;
    const seen = new Set<string>();
    for (let index = 0; index < snapshot.teams.length; index += 1) {
      const entry = snapshot.teams[index];
      const expectedRank = index + 1;
      const expectedOutcome: PlayInOutcome = expectedRank <= 6 ? "DIRECT" : expectedRank <= 10 ? "PLAY_IN" : "OUT";
      if (!entry || entry.rank !== expectedRank || entry.outcome !== expectedOutcome) return false;
      if (entry.playInSeed !== (expectedRank <= 10 ? expectedRank : null)) return false;
      if (!Number.isSafeInteger(entry.wins) || !Number.isSafeInteger(entry.losses)
        || entry.wins < 0 || entry.losses < 0 || entry.wins + entry.losses !== 82) return false;
      if (seen.has(entry.teamId) || allTeams.has(entry.teamId)) return false;
      seen.add(entry.teamId);
      allTeams.add(entry.teamId);
      const canonical = teamById.get(entry.teamId);
      if (!canonical || canonical.conference !== conference) return false;
      if (entry.division !== DIVISION_BY_TEAM_ID[entry.teamId] || typeof entry.divisionWinner !== "boolean") return false;
    }
    const bracket = candidate.playIn?.[conference];
    if (!bracket || bracket.conference !== conference || !Number.isSafeInteger(bracket.revision) || bracket.revision < 0) return false;
    if (!Array.isArray(bracket.directQualifierTeamIds) || !Array.isArray(bracket.eliminatedTeamIds)) return false;
    const seedTeam = (seed: number) => snapshot.teams[seed - 1]?.teamId;
    if (bracket.gameA.homeTeamId !== seedTeam(7) || bracket.gameA.awayTeamId !== seedTeam(8)
      || bracket.gameA.homeSeed !== 7 || bracket.gameA.awaySeed !== 8) return false;
    if (bracket.gameB.homeTeamId !== seedTeam(9) || bracket.gameB.awayTeamId !== seedTeam(10)
      || bracket.gameB.homeSeed !== 9 || bracket.gameB.awaySeed !== 10) return false;
    if (!validPlayInGameShape(candidate, bracket.gameA, conference, "A", seen)
      || !validPlayInGameShape(candidate, bracket.gameB, conference, "B", seen)) return false;
    if (bracket.gameC) {
      if (bracket.gameA.status !== "FINAL" || bracket.gameB.status !== "FINAL") return false;
      if (bracket.gameC.homeTeamId !== bracket.gameA.loserTeamId
        || bracket.gameC.awayTeamId !== bracket.gameB.winnerTeamId
        || !validPlayInGameShape(candidate, bracket.gameC, conference, "C", seen)) return false;
    }
    const bracketGames = [bracket.gameA, bracket.gameB, bracket.gameC].filter((game): game is PlayInGame => Boolean(game));
    const bracketFinalCount = bracketGames.filter((game) => game.status === "FINAL").length;
    if (bracket.revision !== bracketFinalCount) return false;
    finalGameCount += bracketFinalCount;
    try {
      assertQualificationInvariants(bracket, snapshot);
    } catch {
      return false;
    }
    if (!candidate.playoffSeedPool
      || !validPlayoffSeedPoolConference(candidate.playoffSeedPool[conference], conference, snapshot)) return false;
  }
  if (allTeams.size !== 30 || !isPlayoffBracketState(candidate.playoffs)) return false;
  if (candidate.playoffs.freezeEventId !== candidate.freezeEventId) return false;
  const bothPlayInsComplete = playInComplete(candidate, "EAST") && playInComplete(candidate, "WEST");
  if (!bothPlayInsComplete && candidate.playoffs.status !== "WAITING_FOR_PLAY_IN") return false;
  if (bothPlayInsComplete) {
    if (candidate.playoffs.status === "WAITING_FOR_PLAY_IN") return false;
    const expectedSeeds = finalPlayoffSeedField(candidate);
    if (!expectedSeeds || JSON.stringify(candidate.playoffs.seeds) !== JSON.stringify(expectedSeeds)) return false;
  }
  if (candidate.revision !== finalGameCount + candidate.playoffs.revision) return false;
  const expectedEvents = [candidate.freezeEventId];
  for (const conference of ["EAST", "WEST"] as const) {
    expectedEvents.push(...bracketFinalEventIds(candidate.playIn[conference]));
  }
  expectedEvents.push(...candidate.playoffs.eventIds);
  const actualSorted = [...candidate.eventIds].sort();
  const expectedSorted = expectedEvents.sort();
  return actualSorted.length === expectedSorted.length
    && actualSorted.every((eventId, index) => eventId === expectedSorted[index]);
}

/**
 * Tamper-proof consistency check between the persisted postseason slice and
 * the FINAL regular-season schedule it was frozen from. Recomputes the full
 * ranking evidence, replays every recorded play-in result from a fresh
 * freeze, and requires the stored bracket to equal the replayed outcome —
 * so a corrupted save can never silently carry wrong seeds or results.
 */
export function assertFrozenConsistency(season: CareerSeasonState, postseason: PostseasonState): void {
  if (!isPostseasonState(postseason)) throw new Error("Postseason state is structurally invalid");
  if (postseason.freezeEventId !== postseasonFreezeEventId(season)) {
    throw new Error("Postseason freeze event does not match the final schedule");
  }
  const recomputed = createPostseasonState(season);
  for (const conference of ["EAST", "WEST"] as const) {
    const stored = conference === "EAST" ? postseason.east : postseason.west;
    const expected = conference === "EAST" ? recomputed.east : recomputed.west;
    for (let index = 0; index < 15; index += 1) {
      const storedEntry = stored.teams[index];
      const expectedEntry = expected.teams[index];
      if (storedEntry.teamId !== expectedEntry.teamId
        || storedEntry.wins !== expectedEntry.wins
        || storedEntry.losses !== expectedEntry.losses
        || storedEntry.division !== expectedEntry.division
        || storedEntry.divisionWinner !== expectedEntry.divisionWinner
        || storedEntry.playInSeed !== expectedEntry.playInSeed
        || storedEntry.outcome !== expectedEntry.outcome
        || storedEntry.rank !== expectedEntry.rank) {
        throw new Error(`Postseason ${conference} snapshot order drifts from the final schedule`);
      }
    }
    if (JSON.stringify(postseason.playoffSeedPool[conference]) !== JSON.stringify(recomputed.playoffSeedPool[conference])) {
      throw new Error(`Postseason ${conference} home-court evidence drifts from the final schedule`);
    }
  }

  // Replay both play-in brackets into one state. This is necessary because the
  // fixed first round is initialized only when both conferences have final
  // seeds 7 and 8.
  let replayed = recomputed;
  for (const conference of ["EAST", "WEST"] as const) {
    for (const slot of ["A", "B", "C"] as const) {
      const storedGame = postseason.playIn[conference][slot === "A" ? "gameA" : slot === "B" ? "gameB" : "gameC"];
      if (!storedGame || storedGame.status !== "FINAL") continue;
      if (storedGame.score === null) throw new Error(`Postseason ${conference} ${slot} final game is missing its score`);
      const result = recordPlayInResult(replayed, conference, slot, storedGame.score);
      if (result.status !== "APPLIED") {
        throw new Error(`Postseason ${conference} ${slot} result cannot be replayed from the schedule`);
      }
      replayed = result.state;
    }
    const storedBracket = postseason.playIn[conference];
    const replayedBracket = conference === "EAST" ? replayed.playIn.EAST : replayed.playIn.WEST;
    if (JSON.stringify(storedBracket) !== JSON.stringify(replayedBracket)) {
      throw new Error(`Postseason ${conference} bracket drifts from a replay of its recorded results`);
    }
  }

  // Replay every stored FINAL series game from the legal frontier. The replay
  // discovers later series from their feeder winners and therefore detects
  // fabricated participants, skipped games, wrong hosts and premature titles.
  const remainingPlayoffScores = new Map<string, PlayInScore>();
  for (const series of postseason.playoffs.series) {
    for (const game of series.games) {
      if (game.status === "FINAL" && game.score) remainingPlayoffScores.set(game.gameId, game.score);
    }
  }
  while (remainingPlayoffScores.size > 0) {
    let progressed = false;
    for (const series of replayed.playoffs.series) {
      const frontier = nextPlayoffGame(replayed.playoffs, series.seriesId);
      if (!frontier) continue;
      const score = remainingPlayoffScores.get(frontier.gameId);
      if (!score) continue;
      const result = recordPostseasonPlayoffResult(replayed, series.seriesId, frontier.gameNumber, score);
      if (result.status !== "APPLIED") {
        throw new Error(`Postseason playoff game ${frontier.gameId} cannot be replayed from its legal frontier`);
      }
      replayed = result.state;
      remainingPlayoffScores.delete(frontier.gameId);
      progressed = true;
      break;
    }
    if (!progressed) throw new Error("Postseason playoff result chain contains an unreachable game");
  }

  const normalize = (state: PostseasonState) => ({ ...state, eventIds: [...state.eventIds].sort() });
  if (JSON.stringify(normalize(postseason)) !== JSON.stringify(normalize(replayed))) {
    throw new Error("Postseason state drifts from a complete event replay");
  }
}

function bracketFinalEventIds(bracket: ConferencePlayInBracket) {
  const ids: string[] = [];
  for (const game of [bracket.gameA, bracket.gameB, bracket.gameC]) {
    if (game?.status === "FINAL" && game.eventId) ids.push(game.eventId);
  }
  return ids.sort();
}

function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([key, child]) => [key, normalize(child)]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function legacyProjection(state: PostseasonState) {
  return {
    schemaVersion: LEGACY_POSTSEASON_SCHEMA_VERSION,
    rankingRulesVersion: state.rankingRulesVersion,
    freezeEventId: state.freezeEventId,
    frozen: state.frozen,
    revision: state.revision,
    eventIds: [...state.eventIds],
    east: state.east,
    west: state.west,
    playIn: state.playIn,
  };
}

/**
 * Upgrades a persisted M6B-1 slice by rebuilding it from the immutable final
 * season and replaying only the stored A/B/C scores. No ranking or score is
 * redrawn, and migration itself does not create a gameplay revision.
 */
export function migratePostseasonStateV1(season: CareerSeasonState, value: unknown): PostseasonState {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (value as Record<string, unknown>).schemaVersion !== LEGACY_POSTSEASON_SCHEMA_VERSION) {
    throw new Error("Legacy postseason slice is not schema v1");
  }
  const legacy = value as ReturnType<typeof legacyProjection>;
  let replayed = createPostseasonState(season);
  try {
    for (const conference of ["EAST", "WEST"] as const) {
      for (const slot of ["A", "B", "C"] as const) {
        const bracket = legacy.playIn[conference];
        const game = slot === "A" ? bracket.gameA : slot === "B" ? bracket.gameB : bracket.gameC;
        if (!game || game.status !== "FINAL") continue;
        if (!game.score) throw new Error(`Legacy ${conference} ${slot} game is missing its score`);
        const applied = recordPlayInResult(replayed, conference, slot, game.score);
        if (applied.status !== "APPLIED") throw new Error(`Legacy ${conference} ${slot} result cannot be replayed`);
        replayed = applied.state;
      }
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Legacy postseason replay failed");
  }
  const normalizeLegacy = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    const object = candidate as Record<string, unknown>;
    return {
      ...object,
      ...(Array.isArray(object.eventIds) ? { eventIds: [...object.eventIds].sort() } : {}),
    };
  };
  if (canonicalJson(normalizeLegacy(legacy)) !== canonicalJson(normalizeLegacy(legacyProjection(replayed)))) {
    throw new Error("Legacy postseason slice drifts from the final season or its recorded play-in results");
  }
  const migrated = {
    ...replayed,
    eventIds: [...legacy.eventIds],
  };
  if (!isPostseasonState(migrated)) throw new Error("Migrated postseason slice is invalid");
  return migrated;
}

export const careerPostseasonPublicApi = {
  createPostseasonState,
  freezeRegularSeason,
  recordPlayInResult,
  simulateNextPlayInGame,
  nextPlayInGame,
  playInComplete,
  conferenceQualifiers,
  isPostseasonState,
  orderTiedTeams,
  assertFrozenConsistency,
  migratePostseasonStateV1,
  playoffSeries,
  legalPlayoffGames,
  nextSeriesGame,
  recordPostseasonPlayoffResult,
  simulatePostseasonPlayoffGame,
};
