import { clamp, nextRandom } from "./core";
import { calculatePlayedMatchReward } from "./career-progression";
import { leagueTeams } from "./player-creation";
import { regularSeasonSchedule2026 } from "./schedule-2026";
import type { DifficultyId, Ratings } from "./types";

export const CAREER_SEASON_START = "2026-10-19";
export const CAREER_SEASON_END = "2027-04-11";
export const CUP_RESOLUTION_DATE = "2026-12-04";
export const CAREER_MAX_SEASONS = 20 as const;
export const CAREER_SCHEDULE_RULES_VERSION = 1 as const;

const FIRST_CUP_GAME_DATES = ["2026-12-05", "2026-12-09"] as const;

export type CareerScheduleBasis = "PUBLISHED_2026_27" | "PROJECTED";

export interface CareerSeasonDescriptor {
  seasonNumber: number;
  seasonId: string;
  scheduleRulesVersion: typeof CAREER_SCHEDULE_RULES_VERSION;
  startYear: number;
  startDate: string;
  endDate: string;
  cupResolutionDate: string;
  scheduleBasis: CareerScheduleBasis;
}

export type CareerSeasonBounds = Pick<
  CareerSeasonDescriptor,
  "seasonNumber" | "seasonId" | "scheduleRulesVersion" | "startYear" | "startDate" | "endDate" | "cupResolutionDate" | "scheduleBasis"
>;

function assertSeasonNumber(seasonNumber: number) {
  if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > CAREER_MAX_SEASONS) {
    throw new Error(`Career season number must be an integer from 1 to ${CAREER_MAX_SEASONS}`);
  }
}

function shiftIsoDateYear(value: string, offset: number) {
  const [year, month, day] = value.split("-").map(Number);
  const shiftedYear = year + offset;
  const shifted = new Date(Date.UTC(shiftedYear, month - 1, day));
  if (shifted.getUTCFullYear() !== shiftedYear || shifted.getUTCMonth() !== month - 1 || shifted.getUTCDate() !== day) {
    throw new Error(`Cannot project career date ${value} by ${offset} years`);
  }
  return shifted.toISOString().slice(0, 10);
}

export function getCareerSeasonDescriptor(seasonNumber = 1): CareerSeasonDescriptor {
  assertSeasonNumber(seasonNumber);
  const offset = seasonNumber - 1;
  const startYear = 2026 + offset;
  return {
    seasonNumber,
    seasonId: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
    scheduleRulesVersion: CAREER_SCHEDULE_RULES_VERSION,
    startYear,
    startDate: shiftIsoDateYear(CAREER_SEASON_START, offset),
    endDate: shiftIsoDateYear(CAREER_SEASON_END, offset),
    cupResolutionDate: shiftIsoDateYear(CUP_RESOLUTION_DATE, offset),
    scheduleBasis: seasonNumber === 1 ? "PUBLISHED_2026_27" : "PROJECTED",
  };
}

export function getCareerSeasonBounds(
  season: number | CareerSeasonBounds = 1,
): CareerSeasonBounds {
  return typeof season === "number" ? getCareerSeasonDescriptor(season) : season;
}

export function getCareerSeasonCupGameDates(season: number | CareerSeasonBounds = 1): readonly [string, string] {
  const bounds = getCareerSeasonBounds(season);
  const offset = bounds.startYear - 2026;
  return [shiftIsoDateYear(FIRST_CUP_GAME_DATES[0], offset), shiftIsoDateYear(FIRST_CUP_GAME_DATES[1], offset)];
}

export type CareerGameSource = "PUBLISHED" | "PROJECTED" | "DYNAMIC_CUP";
export type CareerGameStatus = "SCHEDULED" | "FINAL";

export interface CareerGameResult {
  awayScore: number;
  homeScore: number;
}

export interface CareerGame {
  id: string;
  date: string;
  awayTeamId: string;
  homeTeamId: string;
  easternTime: string;
  neutralSite: boolean;
  source: CareerGameSource;
  status: CareerGameStatus;
  result?: CareerGameResult;
}

export interface TeamStanding {
  teamId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface PlayerSeasonLine {
  games: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  made: number;
  attempts: number;
  threesMade: number;
  threesAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
}

export interface CareerAward {
  id: "MVP" | "DPOY" | "MIP" | "COY" | "ALL_LEAGUE" | "ALL_DEFENSE" | "ROOKIE" | "ALL_ROOKIE";
  label: string;
  winnerName: string;
  teamId?: string;
  reason: string;
}

export interface CareerSeasonState {
  seasonNumber: number;
  seasonId: string;
  scheduleRulesVersion: typeof CAREER_SCHEDULE_RULES_VERSION;
  startYear: number;
  startDate: string;
  endDate: string;
  cupResolutionDate: string;
  scheduleBasis: CareerScheduleBasis;
  playerTeamId: string;
  playerName: string;
  currentDate: string;
  games: CareerGame[];
  standings: Record<string, TeamStanding>;
  playerStats: PlayerSeasonLine;
  coins: number;
  seed: number;
  cupResolved: boolean;
  awards: CareerAward[];
}

export interface TeamCalendarEvent {
  id: string;
  date: string;
  opponentTeamId?: string;
  venue: "HOME" | "AWAY" | "TBD";
  source: CareerGameSource;
  status: CareerGameStatus | "TBD";
  result?: CareerGameResult;
}

export interface CareerSimulationOptions {
  /** Keep these real schedule games unplayed while all other eligible games advance. */
  deferGameIds?: readonly string[];
}

const emptyPlayerLine = (): PlayerSeasonLine => ({
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
});

function emptyStandings() {
  return Object.fromEntries(leagueTeams.map((team) => [team.id, {
    teamId: team.id,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  }])) as Record<string, TeamStanding>;
}

function hashText(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function teamStrength(teamId: string, seasonStartYear = 2026) {
  return 72 + (hashText(`${seasonStartYear}:${teamId}`) % 170) / 10;
}

/** Compatibility facade; the progression policy is the single reward source. */
export function careerGameReward(difficulty: DifficultyId, playedByUser: boolean, gameMinutes: 8 | 12 | 24 = 8) {
  return playedByUser ? calculatePlayedMatchReward(difficulty, gameMinutes) : 0;
}

function scheduledGameId(seasonNumber: number, sourceId: number) {
  return seasonNumber === 1 ? `published-${sourceId}` : `season-${seasonNumber}-projected-${sourceId}`;
}

function dynamicCupGameId(seasonNumber: number, round: 1 | 2, slot: number) {
  const base = `dynamic-cup-${round}-${slot}`;
  return seasonNumber === 1 ? base : `season-${seasonNumber}-${base}`;
}

export function createCareerSeason(
  playerTeamId: string,
  playerName: string,
  seed = 20_260_901,
  seasonNumber = 1,
): CareerSeasonState {
  if (!leagueTeams.some((team) => team.id === playerTeamId)) throw new Error(`Unknown career team: ${playerTeamId}`);
  const displayName = playerName.trim();
  if (!displayName) throw new Error("Career player name is required");
  const descriptor = getCareerSeasonDescriptor(seasonNumber);
  const dateOffset = descriptor.startYear - 2026;
  return {
    ...descriptor,
    playerTeamId,
    playerName: displayName,
    currentDate: descriptor.startDate,
    games: regularSeasonSchedule2026.map(([gameId, date, awayTeamId, homeTeamId, easternTime, neutralSite]) => ({
      id: scheduledGameId(seasonNumber, gameId),
      date: shiftIsoDateYear(date, dateOffset),
      awayTeamId,
      homeTeamId,
      easternTime,
      neutralSite,
      source: descriptor.scheduleBasis === "PUBLISHED_2026_27" ? "PUBLISHED" : "PROJECTED",
      status: "SCHEDULED",
    })),
    standings: emptyStandings(),
    playerStats: emptyPlayerLine(),
    coins: 0,
    seed: seed >>> 0,
    cupResolved: false,
    awards: [],
  };
}

function winPercentage(line: TeamStanding) {
  const games = line.wins + line.losses;
  return games === 0 ? 0.5 : line.wins / games;
}

export function rankedStandings(standings: Record<string, TeamStanding>) {
  return Object.values(standings).sort((first, second) =>
    winPercentage(second) - winPercentage(first)
    || (second.pointsFor - second.pointsAgainst) - (first.pointsFor - first.pointsAgainst)
    || first.teamId.localeCompare(second.teamId),
  );
}

function resolveCupSchedule(state: CareerSeasonState): CareerSeasonState {
  if (state.cupResolved) return state;
  const ranked = rankedStandings(state.standings).map((entry) => entry.teamId);
  const cupGames: CareerGame[] = [];
  const [firstCupDate, secondCupDate] = getCareerSeasonCupGameDates(state);
  for (let index = 0; index < 15; index += 1) {
    cupGames.push({
      id: dynamicCupGameId(state.seasonNumber, 1, index + 1),
      date: firstCupDate,
      awayTeamId: ranked[29 - index],
      homeTeamId: ranked[index],
      easternTime: "TBD",
      neutralSite: false,
      source: "DYNAMIC_CUP",
      status: "SCHEDULED",
    });
  }
  for (let index = 0; index < 15; index += 1) {
    const bottomRankIndex = index === 7 ? 23 : index === 8 ? 22 : 15 + index;
    cupGames.push({
      id: dynamicCupGameId(state.seasonNumber, 2, index + 1),
      date: secondCupDate,
      awayTeamId: ranked[index],
      homeTeamId: ranked[bottomRankIndex],
      easternTime: "TBD",
      neutralSite: false,
      source: "DYNAMIC_CUP",
      status: "SCHEDULED",
    });
  }
  return { ...state, games: [...state.games, ...cupGames], cupResolved: true };
}

function simulateScore(game: CareerGame, seed: number, seasonStartYear = 2026) {
  const first = nextRandom(seed ^ hashText(game.id));
  const second = nextRandom(first.seed);
  const third = nextRandom(second.seed);
  const awayStrength = teamStrength(game.awayTeamId, seasonStartYear);
  const homeStrength = teamStrength(game.homeTeamId, seasonStartYear) + (game.neutralSite ? 0 : 2.2);
  const sharedPace = 105 + (first.value - 0.5) * 16;
  let awayScore = Math.round(sharedPace + (awayStrength - homeStrength) * 0.34 + (second.value - 0.5) * 20);
  let homeScore = Math.round(sharedPace + (homeStrength - awayStrength) * 0.34 + (third.value - 0.5) * 20);
  awayScore = clamp(awayScore, 85, 139);
  homeScore = clamp(homeScore, 85, 139);
  if (awayScore === homeScore) homeScore = clamp(homeScore + 3, 85, 139);
  return { result: { awayScore, homeScore }, seed: third.seed };
}

/**
 * Deterministic score model for games outside the published season table
 * (play-in games, future postseason games). Same strength/pace formula as
 * the regular-season simulator so every league game shares one model.
 */
export function simulatePostseasonScore(awayTeamId: string, homeTeamId: string, seed: number, seasonStartYear = 2026) {
  return simulateScore(
    { id: `postseason-${awayTeamId}-${homeTeamId}`, date: "2027-04-14", awayTeamId, homeTeamId, easternTime: "TBD", neutralSite: false, source: "PUBLISHED", status: "SCHEDULED" } satisfies CareerGame,
    seed,
    seasonStartYear,
  );
}

function addGameToStandings(standings: Record<string, TeamStanding>, game: CareerGame, result: CareerGameResult) {
  const away = standings[game.awayTeamId];
  const home = standings[game.homeTeamId];
  away.pointsFor += result.awayScore;
  away.pointsAgainst += result.homeScore;
  home.pointsFor += result.homeScore;
  home.pointsAgainst += result.awayScore;
  if (result.awayScore > result.homeScore) {
    away.wins += 1;
    home.losses += 1;
  } else {
    home.wins += 1;
    away.losses += 1;
  }
}

function averageRatings(ratings: Ratings, ids: readonly (keyof Ratings)[]) {
  return ids.reduce((sum, id) => sum + ratings[id], 0) / ids.length;
}

export type CreatedPlayerSingleGameLine = Omit<PlayerSeasonLine, "games">;

export interface CreatedPlayerStatSimulation {
  line: CreatedPlayerSingleGameLine;
  seed: number;
}

/**
 * Deterministic single-game line shared by regular-season and future
 * postseason settlement. It never mutates or assumes a cumulative season.
 */
export function simulateCreatedPlayerStatLine(
  ratings: Ratings,
  seed: number,
  teamScore: number,
): CreatedPlayerStatSimulation {
  const shotRoll = nextRandom(seed);
  const boardRoll = nextRandom(shotRoll.seed);
  const passRoll = nextRandom(boardRoll.seed);
  const defenseRoll = nextRandom(passRoll.seed);
  const turnoverRoll = nextRandom(defenseRoll.seed);
  const shooting = averageRatings(ratings, ["closeShot", "layup", "drivingDunk", "midRange", "threePoint", "catchShoot", "shotConsistency"]);
  const playmaking = averageRatings(ratings, ["ballHandle", "ballSecurity", "passAccuracy", "passVision", "basketballIQ"]);
  const rebounding = averageRatings(ratings, ["offensiveRebound", "defensiveRebound", "strength", "vertical"]);
  const defense = averageRatings(ratings, ["perimeterDefense", "interiorDefense", "steal", "block", "helpDefenseIQ"]);
  const attempts = Math.round(clamp(9 + (shooting - 60) * 0.18 + shotRoll.value * 8, 7, 24));
  const percentage = clamp(0.4 + (shooting - 70) * 0.003 + (shotRoll.value - 0.5) * 0.08, 0.35, 0.62);
  const made = Math.round(attempts * percentage);
  const threesAttempted = Math.min(attempts, Math.round(clamp(2 + (ratings.threePoint - 60) * 0.12 + boardRoll.value * 4, 0, 11)));
  const threesMade = Math.min(made, Math.round(threesAttempted * clamp(0.31 + (ratings.threePoint - 65) * 0.003, 0.27, 0.48)));
  const freeThrowsAttempted = Math.round(clamp((ratings.drawFoul - 55) * 0.08 + passRoll.value * 5, 0, 10));
  const freeThrowsMade = Math.round(freeThrowsAttempted * clamp(0.62 + (ratings.freeThrow - 60) * 0.005, 0.55, 0.94));
  const points = Math.min(teamScore, made * 2 + threesMade + freeThrowsMade);
  const rebounds = Math.round(clamp(1 + (rebounding - 55) * 0.12 + boardRoll.value * 5, 1, 16));
  const assists = Math.round(clamp((playmaking - 58) * 0.12 + passRoll.value * 6, 0, 15));
  const steals = Math.round(clamp((ratings.steal - 60) * 0.035 + defenseRoll.value * 2, 0, 5));
  const blocks = Math.round(clamp((ratings.block - 60) * 0.035 + defenseRoll.value * 1.7, 0, 5));
  const turnovers = Math.round(clamp(1 + (76 - ratings.ballSecurity) * 0.06 + turnoverRoll.value * 2.5, 0, 6));
  return {
    line: {
      points,
      rebounds,
      assists,
      steals,
      blocks,
      turnovers,
      made,
      attempts,
      threesMade,
      threesAttempted,
      freeThrowsMade,
      freeThrowsAttempted,
    },
    seed: turnoverRoll.seed,
  };
}

function addCreatedPlayerStatLine(line: PlayerSeasonLine, game: CreatedPlayerSingleGameLine): PlayerSeasonLine {
  return {
    games: line.games + 1,
    points: line.points + game.points,
    rebounds: line.rebounds + game.rebounds,
    assists: line.assists + game.assists,
    steals: line.steals + game.steals,
    blocks: line.blocks + game.blocks,
    turnovers: line.turnovers + game.turnovers,
    made: line.made + game.made,
    attempts: line.attempts + game.attempts,
    threesMade: line.threesMade + game.threesMade,
    threesAttempted: line.threesAttempted + game.threesAttempted,
    freeThrowsMade: line.freeThrowsMade + game.freeThrowsMade,
    freeThrowsAttempted: line.freeThrowsAttempted + game.freeThrowsAttempted,
  };
}

interface AwardCandidate {
  name: string;
  teamId: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  efficiency: number;
}

const firstNames = ["Cassian", "Tavian", "Elio", "Kellan", "Breckin", "Orson", "Jalenzo", "Marek", "Soren", "Kyro"];
const lastNames = ["Rowe", "Mercer", "Vance", "Sloane", "Hale", "Quill", "Reddickson", "Vale", "Morrow", "Caldwell"];

function generatedCandidates(state: CareerSeasonState): AwardCandidate[] {
  const candidates = leagueTeams.map((team, index) => {
    const hash = hashText(state.seasonNumber === 1 ? `${team.id}:awards` : `${state.seasonId}:${team.id}:awards`);
    const points = 18 + (hash % 121) / 10;
    const rebounds = 3 + ((hash >>> 5) % 90) / 10;
    const assists = 2 + ((hash >>> 11) % 80) / 10;
    const steals = 0.7 + ((hash >>> 17) % 19) / 10;
    const blocks = 0.4 + ((hash >>> 22) % 25) / 10;
    const turnovers = 1.5 + ((hash >>> 27) % 24) / 10;
    const teamWin = winPercentage(state.standings[team.id]);
    return {
      name: `${firstNames[index % firstNames.length]} ${lastNames[(index + Math.floor(index / firstNames.length) * 3) % lastNames.length]}`,
      teamId: team.id,
      points,
      rebounds,
      assists,
      steals,
      blocks,
      turnovers,
      efficiency: points + rebounds * 1.1 + assists * 1.35 + (steals + blocks) * 1.8 - turnovers + teamWin * 10,
    };
  });
  const games = Math.max(1, state.playerStats.games);
  const playerTeamWin = winPercentage(state.standings[state.playerTeamId]);
  const player: AwardCandidate = {
    name: state.playerName,
    teamId: state.playerTeamId,
    points: state.playerStats.points / games,
    rebounds: state.playerStats.rebounds / games,
    assists: state.playerStats.assists / games,
    steals: state.playerStats.steals / games,
    blocks: state.playerStats.blocks / games,
    turnovers: state.playerStats.turnovers / games,
    efficiency: 0,
  };
  player.efficiency = player.points + player.rebounds * 1.1 + player.assists * 1.35 + (player.steals + player.blocks) * 1.8 - player.turnovers + playerTeamWin * 10;
  return [...candidates, player];
}

function calculateAwards(state: CareerSeasonState): CareerAward[] {
  const candidates = generatedCandidates(state);
  const overall = [...candidates].sort((first, second) => second.efficiency - first.efficiency);
  const defenders = [...candidates].sort((first, second) =>
    (second.steals * 2 + second.blocks * 2.2 + winPercentage(state.standings[second.teamId]) * 4)
    - (first.steals * 2 + first.blocks * 2.2 + winPercentage(state.standings[first.teamId]) * 4),
  );
  const improvementBaseline = (name: string) => hashText(
    state.seasonNumber === 1 ? `${name}:baseline` : `${state.seasonId}:${name}:baseline`,
  ) % 90 / 10;
  const improvement = [...candidates].sort((first, second) =>
    (second.points + second.assists * 0.8 - improvementBaseline(second.name))
    - (first.points + first.assists * 0.8 - improvementBaseline(first.name)),
  );
  const bestTeam = rankedStandings(state.standings)[0];
  const allLeague = overall.slice(0, 5);
  const allDefense = defenders.slice(0, 5);
  const playerCandidate = candidates.at(-1)!;
  const rookieWinner = playerCandidate.efficiency >= 33 ? playerCandidate : overall.find((candidate) => candidate.name !== state.playerName)!;
  const annualAwards: CareerAward[] = [
    { id: "MVP", label: "最有价值球员", winnerName: overall[0].name, teamId: overall[0].teamId, reason: "综合效率、累计贡献与球队战绩最高" },
    { id: "DPOY", label: "最佳防守球员", winnerName: defenders[0].name, teamId: defenders[0].teamId, reason: "抢断、盖帽与球队防守战绩综合领先" },
    { id: "MIP", label: "最佳进步球员", winnerName: improvement[0].name, teamId: improvement[0].teamId, reason: "相对赛季基线的综合贡献提升最大" },
    { id: "COY", label: "最佳教练", winnerName: `${leagueTeams.find((team) => team.id === bestTeam.teamId)!.shortName}教练`, teamId: bestTeam.teamId, reason: `联盟最佳战绩 ${bestTeam.wins}-${bestTeam.losses}` },
    { id: "ALL_LEAGUE", label: "最佳阵容", winnerName: allLeague.map((candidate) => candidate.name).join("、"), reason: "五名综合贡献最高球员" },
    { id: "ALL_DEFENSE", label: "最佳防守阵容", winnerName: allDefense.map((candidate) => candidate.name).join("、"), reason: "五名防守贡献最高球员" },
  ];
  if (state.seasonNumber === 1) {
    annualAwards.push(
      { id: "ROOKIE", label: "最佳新秀", winnerName: rookieWinner.name, teamId: rookieWinner.teamId, reason: "仅首个赛季评选，依据新秀综合贡献" },
      { id: "ALL_ROOKIE", label: "最佳新秀阵容", winnerName: [rookieWinner.name, ...overall.filter((candidate) => candidate.name !== rookieWinner.name).slice(0, 4).map((candidate) => candidate.name)].join("、"), reason: "仅首个赛季展示" },
    );
  }
  return annualAwards;
}

function simulateEligibleGames(
  state: CareerSeasonState,
  targetDate: string,
  ratings: Ratings,
  options: CareerSimulationOptions = {},
) {
  const games = state.games.map((game) => ({ ...game, result: game.result ? { ...game.result } : undefined }));
  const standings = Object.fromEntries(Object.entries(state.standings).map(([id, line]) => [id, { ...line }])) as Record<string, TeamStanding>;
  const deferredGameIds = new Set(options.deferGameIds ?? []);
  let seed = state.seed;
  let playerStats = { ...state.playerStats };
  const order = games.map((game, index) => ({ game, index })).sort((first, second) => first.game.date.localeCompare(second.game.date) || first.game.id.localeCompare(second.game.id));
  for (const { game, index } of order) {
    if (game.status === "FINAL" || game.date > targetDate || deferredGameIds.has(game.id)) continue;
    const simulated = simulateScore(game, seed, state.startYear);
    seed = simulated.seed;
    games[index] = { ...game, status: "FINAL", result: simulated.result };
    addGameToStandings(standings, game, simulated.result);
    if (game.awayTeamId === state.playerTeamId || game.homeTeamId === state.playerTeamId) {
      const teamScore = game.homeTeamId === state.playerTeamId ? simulated.result.homeScore : simulated.result.awayScore;
      const playerGame = simulateCreatedPlayerStatLine(ratings, seed, teamScore);
      playerStats = addCreatedPlayerStatLine(playerStats, playerGame.line);
      seed = playerGame.seed;
    }
  }
  return { ...state, games, standings, playerStats, seed };
}

export function simulateCareerToDate(
  state: CareerSeasonState,
  targetDate: string,
  ratings: Ratings,
  options: CareerSimulationOptions = {},
): CareerSeasonState {
  if (targetDate < state.currentDate) throw new Error("Cannot simulate backwards");
  if (targetDate > state.endDate) throw new Error("Target date is beyond the current season");
  let next = state;
  if (!next.cupResolved && targetDate >= state.cupResolutionDate) {
    const resolutionTimestamp = Date.parse(`${state.cupResolutionDate}T00:00:00Z`);
    const preResolutionDate = new Date(resolutionTimestamp - 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    next = simulateEligibleGames(next, preResolutionDate, ratings, options);
    next = resolveCupSchedule(next);
  }
  next = simulateEligibleGames(next, targetDate, ratings, options);
  next = { ...next, currentDate: targetDate };
  if (targetDate === state.endDate
    && next.awards.length === 0
    && next.games.every((game) => game.status === "FINAL")) {
    next = { ...next, awards: calculateAwards(next) };
  }
  return next;
}

export function getTeamCalendar(state: CareerSeasonState, teamId = state.playerTeamId): TeamCalendarEvent[] {
  const events = state.games
    .filter((game) => game.awayTeamId === teamId || game.homeTeamId === teamId)
    .map((game): TeamCalendarEvent => ({
      id: game.id,
      date: game.date,
      opponentTeamId: game.awayTeamId === teamId ? game.homeTeamId : game.awayTeamId,
      venue: game.homeTeamId === teamId ? "HOME" : "AWAY",
      source: game.source,
      status: game.status,
      result: game.result,
    }));
  if (!state.cupResolved) {
    const [firstCupDate, secondCupDate] = getCareerSeasonCupGameDates(state);
    const placeholderPrefix = state.seasonNumber === 1 ? "" : `${state.seasonId}-`;
    events.push(
      { id: `${placeholderPrefix}cup-tbd-1-${teamId}`, date: firstCupDate, venue: "TBD", source: "DYNAMIC_CUP", status: "TBD" },
      { id: `${placeholderPrefix}cup-tbd-2-${teamId}`, date: secondCupDate, venue: "TBD", source: "DYNAMIC_CUP", status: "TBD" },
    );
  }
  return events.sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id));
}

export function playerAverages(line: PlayerSeasonLine) {
  const games = Math.max(1, line.games);
  return {
    points: line.points / games,
    rebounds: line.rebounds / games,
    assists: line.assists / games,
    steals: line.steals / games,
    blocks: line.blocks / games,
    fieldGoalPercentage: line.attempts === 0 ? 0 : line.made / line.attempts,
  };
}
