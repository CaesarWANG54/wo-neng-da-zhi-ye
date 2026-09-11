import type { JerseyNumber } from "./jersey-number";

export type TeamSide = "home" | "away";

export type DifficultyId = "ROOKIE" | "PRO" | "STARTER" | "ALL_STAR" | "HALL_OF_FAME";

export type Position = "PG" | "SG" | "SF" | "PF" | "C";

export type PossessionPhase =
  | "SET_OFFENSE"
  | "SCREEN_APPROACH"
  | "SECOND_DECISION"
  | "SHOT_FLIGHT"
  | "REBOUND"
  | "FREE_THROW"
  | "FASTBREAK"
  | "DEAD_BALL"
  | "INBOUND_READY"
  | "BACKCOURT_ADVANCE"
  | "PERIOD_END"
  | "TIP_OFF"
  | "FINAL";

export type DeadBallReason =
  | "MADE_BASKET"
  | "PERIOD_START"
  | "OUT_OF_BOUNDS"
  | "PERSONAL_FOUL"
  | "OFFENSIVE_FOUL"
  | "OFFENSIVE_THREE_SECONDS"
  | "DEFENSIVE_THREE_SECONDS"
  | "GOALTENDING"
  | "BASKET_INTERFERENCE"
  | "FREE_THROW_VIOLATION"
  | "SHOT_CLOCK_VIOLATION"
  | "BACKCOURT_VIOLATION"
  | "OVER_AND_BACK_VIOLATION"
  | "INBOUND_VIOLATION";

export type InboundSpot = "BASELINE" | "SIDELINE_BACKCOURT" | "SIDELINE_FRONTCOURT" | "MIDCOURT";

export interface RestartPlan {
  team: TeamSide;
  spot: InboundSpot;
  reason: DeadBallReason;
  shotClock: number;
  requiresAdvance: boolean;
  retainsPossession: boolean;
  gameClockContinues: boolean;
  backcourtClock?: number;
}

export interface MatchRules {
  regulationPeriodSeconds: number;
  overtimePeriodSeconds: number;
  fullShotClockSeconds: number;
  offensiveReboundSeconds: number;
  inboundSeconds: number;
  backcourtSeconds: number;
  fastbreakSeconds: number;
}

export interface GameResult {
  id: string;
  winner: TeamSide;
  homeScore: number;
  awayScore: number;
  overtimeCount: number;
}

export type ScreenCoverage = "SWITCH" | "DROP_OVER" | "DROP_UNDER" | "HEDGE_RECOVER" | "BLITZ";

export type ScreenRoute = "ROLL" | "POP" | "SHORT_ROLL" | "SLIP";

export type ScreenResult =
  | "CLEAN_ADVANTAGE"
  | "SMALL_ADVANTAGE"
  | "MISMATCH_CREATED"
  | "DEFENSE_SOLVED"
  | "MISSED_CONTACT";

export interface Ratings {
  closeShot: number;
  layup: number;
  drivingDunk: number;
  standingDunk: number;
  postFinish: number;
  drawFoul: number;
  midRange: number;
  threePoint: number;
  freeThrow: number;
  pullUpShot: number;
  catchShoot: number;
  shotConsistency: number;
  ballHandle: number;
  ballSecurity: number;
  passAccuracy: number;
  passVision: number;
  passSpeed: number;
  offBallMovement: number;
  decisionSpeed: number;
  speed: number;
  speedWithBall: number;
  acceleration: number;
  strength: number;
  vertical: number;
  stamina: number;
  agility: number;
  perimeterDefense: number;
  interiorDefense: number;
  steal: number;
  block: number;
  lateralQuickness: number;
  screenNavigation: number;
  helpDefenseIQ: number;
  defenseConsistency: number;
  offensiveRebound: number;
  defensiveRebound: number;
  basketballIQ: number;
  hands: number;
}

export interface CourtPlayer {
  id: string;
  team: TeamSide;
  number: JerseyNumber;
  position: Position;
  x: number;
  y: number;
  ratings: Ratings;
}

export interface CourtPoint {
  x: number;
  y: number;
}

export type MotionIntent =
  | "HOLD"
  | "HANDLE"
  | "SPACE"
  | "RECEIVE"
  | "CUT"
  | "SCREEN"
  | "ROLL"
  | "POP"
  | "DRIVE"
  | "SHOOT"
  | "FREE_THROW"
  | "REBOUND"
  | "CONTAIN"
  | "STEAL"
  | "CONTEST"
  | "SWITCH"
  | "ZONE_TOP"
  | "ZONE_WING"
  | "ZONE_RIM"
  | "TRANSITION"
  | "INBOUND";

export type DefenseScheme = "MAN" | "ZONE_2_3";

export type OpponentPlayId =
  | "OPEN_41"
  | "PRIN_CHIN"
  | "BLOCKER_MOVER"
  | "HORNS_STS"
  | "FLEX_CONT"
  | "HIGH_LOW"
  | "DRIBBLE_DRIVE"
  | "ZONE_OVERLOAD"
  | "EARLY_DHO";

export type HomeTacticId = "HORNS" | "FIVE_OUT" | "HANDOFF" | "STAGGER";

export type HomeTacticStage = "ALIGN" | "TRIGGER" | "READ" | "COUNTER";

export interface HomeTacticExecution {
  id: string;
  tacticId: HomeTacticId;
  side: "UPPER" | "LOWER";
  variant: 0 | 1 | 2;
  signature: string;
  primaryPlayerId: string;
  startedAtShotClock: number;
  executionScore: number;
  entryLabel: string;
  counterLabel: string;
}

export type OpponentStage = "SETUP" | "ENTRY" | "TRIGGER" | "READ" | "SHOT_PREP";

export type OpponentIntent =
  | "SETUP"
  | "PASS"
  | "HANDOFF"
  | "BALL_SCREEN"
  | "CUT"
  | "DRIVE"
  | "POST"
  | "SHOOT";

export type OpponentShotType =
  | "RIM"
  | "CUT"
  | "ROLL"
  | "POST"
  | "MID_RANGE"
  | "PULL_UP"
  | "THREE"
  | "KICK_THREE";

export type DefenseResponseAction = "CONTAIN" | "CONTEST" | "STEAL_PRESSURE" | "GAMBLE" | "SWITCH" | "ZONE";

export interface PendingDefenseResponse {
  decisionToken: string;
  action: DefenseResponseAction;
}

export interface DefenseResponseFeedback {
  decisionToken: string;
  action: DefenseResponseAction;
  label: string;
  eventSequence: number;
}

export interface StealAttemptAccumulator {
  defenderId: string;
  possessionSerial: number;
  count: number;
}

export interface PendingOpponentAttempt {
  shooterId: string;
  shotType: OpponentShotType;
  points: 2 | 3;
  label: string;
  quality: number;
}

export interface OpponentPossessionState {
  id: string;
  playId: OpponentPlayId;
  stageIndex: number;
  stage: OpponentStage;
  side: "UPPER" | "LOWER";
  variant: 0 | 1 | 2;
  decisionToken: string;
  decisionCount: number;
  startedAtShotClock: number;
  visibleIntent: OpponentIntent;
  qualityModifier: number;
  pendingAttempt?: PendingOpponentAttempt;
}

export type BallFlightKind = "PASS" | "BOUNCE" | "LOB" | "ALLEY_OOP" | "HANDOFF" | "INBOUND" | "OUTLET" | "SHOT" | "FREE_THROW" | "RIM_REBOUND" | "LOOSE_BALL";

/** Pass-like flight kinds that carry explicit arrival (catch) semantics. */
export type BallFlightKindForPass = "PASS" | "BOUNCE" | "LOB" | "ALLEY_OOP" | "HANDOFF" | "INBOUND" | "OUTLET";

export interface BallFlightState {
  fromPlayerId?: string;
  toPlayerId?: string;
  start: CourtPoint;
  end: CourtPoint;
  elapsed: number;
  duration: number;
  distanceMeters: number;
  speedMetersPerSecond: number;
  kind: BallFlightKind;
  startHeightMeters: number;
  endHeightMeters: number;
  apexHeightMeters: number;
  lateralCurve?: number;
}

export type ShotFlightType = "THREE" | "MID_RANGE" | "RIM" | "DUNK" | "ALLEY_OOP";
export type PersonalFoulSource = "FORCED" | "NATURAL";

export interface PendingShotState {
  id: string;
  attackingTeam: TeamSide;
  shooterId: string;
  points: 2 | 3;
  made: boolean;
  blocked: boolean;
  blockerId?: string;
  goaltended?: boolean;
  goaltenderId?: string;
  shootingFoul?: boolean;
  foulerId?: string;
  foulSource?: PersonalFoulSource;
  assistPlayerId?: string;
  offensiveInterference?: boolean;
  interfererId?: string;
  shotType: ShotFlightType;
  explanation: string;
  seed: number;
  releaseShotClock: number;
  plannedRebound?: ReboundResolutionState;
}

export type OfficialCallKind =
  | "SHOOTING_FOUL"
  | "COMMON_FOUL"
  | "OFFENSIVE_CHARGE"
  | "ILLEGAL_SCREEN"
  | "LOOSE_BALL_FOUL"
  | "OFFENSIVE_THREE_SECONDS"
  | "DEFENSIVE_THREE_SECONDS"
  | "DEFENSIVE_GOALTENDING"
  | "OFFENSIVE_INTERFERENCE";

export interface OfficialCallState {
  id: string;
  kind: OfficialCallKind;
  offendingTeam: TeamSide;
  offenderId?: string;
  offendedPlayerId?: string;
  text: string;
  atGameSecond: number;
}

export interface FreeThrowSequenceState {
  id: string;
  shooterId: string;
  shootingTeam: TeamSide;
  foulerId?: string;
  reason: "SHOOTING_FOUL" | "BONUS" | "DEFENSIVE_THREE_SECONDS";
  total: 1 | 2 | 3;
  attempted: number;
  made: number;
  results: Array<"MADE" | "MISSED">;
  stage: "SETUP" | "FLIGHT" | "BETWEEN";
  currentMade?: boolean;
  currentProbability?: number;
  retainPossession: boolean;
  liveAfterFinalMiss: boolean;
  resumeShotClock: number;
  laneOccupied: boolean;
  seed: number;
}

export type MissCollision = "FRONT_RIM" | "BACK_RIM" | "SIDE_RIM" | "BACKBOARD" | "AIRBALL";

export interface ReboundCandidate {
  playerId: string;
  team: TeamSide;
  distanceMeters: number;
  arrivalSeconds: number;
  score: number;
  probability: number;
  boxOutEdge: number;
}

export interface ReboundResolutionState {
  id: string;
  attackingTeam: TeamSide;
  winnerId: string;
  offensive: boolean;
  contested: boolean;
  landingPoint: CourtPoint;
  collision: MissCollision;
  rimContacted: boolean;
  candidates: ReboundCandidate[];
  seed: number;
}

export interface PendingReboundState {
  resolution: ReboundResolutionState;
  shot: PendingShotState;
}

/**
 * Explicit pass-arrival semantics (P3): when a live pass is released, the
 * receiver is NOT yet the ball handler. The handler stays with the passer
 * until the ball flight physically reaches the fixed catch point; only then
 * does the engine emit one catch event and transfer control (or resume the
 * AI stage / player continuation). A stale pendingPass is cancelled by any
 * possession or phase change.
 *
 * The state holds only serializable information — no functions or closures.
 * arrivalPatch carries the plain-data semantic patch (phase, advantage,
 * screen, clocks) that must be applied only after the physical catch.
 */
export type PassContinuation = "AI_STAGE" | "PLAYER_SETTLE" | "OUTLET";

export interface PendingPassState {
  id: string;
  fromPlayerId: string;
  toPlayerId: string;
  kind: BallFlightKindForPass;
  catchPoint: CourtPoint;
  possession: TeamSide;
  phaseTokenAtRelease: string;
  decisionEpochAtRelease: number;
  frontcourtEstablishedAtRelease: boolean;
  continuation: PassContinuation;
  arrivalText?: string;
  arrivalPatch?: Partial<
    Pick<
      MatchState,
      | "phase"
      | "advantage"
      | "screen"
      | "frontcourtEstablished"
      | "fastbreakClock"
      | "shotClock"
      | "backcourtClock"
      | "transitionClock"
      | "restart"
      | "intentionalFoulClock"
    >
  >;
}

/**
 * A user-started drive remains live while the controlled handler follows the
 * route. Every drive finishes automatically only after the handler has
 * physically reached the restricted-area approach: an open lane becomes a
 * dunk, while a protected lane uses the layup/defense model. Any intervening
 * decision can cancel this state without leaving an unrelated timer behind.
 */
export interface PendingDriveState {
  id: string;
  handlerId: string;
  startedAtShotClock: number;
  laneOpenAtStart: boolean;
  rimProtectorId?: string;
  pathBlockerIds: string[];
}

export interface CourtMotionState {
  positions: Record<string, CourtPoint>;
  velocities: Record<string, CourtPoint>;
  routes: Record<string, CourtPoint[]>;
  intents: Record<string, MotionIntent>;
  clock: number;
  frame: number;
  lastActionOwnerId?: string;
  ballFlight?: BallFlightState;
}

export interface ScreenResolution {
  id: string;
  handlerId: string;
  screenerId: string;
  decisionOwnerId: string;
  handlerDefenderBefore: string;
  screenerDefenderBefore: string;
  handlerDefenderAfter: string;
  screenerDefenderAfter: string;
  coverage: ScreenCoverage;
  route: ScreenRoute;
  result: ScreenResult;
  mismatch: "NONE" | "BIG_ON_HANDLER" | "SMALL_ON_ROLLER";
  contactQuality: number;
  separation: number;
  rollOpenness: number;
  popOpenness: number;
  explanation: string;
}

export interface GameEvent {
  id: string;
  kind: string;
  text: string;
  atGameSecond: number;
}

export interface BoxScoreLine {
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
  offensiveRebounds: number;
  defensiveRebounds: number;
  personalFouls: number;
}

export interface MatchState {
  seed: number;
  version: number;
  decisionEpoch: number;
  eventSequence: number;
  phaseToken: string;
  homeScore: number;
  awayScore: number;
  initialHomeScore: number;
  initialAwayScore: number;
  gameSeconds: number;
  shotClock: number;
  inboundClock: number | null;
  backcourtClock: number | null;
  frontcourtEstablished: boolean;
  fastbreakClock: number | null;
  transitionClock: number | null;
  aiDecisionClock: number | null;
  intentionalFoulClock: number | null;
  period: 1 | 2 | 3 | 4;
  overtime: number;
  openingTipWinner: TeamSide;
  rules: MatchRules;
  possession: TeamSide;
  difficulty: DifficultyId;
  phase: PossessionPhase;
  deadBallReason?: DeadBallReason;
  restart?: RestartPlan;
  gameResult?: GameResult;
  createdPlayerId: string;
  controlledPlayerId: string;
  ballHandlerId: string;
  potentialAssistPlayerId?: string;
  potentialAssistReceiverId?: string;
  currentMatchups: Record<string, string>;
  defenseScheme: DefenseScheme;
  opponentOffense?: OpponentPossessionState;
  pendingDefenseResponse?: PendingDefenseResponse;
  lastDefenseResponse?: DefenseResponseFeedback;
  stealAttemptAccumulator?: StealAttemptAccumulator;
  lastOpponentGuideKey?: string;
  opponentPlayHistory: OpponentPlayId[];
  lastHomeTacticSignature?: string;
  homeTacticSignatureHistory: string[];
  homeTacticHistory: HomeTacticId[];
  homeTacticExecution?: HomeTacticExecution;
  advantage?: "DRIVE_LANE" | "KICK_OUT" | "MISMATCH" | "SECOND_CHANCE";
  lastOfficialCall?: OfficialCallState;
  freeThrowSequence?: FreeThrowSequenceState;
  teamFouls: Record<TeamSide, number>;
  latePeriodTeamFouls: Record<TeamSide, number>;
  offensivePossessionSerial: number;
  naturalFoulPossessions: number[];
  naturalThreePointFoulPossessions: number[];
  threeSecondClocks: Record<string, number>;
  disqualifiedPlayerIds: string[];
  pendingShot?: PendingShotState;
  pendingRebound?: PendingReboundState;
  pendingDrive?: PendingDriveState;
  pendingPass?: PendingPassState;
  lastRebound?: ReboundResolutionState;
  secondChanceCount: number;
  motion: CourtMotionState;
  screen?: ScreenResolution;
  activeTactic?: HomeTacticId;
  eventLog: GameEvent[];
  playerStats: BoxScoreLine;
  opponentStats: BoxScoreLine;
  playerBoxScores: import("./player-stats").PlayerStatsLedger;
}

export interface Resolution<T> {
  value: T;
  seed: number;
  probability: number;
  explanation: string;
}
