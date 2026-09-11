import { nextRandom } from "./core";
import type { CourtPoint, Ratings, TeamSide } from "./types";

const COURT_LENGTH_METERS = 28.65;
const COURT_WIDTH_METERS = 15.24;

export type CommonFoulKind =
  | "SHOOTING"
  | "NON_SHOOTING"
  | "OFFENSIVE_CHARGE"
  | "ILLEGAL_SCREEN"
  | "LOOSE_BALL";

export interface TeamFoulContext {
  overtime: boolean;
  foulsBefore: number;
  inLastTwoMinutes: boolean;
  lateFoulsBefore: number;
}

export interface FoulPenaltyInput {
  kind: CommonFoulKind;
  shotMade?: boolean;
  shotPoints?: 2 | 3;
  inPenalty?: boolean;
}

export interface FoulPenalty {
  freeThrows: 0 | 1 | 2 | 3;
  changePossession: boolean;
  retainAfterFreeThrows: boolean;
  liveAfterFinalMiss: boolean;
  countsTeamFoul: boolean;
}

export interface FreeThrowResolution {
  made: boolean;
  probability: number;
  seed: number;
}

export interface ShootingContactResolution {
  foul: boolean;
  probability: number;
  seed: number;
}

export const NATURAL_FOUL_WINDOW_POSSESSIONS = 10;
export const NATURAL_THREE_POINT_FOUL_WINDOW_POSSESSIONS = 50;

export interface NaturalFoulHistory {
  currentPossession: number;
  foulPossessions: readonly number[];
  threePointFoulPossessions: readonly number[];
}

export interface ThreeSecondContext {
  attackingTeam: TeamSide;
  teamHasFrontcourtControl: boolean;
  teamHasControl: boolean;
  shotInProgress?: boolean;
  imminentExit?: boolean;
}

export type BasketInterferenceCall = "LEGAL" | "DEFENSIVE_GOALTENDING" | "OFFENSIVE_INTERFERENCE";

export interface BasketInterferenceInput {
  shootingTeam: TeamSide;
  touchingTeam: TeamSide;
  descending: boolean;
  aboveRing: boolean;
  withinCylinder: boolean;
  touchedBackboard: boolean;
  hasChanceToScore: boolean;
  ballOnRing?: boolean;
  handThroughRing?: boolean;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function physicalDistance(a: CourtPoint, b: CourtPoint) {
  return Math.hypot(
    ((b.x - a.x) / 100) * COURT_LENGTH_METERS,
    ((b.y - a.y) / 100) * COURT_WIDTH_METERS,
  );
}

/**
 * Regulation permits four ordinary team fouls without the penalty; overtime
 * permits three. If the quota was not reached before the final two minutes,
 * the team may commit one ordinary foul in that final-two-minute window.
 */
export function isPenaltyAfterCommonFoul(context: TeamFoulContext) {
  const quota = context.overtime ? 3 : 4;
  if (!context.inLastTwoMinutes) return context.foulsBefore + 1 > quota;
  if (context.foulsBefore >= quota) return true;
  return context.lateFoulsBefore >= 1;
}

export function resolveFoulPenalty(input: FoulPenaltyInput): FoulPenalty {
  if (input.kind === "OFFENSIVE_CHARGE" || input.kind === "ILLEGAL_SCREEN") {
    return {
      freeThrows: 0,
      changePossession: true,
      retainAfterFreeThrows: false,
      liveAfterFinalMiss: false,
      countsTeamFoul: false,
    };
  }
  if (input.kind === "SHOOTING") {
    const freeThrows = input.shotMade ? 1 : input.shotPoints === 3 ? 3 : 2;
    return {
      freeThrows,
      changePossession: false,
      retainAfterFreeThrows: false,
      liveAfterFinalMiss: true,
      countsTeamFoul: true,
    };
  }
  const freeThrows = input.inPenalty ? 2 : 0;
  return {
    freeThrows,
    changePossession: false,
    retainAfterFreeThrows: false,
    liveAfterFinalMiss: freeThrows > 0,
    countsTeamFoul: true,
  };
}

export function resolveAutomaticFreeThrow(
  ratings: Pick<Ratings, "freeThrow" | "shotConsistency" | "stamina">,
  seed: number,
  ratingMultiplier = 1,
): FreeThrowResolution {
  const roll = nextRandom(seed);
  const weightedRating = (
    ratings.freeThrow * 0.82
    + ratings.shotConsistency * 0.12
    + ratings.stamina * 0.06
  ) * ratingMultiplier;
  const probability = clamp(0.18 + weightedRating / 132, 0.42, 0.965);
  return { made: roll.value < probability, probability, seed: roll.seed };
}

export function resolveShootingContact(
  attacker: Pick<Ratings, "drawFoul" | "strength" | "ballSecurity">,
  defender: Pick<Ratings, "defenseConsistency" | "lateralQuickness" | "helpDefenseIQ">,
  seed: number,
  rimAttempt: boolean,
  aggressiveContest: boolean,
): ShootingContactResolution {
  const roll = nextRandom(seed);
  const attackPressure = attacker.drawFoul * 0.46 + attacker.strength * 0.2 + attacker.ballSecurity * 0.08;
  const discipline = defender.defenseConsistency * 0.34 + defender.lateralQuickness * 0.16 + defender.helpDefenseIQ * 0.12;
  const probability = clamp(
    0.006 + (attackPressure - discipline) / 850 + (rimAttempt ? 0.028 : 0.006) + (aggressiveContest ? 0.016 : 0),
    0.004,
    0.085,
  );
  return { foul: roll.value < probability, probability, seed: roll.seed };
}

function hasFoulInsideWindow(possessions: readonly number[], current: number, window: number) {
  return possessions.some((possession) => possession > current - window && possession <= current);
}

/**
 * Natural whistles are deliberately sparse. Forced rules fixtures bypass this
 * gate so the referee state machine can still be tested directly.
 */
export function isNaturalFoulAllowed(history: NaturalFoulHistory, threePointAttempt = false) {
  if (!Number.isInteger(history.currentPossession) || history.currentPossession < 1) return false;
  if (hasFoulInsideWindow(history.foulPossessions, history.currentPossession, NATURAL_FOUL_WINDOW_POSSESSIONS)) return false;
  return !threePointAttempt || !hasFoulInsideWindow(
    history.threePointFoulPossessions,
    history.currentPossession,
    NATURAL_THREE_POINT_FOUL_WINDOW_POSSESSIONS,
  );
}

export function assertNaturalFoulHistory(history: NaturalFoulHistory) {
  const general = [...history.foulPossessions];
  const threes = [...history.threePointFoulPossessions];
  const valid = (values: readonly number[]) => values.every((value, index) => (
    Number.isInteger(value)
    && value >= 1
    && value <= history.currentPossession
    && (index === 0 || value > values[index - 1])
  ));
  if (!valid(general) || !valid(threes)) throw new Error("Natural foul history must be sorted, unique and within the current possession.");
  if (general.some((value, index) => index > 0 && value - general[index - 1] < NATURAL_FOUL_WINDOW_POSSESSIONS)) {
    throw new Error("Natural personal fouls exceeded the ten-possession window.");
  }
  if (threes.some((value, index) => index > 0 && value - threes[index - 1] < NATURAL_THREE_POINT_FOUL_WINDOW_POSSESSIONS)) {
    throw new Error("Natural three-point fouls exceeded the fifty-possession window.");
  }
  if (threes.some((value) => !general.includes(value))) throw new Error("Every natural three-point foul must also be recorded as a natural personal foul.");
  return true;
}

/** The regulation lane is represented as a stable top-view rectangle for this board. */
export function isInsideLane(point: CourtPoint, attackingTeam: TeamSide) {
  const alongCourt = attackingTeam === "home" ? point.x <= 22.5 : point.x >= 77.5;
  return alongCourt && point.y >= 34 && point.y <= 66;
}

export function shouldCountOffensiveThreeSeconds(
  point: CourtPoint,
  context: ThreeSecondContext,
) {
  return Boolean(
    context.teamHasControl
    && context.teamHasFrontcourtControl
    && !context.shotInProgress
    && !context.imminentExit
    && isInsideLane(point, context.attackingTeam),
  );
}

export function isActivelyGuarding(
  defender: CourtPoint,
  offensivePlayers: readonly CourtPoint[],
  armLengthMeters = 1.35,
) {
  return offensivePlayers.some((point) => physicalDistance(defender, point) <= armLengthMeters);
}

export function shouldCountDefensiveThreeSeconds(
  defender: CourtPoint,
  offensivePlayers: readonly CourtPoint[],
  context: ThreeSecondContext,
  guardingBallHandler = false,
) {
  return Boolean(
    context.teamHasControl
    && context.teamHasFrontcourtControl
    && !context.shotInProgress
    && !context.imminentExit
    && isInsideLane(defender, context.attackingTeam)
    && !guardingBallHandler
    && !isActivelyGuarding(defender, offensivePlayers),
  );
}

export function nextThreeSecondClock(previous: number, elapsedSeconds: number, counting: boolean) {
  return counting ? Math.max(0, previous + Math.max(0, elapsedSeconds)) : 0;
}

export function evaluateBasketInterference(input: BasketInterferenceInput): BasketInterferenceCall {
  const protectedBall = input.handThroughRing
    || input.ballOnRing
    || (input.aboveRing && input.withinCylinder)
    || (input.touchedBackboard && input.hasChanceToScore)
    || (input.descending && input.hasChanceToScore);
  if (!protectedBall) return "LEGAL";
  return input.touchingTeam === input.shootingTeam ? "OFFENSIVE_INTERFERENCE" : "DEFENSIVE_GOALTENDING";
}
