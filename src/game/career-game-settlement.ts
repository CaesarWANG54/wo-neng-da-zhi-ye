import { advanceCareerCalendar } from "./career-calendar-progression";
import {
  getCareerSeasonCupGameDates,
  simulateCareerToDate,
  type CareerGame,
  type CareerGameResult,
  type CareerSeasonState,
  type PlayerSeasonLine,
  type TeamStanding,
} from "./career-season";
import {
  applyChemistryEvent,
  effectiveRatings,
  settleCareerGameReward,
  type CareerProgressionState,
} from "./career-progression";
import type { DifficultyId, Ratings } from "./types";

export interface CareerGameSettingsSnapshot {
  difficulty: DifficultyId;
  gameMinutes: 8 | 12 | 24;
}

export function careerMatchTiming(gameMinutes: 8 | 12 | 24) {
  if (![8, 12, 24].includes(gameMinutes)) throw new Error("Career game length must be 8, 12, or 24 minutes");
  const regulationPeriodSeconds = gameMinutes * 15;
  return {
    regulationPeriodSeconds,
    overtimePeriodSeconds: Math.round(regulationPeriodSeconds * 5 / 12),
  };
}

/** Immutable launch contract. Reward settings and effective ratings cannot be changed at the buzzer. */
export interface CareerGameLaunch {
  gameId: string;
  date: string;
  opponentTeamId: string;
  venue: "HOME" | "AWAY";
  difficulty: DifficultyId;
  gameMinutes: 8 | 12 | 24;
  effectiveRatings: Ratings;
}

export interface CareerPlayerGameLine {
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

export interface CareerGameCompletion {
  completed: boolean;
  controlledTeamScore: number;
  opponentScore: number;
  playerLine: CareerPlayerGameLine;
}

export interface CareerGamePreparation {
  season: CareerSeasonState;
  progression: CareerProgressionState;
  launch: CareerGameLaunch;
}

export type CareerGameSettlementStatus = "APPLIED" | "ALREADY_FINAL" | "NOT_COMPLETED";

export interface CareerGameSettlement {
  status: CareerGameSettlementStatus;
  season: CareerSeasonState;
  progression: CareerProgressionState;
  gameId: string;
  won: boolean | null;
  rewardCoins: number;
  chemistryDelta: number;
}

const playerLineFields = [
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

function isPlayerGame(game: CareerGame, playerTeamId: string) {
  return game.awayTeamId === playerTeamId || game.homeTeamId === playerTeamId;
}

function cloneStandings(standings: Record<string, TeamStanding>) {
  return Object.fromEntries(Object.entries(standings).map(([teamId, line]) => [teamId, { ...line }])) as Record<string, TeamStanding>;
}

function nextScheduledPlayerGame(state: CareerSeasonState) {
  const next = state.games
    .filter((game) => game.status === "SCHEDULED" && game.date >= state.currentDate && isPlayerGame(game, state.playerTeamId))
    .sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id))[0];
  // The two Cup dates are deliberately absent from the published source table.
  // Until their bracket is resolved, an already-known December 12+ game must
  // not masquerade as the next playable game and silently simulate the Cup.
  const unresolvedCupDate = !state.cupResolved
    ? getCareerSeasonCupGameDates(state).find((date) => date >= state.currentDate)
    : undefined;
  if (unresolvedCupDate && (!next || unresolvedCupDate <= next.date)) return undefined;
  return next;
}

export function nextPlayableCareerGame(state: CareerSeasonState): CareerGame | undefined {
  return nextScheduledPlayerGame(state);
}

function requireLaunchableGame(state: CareerSeasonState, gameId: string) {
  const game = state.games.find((candidate) => candidate.id === gameId);
  if (!game) throw new Error(`Unknown career game: ${gameId}`);
  if (!isPlayerGame(game, state.playerTeamId)) throw new Error("Career game does not include the player's team");
  if (game.status !== "SCHEDULED") throw new Error("Career game is already final");
  if (game.date < state.currentDate) throw new Error("Career game is before the current calendar date");
  const next = nextScheduledPlayerGame(state);
  if (!next || next.id !== game.id) throw new Error("Only the next scheduled player game can be played");
  return game;
}

/**
 * Advances training weeks and the rest of the league through game day while
 * leaving exactly the selected real schedule game unplayed.
 */
export function prepareCareerGame(
  season: CareerSeasonState,
  progression: CareerProgressionState,
  gameId: string,
  settings: CareerGameSettingsSnapshot,
): CareerGamePreparation {
  if (progression.retired) throw new Error("Retired players cannot start a career game");
  careerMatchTiming(settings.gameMinutes);
  const game = requireLaunchableGame(season, gameId);
  const advanced = advanceCareerCalendar(season, progression, game.date, { deferGameIds: [game.id] });
  const preparedGame = advanced.season.games.find((candidate) => candidate.id === game.id);
  if (!preparedGame || preparedGame.status !== "SCHEDULED") {
    throw new Error("Selected career game was not preserved for manual play");
  }
  const venue = preparedGame.homeTeamId === advanced.season.playerTeamId ? "HOME" : "AWAY";
  const opponentTeamId = venue === "HOME" ? preparedGame.awayTeamId : preparedGame.homeTeamId;
  return {
    season: { ...advanced.season, coins: advanced.progression.coins },
    progression: advanced.progression,
    launch: {
      gameId: preparedGame.id,
      date: preparedGame.date,
      opponentTeamId,
      venue,
      difficulty: settings.difficulty,
      gameMinutes: settings.gameMinutes,
      effectiveRatings: effectiveRatings(advanced.progression.ratings, advanced.progression.chemistryPercent),
    },
  };
}

function assertScore(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 300) throw new Error(`${label} must be an integer from 0 to 300`);
}

function assertPlayerLine(line: CareerPlayerGameLine, teamScore: number) {
  for (const field of playerLineFields) {
    if (!Number.isSafeInteger(line[field]) || line[field] < 0) throw new Error(`Player ${field} must be a non-negative integer`);
  }
  if (line.made > line.attempts
    || line.threesMade > line.threesAttempted
    || line.threesMade > line.made
    || line.threesAttempted > line.attempts
    || line.freeThrowsMade > line.freeThrowsAttempted) {
    throw new Error("Career player shooting line is inconsistent");
  }
  const derivedPoints = (line.made - line.threesMade) * 2 + line.threesMade * 3 + line.freeThrowsMade;
  if (derivedPoints !== line.points) throw new Error("Career player points do not match shooting totals");
  if (line.points > teamScore) throw new Error("Career player points cannot exceed the team score");
}

function mapControlledResult(game: CareerGame, playerTeamId: string, playerScore: number, opponentScore: number): CareerGameResult {
  return game.homeTeamId === playerTeamId
    ? { awayScore: opponentScore, homeScore: playerScore }
    : { awayScore: playerScore, homeScore: opponentScore };
}

function applyGameStanding(
  standings: Record<string, TeamStanding>,
  game: CareerGame,
  result: CareerGameResult,
) {
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

function addPlayerGameLine(seasonLine: PlayerSeasonLine, gameLine: CareerPlayerGameLine): PlayerSeasonLine {
  return {
    games: seasonLine.games + 1,
    points: seasonLine.points + gameLine.points,
    rebounds: seasonLine.rebounds + gameLine.rebounds,
    assists: seasonLine.assists + gameLine.assists,
    steals: seasonLine.steals + gameLine.steals,
    blocks: seasonLine.blocks + gameLine.blocks,
    turnovers: seasonLine.turnovers + gameLine.turnovers,
    made: seasonLine.made + gameLine.made,
    attempts: seasonLine.attempts + gameLine.attempts,
    threesMade: seasonLine.threesMade + gameLine.threesMade,
    threesAttempted: seasonLine.threesAttempted + gameLine.threesAttempted,
    freeThrowsMade: seasonLine.freeThrowsMade + gameLine.freeThrowsMade,
    freeThrowsAttempted: seasonLine.freeThrowsAttempted + gameLine.freeThrowsAttempted,
  };
}

function playerWon(game: CareerGame, playerTeamId: string, result: CareerGameResult) {
  return game.homeTeamId === playerTeamId
    ? result.homeScore > result.awayScore
    : result.awayScore > result.homeScore;
}

/** One pure transaction for the schedule result, standings, player line, coins, and chemistry. */
export function settlePlayedCareerGame(
  season: CareerSeasonState,
  progression: CareerProgressionState,
  launch: CareerGameLaunch,
  completion: CareerGameCompletion,
): CareerGameSettlement {
  const game = season.games.find((candidate) => candidate.id === launch.gameId);
  if (!game) throw new Error(`Unknown career game: ${launch.gameId}`);
  if (!isPlayerGame(game, season.playerTeamId)) throw new Error("Career game does not include the player's team");
  if (game.status === "FINAL") {
    const won = game.result ? playerWon(game, season.playerTeamId, game.result) : null;
    return { status: "ALREADY_FINAL", season, progression, gameId: game.id, won, rewardCoins: 0, chemistryDelta: 0 };
  }
  if (!completion.completed) {
    return { status: "NOT_COMPLETED", season, progression, gameId: game.id, won: null, rewardCoins: 0, chemistryDelta: 0 };
  }
  if (season.currentDate !== game.date || launch.date !== game.date) throw new Error("Career game calendar is not prepared on game day");
  const venue = game.homeTeamId === season.playerTeamId ? "HOME" : "AWAY";
  const opponentTeamId = venue === "HOME" ? game.awayTeamId : game.homeTeamId;
  if (launch.venue !== venue || launch.opponentTeamId !== opponentTeamId) throw new Error("Career game launch contract is stale");
  assertScore(completion.controlledTeamScore, "Controlled team score");
  assertScore(completion.opponentScore, "Opponent score");
  if (completion.controlledTeamScore === completion.opponentScore) throw new Error("A completed career game cannot end tied");
  assertPlayerLine(completion.playerLine, completion.controlledTeamScore);

  const rewardId = `career-game:${game.id}:reward`;
  const outcomeId = `career-game:${game.id}:outcome`;
  if (progression.processedRewardIds.includes(rewardId)
    || progression.processedChemistryEventIds.includes(outcomeId)) {
    throw new Error("Career game settlement markers exist before the schedule result");
  }

  const result = mapControlledResult(game, season.playerTeamId, completion.controlledTeamScore, completion.opponentScore);
  const standings = cloneStandings(season.standings);
  applyGameStanding(standings, game, result);
  const games = season.games.map((candidate) => candidate.id === game.id
    ? { ...candidate, status: "FINAL" as const, result }
    : candidate);
  const recordedSeason = simulateCareerToDate({
    ...season,
    games,
    standings,
    playerStats: addPlayerGameLine(season.playerStats, completion.playerLine),
  }, game.date, launch.effectiveRatings);
  const won = playerWon(game, season.playerTeamId, result);
  const rewarded = settleCareerGameReward(progression, {
    rewardId,
    difficulty: launch.difficulty,
    gameMinutes: launch.gameMinutes,
    mode: "PLAYED",
    completed: true,
  });
  const progressed = applyChemistryEvent(rewarded, outcomeId, won ? "WIN" : "LOSS");
  const nextSeason = { ...recordedSeason, coins: progressed.coins };
  return {
    status: "APPLIED",
    season: nextSeason,
    progression: progressed,
    gameId: game.id,
    won,
    rewardCoins: progressed.coins - progression.coins,
    chemistryDelta: progressed.chemistryPercent - progression.chemistryPercent,
  };
}
