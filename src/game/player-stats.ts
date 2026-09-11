import type { CourtPlayer, TeamSide } from "./types";

export interface PlayerStatLine {
  playerId: string;
  team: TeamSide;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  points: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  personalFouls: number;
  secondsPlayed: number;
  plusMinus: number;
}

export interface PlayerStatsLedger {
  playerIds: readonly string[];
  byPlayerId: Readonly<Record<string, Readonly<PlayerStatLine>>>;
}

interface OnCourtContext {
  /** Defaults to the ledger's ten players, which are all on court in the prototype. */
  onCourtPlayerIds?: readonly string[];
}

export type PlayerStatsEvent =
  | ({
      type: "SHOT_ATTEMPT";
      shooterId: string;
      made: boolean;
      points: 2 | 3;
      assistPlayerId?: string;
      blockedByPlayerId?: string;
    } & OnCourtContext)
  | ({
      type: "FREE_THROW";
      shooterId: string;
      made: boolean;
    } & OnCourtContext)
  | {
      type: "REBOUND";
      playerId: string;
      offensive: boolean;
    }
  | {
      type: "TURNOVER";
      playerId: string;
      stolenByPlayerId?: string;
    }
  | {
      type: "STEAL";
      playerId: string;
    }
  | {
      type: "PERSONAL_FOUL";
      playerId: string;
    }
  | {
      type: "PLAYING_TIME";
      elapsedSeconds: number;
      onCourtPlayerIds?: readonly string[];
    };

function emptyLine(player: Pick<CourtPlayer, "id" | "team">): PlayerStatLine {
  return {
    playerId: player.id,
    team: player.team,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    points: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    personalFouls: 0,
    secondsPlayed: 0,
    plusMinus: 0,
  };
}

/** Creates the authoritative on-court box-score ledger for exactly five players per team. */
export function initializeTenPlayerStats(players: readonly Pick<CourtPlayer, "id" | "team">[]): PlayerStatsLedger {
  if (players.length !== 10) throw new Error(`A ten-player ledger requires exactly 10 players; received ${players.length}.`);
  const ids = players.map((player) => player.id);
  if (new Set(ids).size !== ids.length) throw new Error("Player ids in the stats ledger must be unique.");
  const homeCount = players.filter((player) => player.team === "home").length;
  const awayCount = players.filter((player) => player.team === "away").length;
  if (homeCount !== 5 || awayCount !== 5) {
    throw new Error(`A ten-player ledger requires five home and five away players; received ${homeCount}/${awayCount}.`);
  }
  return {
    playerIds: [...ids],
    byPlayerId: Object.fromEntries(players.map((player) => [player.id, emptyLine(player)])),
  };
}

function requireLine(ledger: PlayerStatsLedger, playerId: string): Readonly<PlayerStatLine> {
  const line = ledger.byPlayerId[playerId];
  if (!line) throw new Error(`Unknown player id in stats event: ${playerId}`);
  return line;
}

function mutate(
  ledger: PlayerStatsLedger,
  playerId: string,
  update: (line: PlayerStatLine) => void,
): PlayerStatsLedger {
  const line = { ...requireLine(ledger, playerId) };
  update(line);
  line.rebounds = line.offensiveRebounds + line.defensiveRebounds;
  assertLine(line);
  return { ...ledger, byPlayerId: { ...ledger.byPlayerId, [playerId]: line } };
}

function applyScoreDifferential(
  ledger: PlayerStatsLedger,
  scoringTeam: TeamSide,
  points: number,
  onCourtPlayerIds?: readonly string[],
): PlayerStatsLedger {
  const activeIds = onCourtPlayerIds ?? ledger.playerIds;
  const active = new Set(activeIds);
  activeIds.forEach((id) => requireLine(ledger, id));
  return {
    ...ledger,
    byPlayerId: Object.fromEntries(
      ledger.playerIds.map((id) => {
        const line = ledger.byPlayerId[id];
        if (!active.has(id)) return [id, line];
        return [id, { ...line, plusMinus: line.plusMinus + (line.team === scoringTeam ? points : -points) }];
      }),
    ),
  };
}

/** Applies one box-score event without mutating the input ledger. */
export function applyPlayerStatsEvent(ledger: PlayerStatsLedger, event: PlayerStatsEvent): PlayerStatsLedger {
  switch (event.type) {
    case "SHOT_ATTEMPT": {
      const shooter = requireLine(ledger, event.shooterId);
      if (event.assistPlayerId && requireLine(ledger, event.assistPlayerId).team !== shooter.team) {
        throw new Error("An assist must belong to the shooter's team.");
      }
      if (event.blockedByPlayerId && requireLine(ledger, event.blockedByPlayerId).team === shooter.team) {
        throw new Error("A block must belong to the opposing team.");
      }
      let next = mutate(ledger, event.shooterId, (line) => {
        line.fieldGoalsAttempted += 1;
        line.fieldGoalsMade += event.made ? 1 : 0;
        if (event.points === 3) {
          line.threePointersAttempted += 1;
          line.threePointersMade += event.made ? 1 : 0;
        }
        line.points += event.made ? event.points : 0;
      });
      if (event.made && event.assistPlayerId && event.assistPlayerId !== event.shooterId) {
        next = mutate(next, event.assistPlayerId, (line) => { line.assists += 1; });
      }
      if (!event.made && event.blockedByPlayerId) {
        next = mutate(next, event.blockedByPlayerId, (line) => { line.blocks += 1; });
      }
      return event.made ? applyScoreDifferential(next, shooter.team, event.points, event.onCourtPlayerIds) : next;
    }
    case "FREE_THROW": {
      const shooter = requireLine(ledger, event.shooterId);
      let next = mutate(ledger, event.shooterId, (line) => {
        line.freeThrowsAttempted += 1;
        line.freeThrowsMade += event.made ? 1 : 0;
        line.points += event.made ? 1 : 0;
      });
      if (event.made) next = applyScoreDifferential(next, shooter.team, 1, event.onCourtPlayerIds);
      return next;
    }
    case "REBOUND":
      return mutate(ledger, event.playerId, (line) => {
        if (event.offensive) line.offensiveRebounds += 1;
        else line.defensiveRebounds += 1;
      });
    case "TURNOVER": {
      const offender = requireLine(ledger, event.playerId);
      if (event.stolenByPlayerId && requireLine(ledger, event.stolenByPlayerId).team === offender.team) {
        throw new Error("A steal must belong to the opposing team.");
      }
      let next = mutate(ledger, event.playerId, (line) => { line.turnovers += 1; });
      if (event.stolenByPlayerId) next = mutate(next, event.stolenByPlayerId, (line) => { line.steals += 1; });
      return next;
    }
    case "STEAL":
      return mutate(ledger, event.playerId, (line) => { line.steals += 1; });
    case "PERSONAL_FOUL":
      return mutate(ledger, event.playerId, (line) => { line.personalFouls += 1; });
    case "PLAYING_TIME": {
      if (!Number.isFinite(event.elapsedSeconds) || event.elapsedSeconds < 0) {
        throw new Error("Playing time must be a finite non-negative number of seconds.");
      }
      const activeIds = event.onCourtPlayerIds ?? ledger.playerIds;
      return activeIds.reduce(
        (next, id) => mutate(next, id, (line) => { line.secondsPlayed += event.elapsedSeconds; }),
        ledger,
      );
    }
  }
}

export function applyPlayerStatsEvents(
  ledger: PlayerStatsLedger,
  events: readonly PlayerStatsEvent[],
): PlayerStatsLedger {
  return events.reduce(applyPlayerStatsEvent, ledger);
}

export function assertLine(line: Readonly<PlayerStatLine>): void {
  const countingFields: (keyof PlayerStatLine)[] = [
    "fieldGoalsMade", "fieldGoalsAttempted", "threePointersMade", "threePointersAttempted",
    "freeThrowsMade", "freeThrowsAttempted", "points", "offensiveRebounds", "defensiveRebounds",
    "rebounds", "assists", "steals", "blocks", "turnovers", "personalFouls", "secondsPlayed",
  ];
  countingFields.forEach((field) => {
    const value = line[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid ${field} for player ${line.playerId}.`);
    }
  });
  if (line.fieldGoalsMade > line.fieldGoalsAttempted) throw new Error("Field goals made cannot exceed attempts.");
  if (line.threePointersMade > line.threePointersAttempted) throw new Error("Three-pointers made cannot exceed attempts.");
  if (line.freeThrowsMade > line.freeThrowsAttempted) throw new Error("Free throws made cannot exceed attempts.");
  if (line.threePointersMade > line.fieldGoalsMade || line.threePointersAttempted > line.fieldGoalsAttempted) {
    throw new Error("Three-point totals must be a subset of field-goal totals.");
  }
  if (line.rebounds !== line.offensiveRebounds + line.defensiveRebounds) {
    throw new Error("Total rebounds must equal offensive plus defensive rebounds.");
  }
}

export function assertPlayerStatsLedger(ledger: PlayerStatsLedger): void {
  if (ledger.playerIds.length !== 10 || new Set(ledger.playerIds).size !== 10) {
    throw new Error("A valid on-court ledger must contain ten unique players.");
  }
  ledger.playerIds.forEach((id) => assertLine(requireLine(ledger, id)));
}
