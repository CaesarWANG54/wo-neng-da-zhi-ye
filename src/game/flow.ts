import { applySwitchMatchups, nextRandom, resolveDrive } from "./core";
import { baseMatchups, CREATED_PLAYER_ID, playerById, players } from "./data";
import { DIFFICULTY_PROGRESSION_POLICY } from "./difficulty";
import {
  advanceCourtMotion,
  applyOpponentStageMotion,
  applyFreeThrowFormation,
  applyReboundContestMotion,
  assertMotionInvariants,
  attackRim,
  cancelCourtRoutes,
  courtDistanceMeters,
  freeThrowLinePoint,
  passCatchPoint,
  routePlayerTo,
  startBallFlight,
  startFreeBallFlight,
  startPassFlight,
} from "./movement";
import {
  evaluateBasketInterference,
  assertNaturalFoulHistory,
  isNaturalFoulAllowed,
  isPenaltyAfterCommonFoul,
  nextThreeSecondClock,
  resolveAutomaticFreeThrow,
  resolveFoulPenalty,
  resolveShootingContact,
  shouldCountDefensiveThreeSeconds,
  shouldCountOffensiveThreeSeconds,
  type CommonFoulKind,
} from "./officiating";
import { advanceOpponentDecision, canRunOpponentOffense, startOpponentOffense } from "./opponent-ai";
import { applyPlayerStatsEvent, assertPlayerStatsLedger } from "./player-stats";
import { resolveMissedShotRebound, selectDefensiveReboundOutlet } from "./rebounding";
import type {
  BoxScoreLine,
  DeadBallReason,
  InboundSpot,
  MatchState,
  CourtPoint,
  PossessionPhase,
  PendingShotState,
  PendingPassState,
  PassContinuation,
  BallFlightKindForPass,
  OfficialCallKind,
  PersonalFoulSource,
  RestartPlan,
  ShotFlightType,
  TeamSide,
} from "./types";

const EPSILON = 0.000_5;

export interface OutOfBoundsCall {
  lastTouchedBy: TeamSide;
  spot: "BASELINE" | "SIDELINE";
  zone: "BACKCOURT" | "FRONTCOURT";
  rimContacted?: boolean;
}

function roundSeconds(value: number) {
  return Math.max(0, Math.round(value * 1_000) / 1_000);
}

function opposite(team: TeamSide): TeamSide {
  return team === "home" ? "away" : "home";
}

function defaultHandler(team: TeamSide) {
  return team === "home" ? CREATED_PLAYER_ID : "a7";
}

function withTurnover(stats: BoxScoreLine) {
  return { ...stats, turnovers: stats.turnovers + 1 };
}

function withAttempt(stats: BoxScoreLine, made: boolean, points: 2 | 3) {
  return {
    ...stats,
    points: stats.points + (made ? points : 0),
    made: stats.made + (made ? 1 : 0),
    attempts: stats.attempts + 1,
    threesMade: stats.threesMade + (made && points === 3 ? 1 : 0),
    threesAttempted: stats.threesAttempted + (points === 3 ? 1 : 0),
  };
}

function withFreeThrow(stats: BoxScoreLine, made: boolean) {
  return {
    ...stats,
    points: stats.points + (made ? 1 : 0),
    freeThrowsMade: stats.freeThrowsMade + (made ? 1 : 0),
    freeThrowsAttempted: stats.freeThrowsAttempted + 1,
  };
}

function nextPhaseToken(sequence: number, phase: PossessionPhase) {
  return `${phase.toLowerCase()}-${sequence}`;
}

export function commitGameEvent(
  state: MatchState,
  kind: string,
  text: string,
  patch: Partial<MatchState> = {},
): MatchState {
  if (state.phase === "FINAL" && kind !== "RESET") return state;
  const eventSequence = state.eventSequence + 1;
  const nextPhase = patch.phase ?? state.phase;
  const phaseChanged = nextPhase !== state.phase;
  const nextPossession = patch.possession ?? state.possession;
  const possessionChanged = nextPossession !== state.possession;
  const startsNewPeriodPossession = kind === "NEXT_PERIOD" || kind === "OVERTIME";
  const offensivePossessionSerial = patch.offensivePossessionSerial
    ?? state.offensivePossessionSerial + (possessionChanged || startsNewPeriodPossession ? 1 : 0);
  const hasPendingDrivePatch = Object.prototype.hasOwnProperty.call(patch, "pendingDrive");
  const pendingDrive = possessionChanged || nextPhase !== "SECOND_DECISION"
    ? undefined
    : hasPendingDrivePatch
      ? patch.pendingDrive
      : state.pendingDrive;
  // A pending pass is only valid while the world it was released into is
  // unchanged: possession, phase or ball-handler change cancels it (P3).
  const hasPendingPassPatch = Object.prototype.hasOwnProperty.call(patch, "pendingPass");
  const pendingPass = possessionChanged || phaseChanged || (patch.ballHandlerId && patch.ballHandlerId !== state.ballHandlerId)
    ? undefined
    : hasPendingPassPatch
      ? patch.pendingPass
      : state.pendingPass;
  return {
    ...state,
    ...patch,
    frontcourtEstablished: patch.frontcourtEstablished
      ?? (possessionChanged ? false : state.frontcourtEstablished),
    stealAttemptAccumulator: possessionChanged
      ? undefined
      : Object.prototype.hasOwnProperty.call(patch, "stealAttemptAccumulator")
        ? patch.stealAttemptAccumulator
        : state.stealAttemptAccumulator,
    intentionalFoulClock: possessionChanged
      ? null
      : Object.prototype.hasOwnProperty.call(patch, "intentionalFoulClock")
        ? patch.intentionalFoulClock ?? null
        : state.intentionalFoulClock,
    pendingDrive,
    pendingPass,
    version: state.version + 1,
    decisionEpoch: state.decisionEpoch + 1,
    eventSequence,
    offensivePossessionSerial,
    phaseToken: phaseChanged ? nextPhaseToken(eventSequence, nextPhase) : state.phaseToken,
    eventLog: [
      ...state.eventLog.slice(-11),
      {
        id: `event-${eventSequence}`,
        kind,
        text,
        atGameSecond: state.gameSeconds,
      },
    ],
  };
}

/**
 * Attaches a pendingPass record to a state whose motion already carries a
 * live pass flight (started by startPassFlight). The receiver is NOT yet
 * the handler: control transfers only when the engine loop completes the
 * arrival (see completePassArrival). The record captures the release-world
 * identity (possession, phase token, decision epoch) so a stale pass can
 * never fire inside a later possession or phase.
 */
export function attachPendingPass(
  state: MatchState,
  fromPlayerId: string,
  toPlayerId: string,
  continuation: PassContinuation,
  arrivalPatch?: PendingPassState["arrivalPatch"],
  arrivalText?: string,
): MatchState {
  const flight = state.motion.ballFlight;
  if (state.pendingPass || !flight || !flight.end) return state;
  if (flight.fromPlayerId !== fromPlayerId || flight.toPlayerId !== toPlayerId) return state;
  const pendingPass: PendingPassState = {
    id: `pass-${state.eventSequence + 1}-${state.seed}`,
    fromPlayerId,
    toPlayerId,
    kind: flight.kind as BallFlightKindForPass,
    catchPoint: { ...flight.end },
    possession: state.possession,
    phaseTokenAtRelease: state.phaseToken,
    decisionEpochAtRelease: state.decisionEpoch,
    frontcourtEstablishedAtRelease: state.frontcourtEstablished,
    continuation,
    arrivalPatch,
    arrivalText,
  };
  return { ...state, pendingPass };
}

/**
 * One-shot release of a pass: starts the flight toward a fixed catch point,
 * commits the PASS_RELEASE event (with the caller's release-time patch,
 * which must not change possession or the ball handler), then attaches the
 * pendingPass. Game and shot clocks keep running through the flight.
 */
export function releasePass(
  state: MatchState,
  fromPlayerId: string,
  toPlayerId: string,
  kind: BallFlightKindForPass,
  options: {
    text: string;
    seed?: number;
    catchPoint?: CourtPoint;
    continuation: PassContinuation;
    arrivalPatch?: PendingPassState["arrivalPatch"];
    arrivalText?: string;
    releasePatch?: Partial<MatchState>;
  },
): MatchState {
  if (state.pendingPass || state.motion.ballFlight) return state;
  const receiver = playerById.get(toPlayerId);
  if (!receiver || receiver.team !== state.possession || receiver.id === fromPlayerId) return state;
  const from = playerById.get(fromPlayerId);
  if (!from || from.id !== state.ballHandlerId) return state;
  const catchPoint = options.catchPoint
    ?? passCatchPoint(state.motion, fromPlayerId, toPlayerId, kind, state.frontcourtEstablished, state.possession)
    ?? state.motion.positions[toPlayerId];
  if (!catchPoint) return state;
  let motion = startPassFlight(state.motion, fromPlayerId, toPlayerId, kind, catchPoint);
  if (!motion.ballFlight) return state;
  const flightDuration = motion.ballFlight.duration;
  // The receiver runs onto the fixed catch point (the ball never homes).
  motion = routePlayerTo(motion, toPlayerId, catchPoint, "RECEIVE");
  // In transition, guarantee the fastbreak clock cannot expire while the
  // pass is still airborne (the catch ends the fastbreak).
  const fastbreakClock = state.phase === "FASTBREAK" && state.fastbreakClock !== null
    ? Math.max(state.fastbreakClock, flightDuration + 0.25)
    : undefined;
  const committed = commitGameEvent(state, "PASS_RELEASE", options.text, {
    ...options.releasePatch,
    ...(fastbreakClock !== undefined ? { fastbreakClock } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    motion,
  });
  return attachPendingPass(
    committed,
    fromPlayerId,
    toPlayerId,
    options.continuation,
    options.arrivalPatch,
    options.arrivalText,
  );
}

/**
 * Completes a pending pass when its flight reaches the catch point.
 *
 * Validation: the world must be the same one the pass was released into
 * (same possession and phase token — a possession change, phase change,
 * period end or restart change in between cancels the pass as stale).
 * Emits exactly one Chinese catch event, assigns the receiver as ball
 * handler only here, clears the pending pass, and applies the deferred
 * arrival patch (phase / advantage / screen / clock semantics).
 */
export function completePassArrival(state: MatchState): MatchState {
  const pass = state.pendingPass;
  if (!pass || state.motion.ballFlight) return state;
  if (state.possession !== pass.possession || state.phaseToken !== pass.phaseTokenAtRelease) {
    // Stale: a possession or phase change invalidated the pass mid-flight.
    return { ...state, pendingPass: undefined };
  }
  const receiver = playerById.get(pass.toPlayerId);
  if (!receiver || receiver.team !== state.possession) {
    // Invalid catch target: never silently assign control. Cancel the pass.
    return { ...state, pendingPass: undefined };
  }
  const arrived = commitGameEvent(state, "PASS_ARRIVAL", pass.arrivalText ?? `${receiver.number}号接球`, {
    ...pass.arrivalPatch,
    seed: state.seed,
    ballHandlerId: receiver.id,
    pendingPass: undefined,
  });
  // AI stage passes briefly route the receiver only to the fixed catch
  // point. Once possession transfers, restore the current stage's remaining
  // five-player routes so the action does not stall at the catch location.
  return pass.continuation === "AI_STAGE" ? applyOpponentStageMotion(arrived) : arrived;
}

export interface BeginFreeThrowInput {
  shooterId: string;
  total: 1 | 2 | 3;
  reason: "SHOOTING_FOUL" | "BONUS" | "DEFENSIVE_THREE_SECONDS";
  foulerId?: string;
  retainPossession?: boolean;
  liveAfterFinalMiss?: boolean;
  resumeShotClock?: number;
  seed?: number;
}

export function beginFreeThrowSequence(state: MatchState, input: BeginFreeThrowInput): MatchState {
  const shooter = playerById.get(input.shooterId);
  if (!shooter || input.total < 1 || input.total > 3) return state;
  const retainPossession = Boolean(input.retainPossession);
  const sequence = {
    id: `free-throws-${state.eventSequence + 1}-${input.seed ?? state.seed}`,
    shooterId: shooter.id,
    shootingTeam: shooter.team,
    foulerId: input.foulerId,
    reason: input.reason,
    total: input.total,
    attempted: 0,
    made: 0,
    results: [],
    stage: "SETUP" as const,
    retainPossession,
    liveAfterFinalMiss: input.liveAfterFinalMiss ?? !retainPossession,
    resumeShotClock: input.resumeShotClock ?? state.shotClock,
    laneOccupied: !retainPossession,
    seed: input.seed ?? state.seed,
  };
  const started = commitGameEvent(state, "FREE_THROW_SETUP", `${playerById.get(shooter.id)?.number ?? ""}号执行${input.total}次自动罚球 · 球员正在落位`, {
    seed: sequence.seed,
    possession: shooter.team,
    ballHandlerId: shooter.id,
    potentialAssistPlayerId: undefined,
    potentialAssistReceiverId: undefined,
    phase: "FREE_THROW",
    transitionClock: 1.25,
    inboundClock: null,
    backcourtClock: null,
    frontcourtEstablished: true,
    fastbreakClock: null,
    aiDecisionClock: null,
    intentionalFoulClock: null,
    opponentOffense: undefined,
    pendingDefenseResponse: undefined,
    lastDefenseResponse: undefined,
    screen: undefined,
    activeTactic: undefined,
    homeTacticExecution: undefined,
    advantage: undefined,
    pendingShot: undefined,
    pendingRebound: undefined,
    threeSecondClocks: Object.fromEntries(players.map((player) => [player.id, 0])),
    freeThrowSequence: sequence,
    secondChanceCount: 0,
    stealAttemptAccumulator: undefined,
    motion: cancelCourtRoutes(state.motion),
  });
  return applyFreeThrowFormation(started, shooter.id, sequence.laneOccupied);
}

export interface PersonalFoulInput {
  offenderId: string;
  offendedPlayerId: string;
  kind: CommonFoulKind;
  shotMade?: boolean;
  shotPoints?: 2 | 3;
  resumeShotClock?: number;
  seed?: number;
  source?: PersonalFoulSource;
  callText?: string;
}

function naturalFoulHistory(state: MatchState) {
  return {
    currentPossession: state.offensivePossessionSerial,
    foulPossessions: state.naturalFoulPossessions,
    threePointFoulPossessions: state.naturalThreePointFoulPossessions,
  };
}

export function canCallNaturalFoul(state: MatchState, threePointAttempt = false) {
  return isNaturalFoulAllowed(naturalFoulHistory(state), threePointAttempt);
}

function recordNaturalFoul(state: MatchState, threePointAttempt: boolean): MatchState {
  const possession = state.offensivePossessionSerial;
  return {
    ...state,
    naturalFoulPossessions: [...state.naturalFoulPossessions, possession],
    naturalThreePointFoulPossessions: threePointAttempt
      ? [...state.naturalThreePointFoulPossessions, possession]
      : state.naturalThreePointFoulPossessions,
  };
}

function registerPersonalFoul(state: MatchState, input: PersonalFoulInput, countsTeamFoul: boolean) {
  const offender = playerById.get(input.offenderId);
  const offended = playerById.get(input.offendedPlayerId);
  if (!offender || !offended || offender.team === offended.team) return state;
  const nextLedger = applyPlayerStatsEvent(state.playerBoxScores, { type: "PERSONAL_FOUL", playerId: offender.id });
  const personalFouls = nextLedger.byPlayerId[offender.id].personalFouls;
  const inLastTwoMinutes = state.gameSeconds <= 120;
  const teamFouls = countsTeamFoul
    ? { ...state.teamFouls, [offender.team]: state.teamFouls[offender.team] + 1 }
    : state.teamFouls;
  const latePeriodTeamFouls = countsTeamFoul && inLastTwoMinutes
    ? { ...state.latePeriodTeamFouls, [offender.team]: state.latePeriodTeamFouls[offender.team] + 1 }
    : state.latePeriodTeamFouls;
  const legacyPatch = offender.team === "away"
    ? { opponentStats: { ...state.opponentStats, personalFouls: state.opponentStats.personalFouls + 1 } }
    : offender.id === state.controlledPlayerId
      ? { playerStats: { ...state.playerStats, personalFouls: state.playerStats.personalFouls + 1 } }
      : {};
  return {
    ...state,
    ...legacyPatch,
    playerBoxScores: nextLedger,
    teamFouls,
    latePeriodTeamFouls,
    disqualifiedPlayerIds: personalFouls >= 6 && !state.disqualifiedPlayerIds.includes(offender.id)
      ? [...state.disqualifiedPlayerIds, offender.id]
      : state.disqualifiedPlayerIds,
  };
}

export function callPersonalFoul(state: MatchState, input: PersonalFoulInput): MatchState {
  const offender = playerById.get(input.offenderId);
  const offended = playerById.get(input.offendedPlayerId);
  if (!offender || !offended || offender.team === offended.team || state.phase === "FINAL") return state;
  const natural = input.source === "NATURAL";
  const threePointAttempt = input.kind === "SHOOTING" && input.shotPoints === 3;
  if (natural && !canCallNaturalFoul(state, threePointAttempt)) return state;
  const eligibleState = natural ? recordNaturalFoul(state, threePointAttempt) : state;
  const inPenalty = isPenaltyAfterCommonFoul({
    overtime: eligibleState.overtime > 0,
    foulsBefore: eligibleState.teamFouls[offender.team],
    inLastTwoMinutes: eligibleState.gameSeconds <= 120,
    lateFoulsBefore: eligibleState.latePeriodTeamFouls[offender.team],
  });
  const penalty = resolveFoulPenalty({
    kind: input.kind,
    shotMade: input.shotMade,
    shotPoints: input.shotPoints,
    inPenalty,
  });
  const registered = registerPersonalFoul(eligibleState, input, penalty.countsTeamFoul);
  const callKind: OfficialCallKind = input.kind === "SHOOTING"
    ? "SHOOTING_FOUL"
    : input.kind === "OFFENSIVE_CHARGE"
      ? "OFFENSIVE_CHARGE"
      : input.kind === "ILLEGAL_SCREEN"
        ? "ILLEGAL_SCREEN"
        : input.kind === "LOOSE_BALL"
          ? "LOOSE_BALL_FOUL"
          : "COMMON_FOUL";
  const lastOfficialCall = {
    id: `call-${registered.eventSequence + 1}`,
    kind: callKind,
    offendingTeam: offender.team,
    offenderId: offender.id,
    offendedPlayerId: offended.id,
    text: input.callText ?? `${offender.number}号${input.kind === "SHOOTING" ? "投篮犯规" : input.kind === "OFFENSIVE_CHARGE" ? "进攻撞人" : input.kind === "ILLEGAL_SCREEN" ? "非法掩护" : input.kind === "LOOSE_BALL" ? "争抢犯规" : "防守犯规"}`,
    atGameSecond: state.gameSeconds,
  } satisfies NonNullable<MatchState["lastOfficialCall"]>;

  if (penalty.freeThrows > 0) {
    return beginFreeThrowSequence({ ...registered, lastOfficialCall }, {
      shooterId: offended.id,
      total: penalty.freeThrows as 1 | 2 | 3,
      reason: input.kind === "SHOOTING" ? "SHOOTING_FOUL" : "BONUS",
      foulerId: offender.id,
      liveAfterFinalMiss: penalty.liveAfterFinalMiss,
      resumeShotClock: input.resumeShotClock ?? state.shotClock,
      seed: input.seed ?? state.seed,
    });
  }

  if (penalty.changePossession) {
    const ledger = applyPlayerStatsEvent(registered.playerBoxScores, { type: "TURNOVER", playerId: offender.id });
    const legacy = offender.team === "home" && offender.id === state.controlledPlayerId
      ? { playerStats: withTurnover(registered.playerStats) }
      : offender.team === "away"
        ? { opponentStats: withTurnover(registered.opponentStats) }
        : {};
    return beginDeadBall({ ...registered, ...legacy, playerBoxScores: ledger, lastOfficialCall }, "OFFENSIVE_FOUL", {
      team: offended.team,
      spot: "SIDELINE_BACKCOURT",
      reason: "OFFENSIVE_FOUL",
      shotClock: state.rules.fullShotClockSeconds,
      requiresAdvance: true,
      retainsPossession: false,
      gameClockContinues: false,
    }, `${lastOfficialCall.text} · 对方后场边线发球`);
  }

  return beginDeadBall({ ...registered, lastOfficialCall }, "PERSONAL_FOUL", {
    team: offended.team,
    spot: "SIDELINE_FRONTCOURT",
    reason: "PERSONAL_FOUL",
    shotClock: Math.max(state.shotClock, state.rules.offensiveReboundSeconds),
    requiresAdvance: false,
    retainsPossession: true,
    gameClockContinues: false,
  }, `${lastOfficialCall.text} · 未到处罚，前场边线发球`);
}

export function isLivePhase(phase: PossessionPhase) {
  return (
    phase === "SET_OFFENSE" ||
    phase === "SCREEN_APPROACH" ||
    phase === "SECOND_DECISION" ||
    phase === "SHOT_FLIGHT" ||
    phase === "REBOUND" ||
    phase === "FASTBREAK" ||
    phase === "BACKCOURT_ADVANCE"
  );
}

export function canAcceptGameAction(state: MatchState) {
  return (
    state.gameSeconds > 0 &&
    !state.motion.ballFlight &&
    !state.pendingPass &&
    (state.phase === "SET_OFFENSE" ||
      state.phase === "SECOND_DECISION" ||
      state.phase === "FASTBREAK")
  );
}

export function inboundPoint(restart: RestartPlan): CourtPoint {
  const fromRight = restart.team === "home";
  if (restart.spot === "BASELINE") return { x: fromRight ? 94 : 6, y: 50 };
  if (restart.spot === "MIDCOURT") return { x: 50, y: 8 };
  if (restart.spot === "SIDELINE_BACKCOURT") return { x: fromRight ? 78 : 22, y: 8 };
  return { x: fromRight ? 38 : 62, y: 8 };
}

export function hasFrontcourtControl(state: MatchState) {
  const point = state.motion.positions[state.ballHandlerId];
  if (!point) return false;
  return state.possession === "home" ? point.x <= 50 : point.x >= 50;
}

function hasLiveTeamControl(state: MatchState) {
  return state.phase === "SET_OFFENSE"
    || state.phase === "SCREEN_APPROACH"
    || state.phase === "SECOND_DECISION"
    || state.phase === "FASTBREAK"
    || state.phase === "BACKCOURT_ADVANCE";
}

export function hasOverAndBackViolation(state: MatchState) {
  return state.frontcourtEstablished
    && hasLiveTeamControl(state)
    && !state.motion.ballFlight
    && !hasFrontcourtControl(state);
}

export function canAiCommitLateIntentionalFoul(state: MatchState) {
  const margin = state.homeScore - state.awayScore;
  return (state.period === 4 || state.overtime > 0)
    && state.gameSeconds > 0
    && state.gameSeconds <= 35
    && margin >= 1
    && margin <= 8
    && state.possession === "home"
    && hasLiveTeamControl(state)
    && !state.motion.ballFlight
    && !state.pendingShot
    && !state.pendingRebound
    && !state.freeThrowSequence;
}

export function lateIntentionalFoulDelay(state: MatchState) {
  const slot = (state.offensivePossessionSerial * 3 + state.teamFouls.away * 2) % 5;
  return 0.65 + slot * 0.1;
}

function callAiLateIntentionalFoul(state: MatchState) {
  const directDefenderId = state.currentMatchups[state.ballHandlerId];
  const handlerPoint = state.motion.positions[state.ballHandlerId];
  const offender = playerById.get(directDefenderId)
    ?? players
      .filter((player) => player.team === "away")
      .sort((first, second) => {
        if (!handlerPoint) return first.position.localeCompare(second.position);
        return courtDistanceMeters(state.motion.positions[first.id], handlerPoint)
          - courtDistanceMeters(state.motion.positions[second.id], handlerPoint);
      })[0];
  if (!offender) return { ...state, intentionalFoulClock: null };
  return callPersonalFoul({ ...state, intentionalFoulClock: null }, {
    offenderId: offender.id,
    offendedPlayerId: state.ballHandlerId,
    kind: "NON_SHOOTING",
    seed: state.seed,
    source: "FORCED",
    callText: `${offender.number}号末节主动犯规 · 阻止继续消耗时间`,
  });
}

export function shouldStopAfterMadeBasket(state: MatchState) {
  if (state.overtime > 0 || state.period === 4) return state.gameSeconds <= 120;
  return state.gameSeconds <= 60;
}

function restartText(spot: InboundSpot) {
  if (spot === "BASELINE") return "底线发球";
  if (spot === "MIDCOURT") return "中线发球";
  if (spot === "SIDELINE_FRONTCOURT") return "前场边线发球";
  return "后场边线发球";
}

export function beginDeadBall(
  state: MatchState,
  reason: DeadBallReason,
  restart: RestartPlan,
  text: string,
  patch: Partial<MatchState> = {},
): MatchState {
  return commitGameEvent(state, reason, text, {
    ...patch,
    possession: restart.team,
    ballHandlerId: defaultHandler(restart.team),
    potentialAssistPlayerId: undefined,
    potentialAssistReceiverId: undefined,
    phase: "DEAD_BALL",
    deadBallReason: reason,
    restart,
    shotClock: restart.shotClock,
    inboundClock: null,
    backcourtClock: null,
    frontcourtEstablished: false,
    fastbreakClock: null,
    transitionClock: 0.65,
    aiDecisionClock: null,
    intentionalFoulClock: null,
    opponentOffense: undefined,
    pendingDefenseResponse: undefined,
    lastDefenseResponse: undefined,
    screen: undefined,
    activeTactic: undefined,
    homeTacticExecution: undefined,
    advantage: undefined,
    pendingShot: undefined,
    pendingRebound: undefined,
    freeThrowSequence: undefined,
    threeSecondClocks: Object.fromEntries(players.map((player) => [player.id, 0])),
    secondChanceCount: 0,
    stealAttemptAccumulator: undefined,
    defenseScheme: "MAN",
    currentMatchups: { ...baseMatchups },
    motion: cancelCourtRoutes(state.motion),
  });
}

export function startFastbreak(
  state: MatchState,
  team: TeamSide,
  kind: string,
  text: string,
  patch: Partial<MatchState> = {},
) {
  const handlerId = patch.ballHandlerId ?? defaultHandler(team);
  const motion = patch.motion ?? cancelCourtRoutes(state.motion);
  const handlerPoint = motion.positions[handlerId];
  const startsInFrontcourt = handlerPoint ? (team === "home" ? handlerPoint.x <= 50 : handlerPoint.x >= 50) : false;
  return commitGameEvent(state, kind, text, {
    ...patch,
    possession: team,
    ballHandlerId: handlerId,
    potentialAssistPlayerId: undefined,
    potentialAssistReceiverId: undefined,
    phase: "FASTBREAK",
    deadBallReason: undefined,
    restart: undefined,
    shotClock: state.rules.fullShotClockSeconds,
    inboundClock: null,
    backcourtClock: startsInFrontcourt ? null : state.rules.backcourtSeconds,
    frontcourtEstablished: startsInFrontcourt,
    fastbreakClock: state.rules.fastbreakSeconds,
    transitionClock: null,
    aiDecisionClock: null,
    intentionalFoulClock: null,
    opponentOffense: undefined,
    pendingDefenseResponse: undefined,
    lastDefenseResponse: undefined,
    screen: undefined,
    activeTactic: undefined,
    homeTacticExecution: undefined,
    advantage: undefined,
    pendingShot: undefined,
    pendingRebound: undefined,
    secondChanceCount: 0,
    stealAttemptAccumulator: undefined,
    defenseScheme: "MAN",
    currentMatchups: { ...baseMatchups },
    motion,
  });
}

export function declareOutOfBounds(state: MatchState, call: OutOfBoundsCall): MatchState {
  if (!isLivePhase(state.phase)) return state;
  const offense = state.possession;
  const retainsPossession = call.lastTouchedBy !== offense;
  const nextTeam = retainsPossession ? offense : opposite(offense);
  const requiresAdvance = retainsPossession ? call.zone === "BACKCOURT" : call.zone === "FRONTCOURT";
  const spot: InboundSpot =
    call.spot === "BASELINE"
      ? "BASELINE"
      : requiresAdvance
        ? "SIDELINE_BACKCOURT"
        : "SIDELINE_FRONTCOURT";
  const shotClock = retainsPossession
    ? call.rimContacted
      ? Math.max(state.shotClock, state.rules.offensiveReboundSeconds)
      : state.shotClock
    : state.rules.fullShotClockSeconds;
  const restart: RestartPlan = {
    team: nextTeam,
    spot,
    reason: "OUT_OF_BOUNDS",
    shotClock,
    requiresAdvance,
    retainsPossession,
    gameClockContinues: false,
    backcourtClock: retainsPossession && requiresAdvance ? state.backcourtClock ?? state.rules.backcourtSeconds : undefined,
  };
  const patch: Partial<MatchState> = !retainsPossession
    ? offense === "home"
      ? state.ballHandlerId === state.controlledPlayerId
        ? {
            playerStats: withTurnover(state.playerStats),
            playerBoxScores: applyPlayerStatsEvent(state.playerBoxScores, { type: "TURNOVER", playerId: state.ballHandlerId }),
          }
        : {
            playerBoxScores: applyPlayerStatsEvent(state.playerBoxScores, { type: "TURNOVER", playerId: state.ballHandlerId }),
          }
      : {
          opponentStats: withTurnover(state.opponentStats),
          playerBoxScores: applyPlayerStatsEvent(state.playerBoxScores, { type: "TURNOVER", playerId: state.ballHandlerId }),
        }
    : {};
  const possessionText = retainsPossession ? "防守碰出，进攻方保留球权" : "进攻方最后触球，球权转换";
  return beginDeadBall(state, "OUT_OF_BOUNDS", restart, `${possessionText} · ${restartText(spot)}`, patch);
}

function violationRestart(state: MatchState, reason: DeadBallReason, text: string, turnoverPlayerId = state.ballHandlerId) {
  const offendingTeam = state.possession;
  const team = opposite(offendingTeam);
  const turnoverLedger = applyPlayerStatsEvent(state.playerBoxScores, { type: "TURNOVER", playerId: turnoverPlayerId });
  const patch: Partial<MatchState> =
    offendingTeam === "home"
      ? turnoverPlayerId === state.controlledPlayerId
        ? { playerStats: withTurnover(state.playerStats), playerBoxScores: turnoverLedger }
        : { playerBoxScores: turnoverLedger }
      : { opponentStats: withTurnover(state.opponentStats), playerBoxScores: turnoverLedger };
  return beginDeadBall(
    state,
    reason,
    {
      team,
      spot: reason === "BACKCOURT_VIOLATION" || reason === "OVER_AND_BACK_VIOLATION" ? "MIDCOURT" : "SIDELINE_BACKCOURT",
      reason,
      shotClock: state.rules.fullShotClockSeconds,
      requiresAdvance: reason !== "BACKCOURT_VIOLATION" && reason !== "OVER_AND_BACK_VIOLATION",
      retainsPossession: false,
      gameClockContinues: false,
    },
    text,
    patch,
  );
}

function finishPeriodOrGame(state: MatchState): MatchState {
  const regulationFinished = state.period === 4;
  const tied = state.homeScore === state.awayScore;
  if ((regulationFinished || state.overtime > 0) && !tied) {
    const winner: TeamSide = state.homeScore > state.awayScore ? "home" : "away";
    const eventSequence = state.eventSequence + 1;
    return commitGameEvent(state, "FINAL", "比赛结束 · 最终比分已锁定", {
      phase: "FINAL",
      gameSeconds: 0,
      shotClock: 0,
      inboundClock: null,
      backcourtClock: null,
      frontcourtEstablished: false,
      fastbreakClock: null,
      transitionClock: null,
      aiDecisionClock: null,
      intentionalFoulClock: null,
      opponentOffense: undefined,
      pendingDefenseResponse: undefined,
      lastDefenseResponse: undefined,
      restart: undefined,
      deadBallReason: undefined,
      screen: undefined,
      activeTactic: undefined,
      homeTacticExecution: undefined,
      advantage: undefined,
      pendingShot: undefined,
      pendingRebound: undefined,
      freeThrowSequence: undefined,
      threeSecondClocks: Object.fromEntries(players.map((player) => [player.id, 0])),
      secondChanceCount: 0,
      stealAttemptAccumulator: undefined,
      defenseScheme: "MAN",
      currentMatchups: { ...baseMatchups },
      motion: cancelCourtRoutes(state.motion),
      gameResult: {
        id: `result-${eventSequence}`,
        winner,
        homeScore: state.homeScore,
        awayScore: state.awayScore,
        overtimeCount: state.overtime,
      },
    });
  }
  return commitGameEvent(
    state,
    "PERIOD_END",
    tied && regulationFinished
      ? state.overtime > 0
        ? `加时${state.overtime}结束 · 比分持平，继续加时`
        : "第四节结束 · 比分持平，准备加时"
      : `第${state.period}节结束`,
    {
      phase: "PERIOD_END",
      gameSeconds: 0,
      shotClock: 0,
      inboundClock: null,
      backcourtClock: null,
      frontcourtEstablished: false,
      fastbreakClock: null,
      transitionClock: 1,
      aiDecisionClock: null,
      intentionalFoulClock: null,
      opponentOffense: undefined,
      pendingDefenseResponse: undefined,
      lastDefenseResponse: undefined,
      restart: undefined,
      deadBallReason: undefined,
      screen: undefined,
      activeTactic: undefined,
      homeTacticExecution: undefined,
      advantage: undefined,
      pendingShot: undefined,
      pendingRebound: undefined,
      freeThrowSequence: undefined,
      threeSecondClocks: Object.fromEntries(players.map((player) => [player.id, 0])),
      secondChanceCount: 0,
      stealAttemptAccumulator: undefined,
      motion: cancelCourtRoutes(state.motion),
    },
  );
}

function startNextPeriod(state: MatchState) {
  if (state.phase !== "PERIOD_END") return state;
  const nextPeriod = state.period < 4 ? ((state.period + 1) as MatchState["period"]) : state.period;
  const overtime = state.period === 4 ? state.overtime + 1 : 0;
  const duration = overtime > 0 ? state.rules.overtimePeriodSeconds : state.rules.regulationPeriodSeconds;
  if (overtime > 0) {
    const roll = nextRandom(state.seed);
    const possession: TeamSide = roll.value < 0.5 ? "home" : "away";
    return commitGameEvent(state, "OVERTIME", `进入加时${overtime} · 中圈跳球`, {
      seed: roll.seed,
      period: nextPeriod,
      overtime,
      possession,
      ballHandlerId: defaultHandler(possession),
      gameSeconds: duration,
      shotClock: state.rules.fullShotClockSeconds,
      phase: "TIP_OFF",
      transitionClock: 0.9,
      aiDecisionClock: null,
      intentionalFoulClock: null,
      opponentOffense: undefined,
      pendingDefenseResponse: undefined,
      lastDefenseResponse: undefined,
      pendingShot: undefined,
      pendingRebound: undefined,
      freeThrowSequence: undefined,
      frontcourtEstablished: false,
      stealAttemptAccumulator: undefined,
      teamFouls: { home: 0, away: 0 },
      latePeriodTeamFouls: { home: 0, away: 0 },
      threeSecondClocks: Object.fromEntries(players.map((player) => [player.id, 0])),
      secondChanceCount: 0,
      gameResult: undefined,
      defenseScheme: "MAN",
      currentMatchups: { ...baseMatchups },
      motion: cancelCourtRoutes(state.motion),
    });
  }

  const possession = nextPeriod === 4 ? state.openingTipWinner : opposite(state.openingTipWinner);
  const restart: RestartPlan = {
    team: possession,
    spot: "BASELINE",
    reason: "PERIOD_START",
    shotClock: state.rules.fullShotClockSeconds,
    requiresAdvance: true,
    retainsPossession: false,
    gameClockContinues: false,
  };
  return commitGameEvent(state, "NEXT_PERIOD", `第${nextPeriod}节 · ${possession === "home" ? "主队" : "客队"}底线发球`, {
    period: nextPeriod,
    overtime,
    possession,
    ballHandlerId: defaultHandler(possession),
    gameSeconds: duration,
    shotClock: state.rules.fullShotClockSeconds,
    phase: "INBOUND_READY",
    inboundClock: state.rules.inboundSeconds,
    transitionClock: 0.75,
    aiDecisionClock: null,
    intentionalFoulClock: null,
    opponentOffense: undefined,
    pendingDefenseResponse: undefined,
    lastDefenseResponse: undefined,
    pendingShot: undefined,
    pendingRebound: undefined,
    freeThrowSequence: undefined,
    frontcourtEstablished: false,
    stealAttemptAccumulator: undefined,
    teamFouls: { home: 0, away: 0 },
    latePeriodTeamFouls: { home: 0, away: 0 },
    threeSecondClocks: Object.fromEntries(players.map((player) => [player.id, 0])),
    secondChanceCount: 0,
    restart,
    gameResult: undefined,
    defenseScheme: "MAN",
    currentMatchups: { ...baseMatchups },
    motion: cancelCourtRoutes(state.motion),
  });
}

export function advanceAutomaticPhase(state: MatchState, expectedToken = state.phaseToken): MatchState {
  if (expectedToken !== state.phaseToken || state.phase === "FINAL") return state;
  if (state.phase === "FREE_THROW") return releaseFreeThrow(state);
  if (state.phase === "DEAD_BALL") {
    if (!state.restart) return state;
    return commitGameEvent(state, "INBOUND_READY", `${restartText(state.restart.spot)} · 裁判交球`, {
      phase: "INBOUND_READY",
      inboundClock: state.rules.inboundSeconds,
      transitionClock: 0.75,
    });
  }
  if (state.phase === "INBOUND_READY") return completeInbound(state, expectedToken);
  if (state.phase === "BACKCOURT_ADVANCE") return completeBackcourtAdvance(state, expectedToken);
  if (state.phase === "SCREEN_APPROACH" && state.screen) {
    const screen = state.screen;
    return commitGameEvent(state, "SCREEN_SET", screen.explanation, {
      phase: "SECOND_DECISION",
      transitionClock: null,
      advantage: screen.result === "MISMATCH_CREATED" ? "MISMATCH" : undefined,
      currentMatchups: applySwitchMatchups(state, screen),
    });
  }
  if (state.phase === "PERIOD_END") return startNextPeriod(state);
  if (state.phase === "TIP_OFF") {
    return commitGameEvent(state, "TIP_WON", `${state.possession === "home" ? "主队" : "客队"}赢得跳球 · 比赛继续`, {
      phase: "SET_OFFENSE",
      transitionClock: null,
      shotClock: state.rules.fullShotClockSeconds,
      frontcourtEstablished: hasFrontcourtControl(state),
    });
  }
  return state;
}

export function completeInbound(state: MatchState, expectedToken = state.phaseToken): MatchState {
  if (state.phase !== "INBOUND_READY" || state.phaseToken !== expectedToken || !state.restart) return state;
  const requiresAdvance = state.restart.requiresAdvance;
  const motion = startBallFlight(state.motion, undefined, state.ballHandlerId, "INBOUND", inboundPoint(state.restart));
  return commitGameEvent(
    state,
    "INBOUND_COMPLETE",
    requiresAdvance ? "发球合法触球 · 正在推进前场" : "发球合法触球 · 前场继续进攻",
    {
      phase: requiresAdvance ? "BACKCOURT_ADVANCE" : "SET_OFFENSE",
      inboundClock: null,
      backcourtClock: requiresAdvance ? state.restart.backcourtClock ?? state.rules.backcourtSeconds : null,
      frontcourtEstablished: !requiresAdvance,
      transitionClock: null,
      deadBallReason: undefined,
      restart: requiresAdvance ? state.restart : undefined,
      motion,
    },
  );
}

export function completeBackcourtAdvance(state: MatchState, expectedToken = state.phaseToken): MatchState {
  if (state.phase !== "BACKCOURT_ADVANCE" || state.phaseToken !== expectedToken || !hasFrontcourtControl(state)) return state;
  return commitGameEvent(state, "FRONTCOURT", "越过中线 · 转入前场阵地进攻", {
    phase: "SET_OFFENSE",
    backcourtClock: null,
    frontcourtEstablished: true,
    transitionClock: null,
    restart: undefined,
  });
}

export interface ResolvedShotInput {
  attackingTeam: TeamSide;
  shooterId: string;
  points: 2 | 3;
  made: boolean;
  blocked?: boolean;
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
}

function shotFlightProfile(shotType: ShotFlightType, distanceMeters: number) {
  const quantize = (seconds: number) => Math.round(seconds / 0.05) * 0.05;
  if (shotType === "DUNK") return { duration: 0.35, startHeightMeters: 2.55, apexHeightMeters: 3.35 };
  if (shotType === "ALLEY_OOP") return { duration: 0.45, startHeightMeters: 2.35, apexHeightMeters: 3.65 };
  if (shotType === "RIM") return { duration: quantize(Math.min(0.72, 0.44 + distanceMeters * 0.035)), startHeightMeters: 2.1, apexHeightMeters: 3.82 };
  if (shotType === "MID_RANGE") return { duration: quantize(Math.min(0.94, 0.63 + distanceMeters * 0.032)), startHeightMeters: 2.08, apexHeightMeters: 4.2 };
  return { duration: quantize(Math.min(1.08, 0.72 + distanceMeters * 0.03)), startHeightMeters: 2.08, apexHeightMeters: 4.55 };
}

export function startResolvedShot(state: MatchState, input: ResolvedShotInput): MatchState {
  const shooter = playerById.get(input.shooterId);
  const origin = state.motion.positions[input.shooterId];
  if (!shooter || !origin || shooter.team !== input.attackingTeam || state.motion.ballFlight) return state;
  const rim = attackRim(input.attackingTeam);
  const awardedBasket = input.made || Boolean(input.goaltended);
  let plannedRebound = awardedBasket || input.offensiveInterference
    ? undefined
    : resolveMissedShotRebound({
        state,
        roster: players,
        shooterId: input.shooterId,
        shotOrigin: origin,
        rim,
        seed: input.seed,
      });
  let offensiveInterference = Boolean(input.offensiveInterference);
  let interfererId = input.interfererId;
  let adjudicationSeed = plannedRebound?.seed ?? input.seed;
  if (!input.blocked && !offensiveInterference && plannedRebound?.offensive && plannedRebound.rimContacted) {
    const rebounder = playerById.get(plannedRebound.winnerId);
    const touchNearCylinder = courtDistanceMeters(plannedRebound.landingPoint, rim) <= 1.25;
    if (rebounder && touchNearCylinder) {
      const earlyTouchRoll = nextRandom(plannedRebound.seed);
      const earlyTouchChance = Math.max(0.004, Math.min(0.035, 0.016 + (72 - rebounder.ratings.basketballIQ) / 600));
      const review = evaluateBasketInterference({
        shootingTeam: input.attackingTeam,
        touchingTeam: rebounder.team,
        descending: false,
        aboveRing: true,
        withinCylinder: true,
        touchedBackboard: false,
        hasChanceToScore: true,
      });
      if (earlyTouchRoll.value < earlyTouchChance && review === "OFFENSIVE_INTERFERENCE") {
        offensiveInterference = true;
        interfererId = rebounder.id;
        adjudicationSeed = earlyTouchRoll.seed;
        plannedRebound = undefined;
      }
    }
  }
  if (plannedRebound && input.blocked) {
    plannedRebound = { ...plannedRebound, collision: "AIRBALL", rimContacted: false };
  }
  const end = plannedRebound?.collision === "AIRBALL"
    ? plannedRebound.landingPoint
    : input.blocked && !input.goaltended
      ? { x: origin.x + (rim.x - origin.x) * 0.58, y: origin.y + (rim.y - origin.y) * 0.58 }
      : rim;
  const distanceMeters = courtDistanceMeters(origin, end);
  const profile = shotFlightProfile(input.shotType, distanceMeters);
  const pendingShot: PendingShotState = {
    id: `shot-${state.eventSequence + 1}-${input.seed}`,
    attackingTeam: input.attackingTeam,
    shooterId: input.shooterId,
    points: input.points,
    made: input.made,
    blocked: Boolean(input.blocked),
    blockerId: input.blockerId,
    goaltended: input.goaltended,
    goaltenderId: input.goaltenderId,
    shootingFoul: input.shootingFoul,
    foulerId: input.foulerId,
    foulSource: input.foulSource,
    assistPlayerId: input.assistPlayerId,
    offensiveInterference,
    interfererId,
    shotType: input.shotType,
    explanation: input.explanation,
    seed: adjudicationSeed,
    releaseShotClock: state.shotClock,
    plannedRebound,
  };
  const motion = startFreeBallFlight(state.motion, origin, end, "SHOT", {
    ...profile,
    endHeightMeters: plannedRebound?.collision === "AIRBALL" ? 1.2 : input.blocked && !input.goaltended ? 2.45 : 3.05,
    lateralCurve: plannedRebound?.collision === "SIDE_RIM" ? 1.1 : 0,
    fromPlayerId: input.shooterId,
  });
  return commitGameEvent(state, "SHOT_RELEASE", `${input.explanation} · 篮球已离手`, {
    seed: pendingShot.seed,
    phase: "SHOT_FLIGHT",
    transitionClock: null,
    fastbreakClock: null,
    backcourtClock: null,
    aiDecisionClock: null,
    intentionalFoulClock: null,
    opponentOffense: undefined,
    pendingDefenseResponse: undefined,
    lastDefenseResponse: undefined,
    pendingShot,
    pendingRebound: undefined,
    potentialAssistPlayerId: undefined,
    potentialAssistReceiverId: undefined,
    motion,
  });
}

export interface BasketInterferenceReviewInput {
  touchingPlayerId: string;
  descending: boolean;
  aboveRing: boolean;
  withinCylinder: boolean;
  touchedBackboard: boolean;
  hasChanceToScore: boolean;
  ballOnRing?: boolean;
  handThroughRing?: boolean;
}

/**
 * Reviews an actual touch during the active shot flight. A legal touch leaves
 * the state untouched; an illegal touch immediately completes the same shot so
 * score, possession and the ten-player ledger cannot be settled twice.
 */
export function callBasketInterference(state: MatchState, input: BasketInterferenceReviewInput): MatchState {
  const shot = state.pendingShot;
  const touchingPlayer = playerById.get(input.touchingPlayerId);
  if (state.phase !== "SHOT_FLIGHT" || !shot || !touchingPlayer) return state;
  const call = evaluateBasketInterference({
    shootingTeam: shot.attackingTeam,
    touchingTeam: touchingPlayer.team,
    descending: input.descending,
    aboveRing: input.aboveRing,
    withinCylinder: input.withinCylinder,
    touchedBackboard: input.touchedBackboard,
    hasChanceToScore: input.hasChanceToScore,
    ballOnRing: input.ballOnRing,
    handThroughRing: input.handThroughRing,
  });
  if (call === "LEGAL") return state;
  const pendingShot: PendingShotState = call === "DEFENSIVE_GOALTENDING"
    ? { ...shot, goaltended: true, goaltenderId: touchingPlayer.id, plannedRebound: undefined }
    : { ...shot, made: false, offensiveInterference: true, interfererId: touchingPlayer.id, plannedRebound: undefined };
  return finishShotFlight({
    ...state,
    pendingShot,
    motion: { ...state.motion, ballFlight: undefined },
  });
}

function shotStatPatch(state: MatchState, shot: PendingShotState): Partial<MatchState> {
  const made = !shot.offensiveInterference && (shot.made || Boolean(shot.goaltended));
  const playerBoxScores = applyPlayerStatsEvent(state.playerBoxScores, {
    type: "SHOT_ATTEMPT",
    shooterId: shot.shooterId,
    made,
    points: shot.points,
    assistPlayerId: made ? shot.assistPlayerId : undefined,
    blockedByPlayerId: !made && shot.blocked ? shot.blockerId : undefined,
  });
  if (shot.attackingTeam === "away") {
    const opponentStats = withAttempt(state.opponentStats, made, shot.points);
    return {
      opponentStats: made && shot.assistPlayerId
        ? { ...opponentStats, assists: opponentStats.assists + 1 }
        : opponentStats,
      playerBoxScores,
    };
  }
  let playerStats = shot.shooterId === state.controlledPlayerId
    ? withAttempt(state.playerStats, made, shot.points)
    : state.playerStats;
  if (made && shot.assistPlayerId === state.controlledPlayerId) {
    playerStats = { ...playerStats, assists: playerStats.assists + 1 };
  }
  return { playerStats, playerBoxScores };
}

function finishShotFlight(state: MatchState): MatchState {
  const shot = state.pendingShot;
  if (!shot) return state;
  const stats = shotStatPatch(state, shot);
  const effectiveMade = !shot.offensiveInterference && (shot.made || Boolean(shot.goaltended));

  if (shot.offensiveInterference) {
    const interfererId = shot.interfererId ?? shot.shooterId;
    const interferer = playerById.get(interfererId);
    const ledgerAfterShot = stats.playerBoxScores ?? state.playerBoxScores;
    const playerBoxScores = applyPlayerStatsEvent(ledgerAfterShot, { type: "TURNOVER", playerId: interfererId });
    const legacyTurnover = interferer?.team === "away"
      ? { opponentStats: withTurnover((stats.opponentStats ?? state.opponentStats) as BoxScoreLine) }
      : interfererId === state.controlledPlayerId
        ? { playerStats: withTurnover((stats.playerStats ?? state.playerStats) as BoxScoreLine) }
        : {};
    const lastOfficialCall = {
      id: `call-${state.eventSequence + 1}`,
      kind: "OFFENSIVE_INTERFERENCE" as const,
      offendingTeam: shot.attackingTeam,
      offenderId: interfererId,
      text: `${interferer?.number ?? "进攻"}号进攻干扰球 · 得分无效，球权转换`,
      atGameSecond: state.gameSeconds,
    };
    const adjudicated = commitGameEvent(state, "OFFENSIVE_INTERFERENCE", lastOfficialCall.text, {
      ...stats,
      ...legacyTurnover,
      playerBoxScores,
      lastOfficialCall,
      seed: shot.seed,
      pendingShot: undefined,
      pendingRebound: undefined,
      phase: "SET_OFFENSE",
      motion: cancelCourtRoutes(state.motion),
    });
    if (state.gameSeconds <= EPSILON) return finishPeriodOrGame(adjudicated);
    return beginDeadBall(adjudicated, "BASKET_INTERFERENCE", {
      team: opposite(shot.attackingTeam),
      spot: "SIDELINE_BACKCOURT",
      reason: "BASKET_INTERFERENCE",
      shotClock: state.rules.fullShotClockSeconds,
      requiresAdvance: true,
      retainsPossession: false,
      gameClockContinues: false,
    }, `${lastOfficialCall.text} · 对方后场边线发球`);
  }

  if (shot.shootingFoul && shot.foulerId) {
    const scoringPatch = effectiveMade
      ? shot.attackingTeam === "home"
        ? { homeScore: state.homeScore + shot.points }
        : { awayScore: state.awayScore + shot.points }
      : {};
    const contact = commitGameEvent(state, effectiveMade ? "SHOT_MADE_AND_FOUL" : "SHOT_FOUL_CONTACT", `${shot.explanation} · 裁判鸣哨，投篮犯规`, {
      ...stats,
      ...scoringPatch,
      seed: shot.seed,
      pendingShot: undefined,
      pendingRebound: undefined,
      phase: "SET_OFFENSE",
      motion: cancelCourtRoutes(state.motion),
    });
    return callPersonalFoul(contact, {
      offenderId: shot.foulerId,
      offendedPlayerId: shot.shooterId,
      kind: "SHOOTING",
      shotMade: effectiveMade,
      shotPoints: shot.points,
      resumeShotClock: shot.releaseShotClock,
      seed: shot.seed,
      source: shot.foulSource,
    });
  }

  if (effectiveMade) {
    const scoringPatch = shot.attackingTeam === "home"
      ? { homeScore: state.homeScore + shot.points }
      : { awayScore: state.awayScore + shot.points };
    const lastOfficialCall = shot.goaltended
      ? {
          id: `call-${state.eventSequence + 1}`,
          kind: "DEFENSIVE_GOALTENDING" as const,
          offendingTeam: opposite(shot.attackingTeam),
          offenderId: shot.goaltenderId,
          offendedPlayerId: shot.shooterId,
          text: `防守干扰球 · 判给${shot.points}分`,
          atGameSecond: state.gameSeconds,
        }
      : undefined;
    if (state.gameSeconds <= EPSILON) {
      const scoredAtHorn = commitGameEvent(state, shot.goaltended ? "GOALTENDING_AT_HORN" : "SHOT_MADE_AT_HORN", shot.goaltended ? `${shot.explanation} · 防守干扰球，压哨判给${shot.points}分` : `${shot.explanation} · 压哨命中${shot.points}分`, {
        ...stats,
        ...scoringPatch,
        lastOfficialCall,
        seed: shot.seed,
        pendingShot: undefined,
        pendingRebound: undefined,
        phase: "SET_OFFENSE",
        motion: cancelCourtRoutes(state.motion),
      });
      return finishPeriodOrGame(scoredAtHorn);
    }
    return beginDeadBall(
      state,
      shot.goaltended ? "GOALTENDING" : "MADE_BASKET",
      {
        team: opposite(shot.attackingTeam),
        spot: "BASELINE",
        reason: shot.goaltended ? "GOALTENDING" : "MADE_BASKET",
        shotClock: state.rules.fullShotClockSeconds,
        requiresAdvance: true,
        retainsPossession: false,
        gameClockContinues: !shouldStopAfterMadeBasket(state),
      },
      shot.goaltended ? `${shot.explanation} · 防守干扰球，判给${shot.points}分，对方底线发球` : `${shot.explanation} · 命中${shot.points}分，对方底线发球`,
      { ...scoringPatch, ...stats, lastOfficialCall, seed: shot.seed },
    );
  }

  if (state.gameSeconds <= EPSILON) {
    const missedAtHorn = commitGameEvent(state, "SHOT_MISSED_AT_HORN", `${shot.explanation} · 终场前出手未中`, {
      ...stats,
      pendingShot: undefined,
      pendingRebound: undefined,
      motion: cancelCourtRoutes(state.motion),
      phase: "SET_OFFENSE",
    });
    return finishPeriodOrGame(missedAtHorn);
  }

  const resolution = shot.plannedRebound ?? resolveMissedShotRebound({
    state,
    roster: players,
    shooterId: shot.shooterId,
    shotOrigin: state.motion.positions[shot.shooterId],
    rim: attackRim(shot.attackingTeam),
    seed: shot.seed,
  });
  const start = resolution.rimContacted ? attackRim(shot.attackingTeam) : resolution.landingPoint;
  const reboundDistance = courtDistanceMeters(start, resolution.landingPoint);
  const winnerArrival = resolution.candidates.find((candidate) => candidate.playerId === resolution.winnerId)?.arrivalSeconds ?? 0.75;
  const rawDuration = resolution.rimContacted
    ? Math.max(0.46 + reboundDistance * 0.09, winnerArrival + 0.1)
    : Math.max(0.25, winnerArrival + 0.08);
  const duration = Math.round(Math.min(1.55, rawDuration) / 0.05) * 0.05;
  const motion = startFreeBallFlight(state.motion, start, resolution.landingPoint, resolution.rimContacted ? "RIM_REBOUND" : "LOOSE_BALL", {
    duration,
    startHeightMeters: resolution.rimContacted ? 3.05 : 1.2,
    endHeightMeters: 1.05,
    apexHeightMeters: resolution.rimContacted ? Math.min(4.05, 3.22 + reboundDistance * 0.12) : 1.2,
    lateralCurve: resolution.collision === "SIDE_RIM" ? 1.4 : 0,
    toPlayerId: resolution.winnerId,
  });
  const loose = commitGameEvent(state, "REBOUND_LOOSE", `${shot.explanation} · ${resolution.rimContacted ? "碰筐弹出" : shot.blocked ? "封盖后形成活球" : "未碰筐形成活球"}`, {
    ...stats,
    seed: resolution.seed,
    phase: "REBOUND",
    shotClock: resolution.rimContacted ? 0 : state.shotClock,
    pendingShot: undefined,
    pendingRebound: { resolution, shot },
    opponentOffense: undefined,
    pendingDefenseResponse: undefined,
    lastDefenseResponse: undefined,
    screen: undefined,
    motion,
  });
  return applyReboundContestMotion(loose);
}

function finishReboundContest(state: MatchState): MatchState {
  const pending = state.pendingRebound;
  if (!pending) return state;
  const rebound = pending.resolution;
  const winner = playerById.get(rebound.winnerId);
  if (!winner) return state;
  const playerStats = winner.id === state.controlledPlayerId
    ? { ...state.playerStats, rebounds: state.playerStats.rebounds + 1 }
    : state.playerStats;
  const opponentStats = winner.team === "away"
    ? { ...state.opponentStats, rebounds: state.opponentStats.rebounds + 1 }
    : state.opponentStats;
  const reboundLedger = applyPlayerStatsEvent(state.playerBoxScores, {
    type: "REBOUND",
    playerId: winner.id,
    offensive: rebound.offensive,
  });
  const reboundLabel = `${winner.number}号${rebound.contested ? "对抗中" : "保护"}篮板`;

  if (rebound.offensive) {
    const shotClock = rebound.rimContacted ? state.rules.offensiveReboundSeconds : state.shotClock;
    return commitGameEvent(state, "OFFENSIVE_REBOUND", `${reboundLabel} · ${rebound.rimContacted ? "回表14秒，可二次进攻" : "未碰筐，进攻时间不回表"}`, {
      seed: rebound.seed,
      possession: winner.team,
      ballHandlerId: winner.id,
      phase: winner.team === "home" ? "SECOND_DECISION" : "SET_OFFENSE",
      shotClock,
      fastbreakClock: null,
      backcourtClock: null,
      frontcourtEstablished: true,
      pendingRebound: undefined,
      lastRebound: rebound,
      advantage: "SECOND_CHANCE",
      secondChanceCount: state.secondChanceCount + 1,
      playerStats,
      opponentStats,
      playerBoxScores: reboundLedger,
      motion: cancelCourtRoutes(state.motion),
    });
  }

  const outlet = selectDefensiveReboundOutlet(state, players, rebound);
  const baseMotion = cancelCourtRoutes(state.motion);
  const outletRoll = outlet.shouldPass ? nextRandom(rebound.seed) : { seed: rebound.seed, value: 1 };
  if (outlet.shouldPass && outletRoll.value < outlet.risk) {
    const interceptor = players
      .filter((player) => player.team !== winner.team)
      .sort((first, second) =>
        second.ratings.steal + second.ratings.basketballIQ + second.ratings.hands -
        first.ratings.steal - first.ratings.basketballIQ - first.ratings.hands,
      )[0];
    const turnoverMotion = interceptor
      ? startBallFlight(baseMotion, winner.id, interceptor.id, "OUTLET")
      : baseMotion;
    const turnoverPlayerStats = winner.team === "home" && winner.id === state.controlledPlayerId
      ? { ...playerStats, turnovers: playerStats.turnovers + 1 }
      : playerStats;
    const turnoverOpponentStats = winner.team === "away"
      ? { ...opponentStats, turnovers: opponentStats.turnovers + 1 }
      : opponentStats;
    const turnoverLedger = applyPlayerStatsEvent(reboundLedger, {
      type: "TURNOVER",
      playerId: winner.id,
      stolenByPlayerId: interceptor?.id,
    });
    return startFastbreak(state, opposite(winner.team), "OUTLET_TURNOVER", `${reboundLabel} · 出球线路被截断，球权再次转换`, {
      seed: outletRoll.seed,
      ballHandlerId: interceptor?.id ?? defaultHandler(opposite(winner.team)),
      pendingRebound: undefined,
      lastRebound: rebound,
      playerStats: turnoverPlayerStats,
      opponentStats: turnoverOpponentStats,
      playerBoxScores: turnoverLedger,
      motion: turnoverMotion,
    });
  }
  const motion = outlet.shouldPass
    ? startPassFlight(baseMotion, winner.id, outlet.receiverId, "OUTLET")
    : baseMotion;
  if (outlet.shouldPass && outlet.receiverId !== winner.id && motion.ballFlight) {
    // Arrival-aware outlet pass: the rebounder outlets to the guard; the
    // fastbreak world starts now (live clocks), but control transfers to
    // the receiver only when the ball physically arrives.
    const fastbreak = startFastbreak(
      state,
      winner.team,
      "DEFENSIVE_REBOUND",
      `${reboundLabel} · ${playerById.get(outlet.receiverId)?.number ?? "核心"}号接应推进`,
      {
        seed: outletRoll.seed,
        ballHandlerId: winner.id,
        pendingRebound: undefined,
        lastRebound: rebound,
        playerStats,
        opponentStats,
        playerBoxScores: reboundLedger,
        motion,
      },
    );
    return attachPendingPass(fastbreak, winner.id, outlet.receiverId, "OUTLET");
  }
  return startFastbreak(
    state,
    winner.team,
    "DEFENSIVE_REBOUND",
    `${reboundLabel} · ${outlet.shouldPass ? `${playerById.get(outlet.receiverId)?.number ?? "核心"}号接应推进` : "篮板手自行推进"}`,
    {
      seed: outletRoll.seed,
      ballHandlerId: outlet.receiverId,
      pendingRebound: undefined,
      lastRebound: rebound,
      playerStats,
      opponentStats,
      playerBoxScores: reboundLedger,
      motion,
    },
  );
}

function releaseFreeThrow(state: MatchState): MatchState {
  const sequence = state.freeThrowSequence;
  if (state.phase !== "FREE_THROW" || !sequence || sequence.stage === "FLIGHT") return state;
  const shooter = playerById.get(sequence.shooterId);
  if (!shooter) return state;
  const settled = applyFreeThrowFormation(state, shooter.id, sequence.laneOccupied, true);
  const result = resolveAutomaticFreeThrow(
    shooter.ratings,
    sequence.seed,
    shooter.id === state.createdPlayerId && shooter.id === state.controlledPlayerId
      ? DIFFICULTY_PROGRESSION_POLICY[state.difficulty].controlledPlayerContribution
      : 1,
  );
  const rim = attackRim(shooter.team);
  const origin = freeThrowLinePoint(shooter.team);
  const motion = startFreeBallFlight(settled.motion, origin, rim, "FREE_THROW", {
    duration: 0.8,
    startHeightMeters: 2.08,
    endHeightMeters: 3.05,
    apexHeightMeters: 4.25,
    fromPlayerId: shooter.id,
  });
  const current = sequence.attempted + 1;
  return commitGameEvent(settled, "FREE_THROW_RELEASE", `第${current}/${sequence.total}罚 · 自动出手`, {
    seed: result.seed,
    transitionClock: null,
    freeThrowSequence: {
      ...sequence,
      stage: "FLIGHT",
      currentMade: result.made,
      currentProbability: result.probability,
      seed: result.seed,
    },
    motion,
  });
}

function startFreeThrowRebound(state: MatchState, shooterId: string, seed: number, resumeShotClock: number) {
  const shooter = playerById.get(shooterId);
  if (!shooter) return state;
  const rim = attackRim(shooter.team);
  const origin = freeThrowLinePoint(shooter.team);
  const resolution = resolveMissedShotRebound({
    state,
    roster: players,
    shooterId,
    shotOrigin: origin,
    rim,
    seed,
  });
  if (!resolution.rimContacted) {
    return beginDeadBall(state, "FREE_THROW_VIOLATION", {
      team: opposite(shooter.team),
      spot: "SIDELINE_BACKCOURT",
      reason: "FREE_THROW_VIOLATION",
      shotClock: state.rules.fullShotClockSeconds,
      requiresAdvance: true,
      retainsPossession: false,
      gameClockContinues: false,
    }, "最后一罚未触及篮圈 · 罚球队违例，对方边线发球", {
      freeThrowSequence: undefined,
    });
  }
  const reboundDistance = courtDistanceMeters(rim, resolution.landingPoint);
  const winnerArrival = resolution.candidates.find((candidate) => candidate.playerId === resolution.winnerId)?.arrivalSeconds ?? 0.75;
  const duration = Math.round(Math.min(1.55, Math.max(0.46 + reboundDistance * 0.09, winnerArrival + 0.1)) / 0.05) * 0.05;
  const motion = startFreeBallFlight(state.motion, rim, resolution.landingPoint, "RIM_REBOUND", {
    duration,
    startHeightMeters: 3.05,
    endHeightMeters: 1.05,
    apexHeightMeters: Math.min(4.05, 3.22 + reboundDistance * 0.12),
    lateralCurve: resolution.collision === "SIDE_RIM" ? 1.4 : 0,
    toPlayerId: resolution.winnerId,
  });
  const shot: PendingShotState = {
    id: `free-throw-miss-${state.eventSequence + 1}`,
    attackingTeam: shooter.team,
    shooterId,
    points: 2,
    made: false,
    blocked: false,
    shotType: "RIM",
    explanation: "最后一罚未中",
    seed: resolution.seed,
    releaseShotClock: resumeShotClock,
    plannedRebound: resolution,
  };
  const loose = commitGameEvent(state, "FREE_THROW_REBOUND_LOOSE", "最后一罚碰筐未中 · 篮下球员开始争抢", {
    seed: resolution.seed,
    phase: "REBOUND",
    shotClock: 0,
    transitionClock: null,
    freeThrowSequence: undefined,
    pendingShot: undefined,
    pendingRebound: { resolution, shot },
    motion,
  });
  return applyReboundContestMotion(loose);
}

function finishFreeThrowFlight(state: MatchState): MatchState {
  const sequence = state.freeThrowSequence;
  if (state.phase !== "FREE_THROW" || !sequence || sequence.stage !== "FLIGHT" || state.motion.ballFlight) return state;
  const shooter = playerById.get(sequence.shooterId);
  if (!shooter) return state;
  const made = Boolean(sequence.currentMade);
  const attempted = sequence.attempted + 1;
  const playerBoxScores = applyPlayerStatsEvent(state.playerBoxScores, { type: "FREE_THROW", shooterId: shooter.id, made });
  const aggregatePatch = shooter.team === "away"
    ? { opponentStats: withFreeThrow(state.opponentStats, made) }
    : shooter.id === state.controlledPlayerId
      ? { playerStats: withFreeThrow(state.playerStats, made) }
      : {};
  const scoringPatch = made
    ? shooter.team === "home"
      ? { homeScore: state.homeScore + 1 }
      : { awayScore: state.awayScore + 1 }
    : {};
  const nextSequence = {
    ...sequence,
    attempted,
    made: sequence.made + (made ? 1 : 0),
    results: [...sequence.results, made ? "MADE" as const : "MISSED" as const],
    currentMade: undefined,
    currentProbability: undefined,
  };
  const recorded = commitGameEvent(state, made ? "FREE_THROW_MADE" : "FREE_THROW_MISSED", `第${attempted}/${sequence.total}罚${made ? "命中" : "未中"}`, {
    ...aggregatePatch,
    ...scoringPatch,
    playerBoxScores,
    freeThrowSequence: nextSequence,
    motion: cancelCourtRoutes(state.motion),
  });
  if (attempted < sequence.total) {
    const between = {
      ...nextSequence,
      stage: "BETWEEN" as const,
    };
    return applyFreeThrowFormation({ ...recorded, transitionClock: 0.55, freeThrowSequence: between }, shooter.id, sequence.laneOccupied, true);
  }

  const completed = { ...recorded, freeThrowSequence: undefined, transitionClock: null };
  if (state.gameSeconds <= EPSILON) return finishPeriodOrGame(completed);
  if (sequence.retainPossession) {
    return beginDeadBall(completed, "DEFENSIVE_THREE_SECONDS", {
      team: shooter.team,
      spot: "SIDELINE_FRONTCOURT",
      reason: "DEFENSIVE_THREE_SECONDS",
      shotClock: Math.max(sequence.resumeShotClock, state.rules.offensiveReboundSeconds),
      requiresAdvance: false,
      retainsPossession: true,
      gameClockContinues: false,
    }, `技术罚球${made ? "命中" : "未中"} · 原进攻方保留前场球权`);
  }
  if (!made && sequence.liveAfterFinalMiss) {
    return startFreeThrowRebound(completed, shooter.id, sequence.seed, sequence.resumeShotClock);
  }
  return beginDeadBall(completed, "MADE_BASKET", {
    team: opposite(shooter.team),
    spot: "BASELINE",
    reason: "MADE_BASKET",
    shotClock: state.rules.fullShotClockSeconds,
    requiresAdvance: true,
    retainsPossession: false,
    gameClockContinues: false,
  }, "最后一罚结束 · 对方底线发球");
}

function bestTechnicalShooter(team: TeamSide) {
  return players
    .filter((player) => player.team === team)
    .sort((first, second) => second.ratings.freeThrow - first.ratings.freeThrow || second.ratings.basketballIQ - first.ratings.basketballIQ)[0];
}

function callDefensiveThreeSeconds(state: MatchState, offenderId: string) {
  const offender = playerById.get(offenderId);
  if (!offender) return state;
  const offense = opposite(offender.team);
  const shooter = bestTechnicalShooter(offense);
  if (!shooter) return state;
  const lastOfficialCall = {
    id: `call-${state.eventSequence + 1}`,
    kind: "DEFENSIVE_THREE_SECONDS" as const,
    offendingTeam: offender.team,
    offenderId,
    text: `${offender.number}号防守三秒 · 技术罚球一次，原进攻方保留球权`,
    atGameSecond: state.gameSeconds,
  };
  return beginFreeThrowSequence({
    ...state,
    lastOfficialCall,
    threeSecondClocks: Object.fromEntries(players.map((player) => [player.id, 0])),
  }, {
    shooterId: shooter.id,
    total: 1,
    reason: "DEFENSIVE_THREE_SECONDS",
    retainPossession: true,
    liveAfterFinalMiss: false,
    resumeShotClock: Math.max(state.shotClock, state.rules.offensiveReboundSeconds),
    seed: state.seed,
  });
}

function advanceThreeSecondClocks(state: MatchState, elapsedSeconds: number): MatchState {
  // The lane count is suspended during an uninterrupted transition attack toward
  // the rim; it resumes as soon as the offense settles into a frontcourt action.
  const teamControl = state.phase === "SET_OFFENSE" || state.phase === "SCREEN_APPROACH" || state.phase === "SECOND_DECISION";
  if (!teamControl || state.motion.ballFlight || !hasFrontcourtControl(state)) {
    if (Object.values(state.threeSecondClocks).every((value) => value === 0)) return state;
    return { ...state, threeSecondClocks: Object.fromEntries(players.map((player) => [player.id, 0])) };
  }
  const offense = state.possession;
  const offensePoints = players
    .filter((player) => player.team === offense)
    .map((player) => state.motion.positions[player.id]);
  const clocks = { ...state.threeSecondClocks };
  let motion = state.motion;
  for (const player of players) {
    const point = state.motion.positions[player.id];
    if (!point) continue;
    const handlerPoint = state.motion.positions[state.ballHandlerId];
    const assignedToBallHandler = offense === "home"
      ? state.currentMatchups[state.ballHandlerId] === player.id
      : state.currentMatchups[player.id] === state.ballHandlerId;
    const activelyGuardingBallHandler = Boolean(
      assignedToBallHandler
      && handlerPoint
      && courtDistanceMeters(point, handlerPoint) <= 1.35,
    );
    const routeEnd = state.motion.routes[player.id]?.at(-1);
    let imminentExit = Boolean(routeEnd && !shouldCountOffensiveThreeSeconds(routeEnd, {
      attackingTeam: offense,
      teamHasControl: true,
      teamHasFrontcourtControl: true,
    }));
    const aiReadsLaneClock = player.id !== state.controlledPlayerId
      && player.ratings.basketballIQ >= 68
      && (clocks[player.id] ?? 0) >= 2.55
      && (clocks[player.id] ?? 0) < 2.8;
    if (!imminentExit && aiReadsLaneClock) {
      const isOffensiveLaneOccupant = player.team === offense && shouldCountOffensiveThreeSeconds(point, {
        attackingTeam: offense,
        teamHasControl: true,
        teamHasFrontcourtControl: true,
      });
      const isUnguardedDefender = player.team !== offense && shouldCountDefensiveThreeSeconds(
        point,
        offensePoints,
        {
          attackingTeam: offense,
          teamHasControl: true,
          teamHasFrontcourtControl: true,
        },
        activelyGuardingBallHandler,
      );
      if (isOffensiveLaneOccupant || isUnguardedDefender) {
        const exitPoint = { x: point.x, y: point.y <= 50 ? 31.5 : 68.5 };
        motion = {
          ...motion,
          routes: { ...motion.routes, [player.id]: [exitPoint] },
          intents: { ...motion.intents, [player.id]: player.team === offense ? "SPACE" : "CONTAIN" },
        };
        imminentExit = true;
      }
    }
    const counting = player.team === offense
      ? shouldCountOffensiveThreeSeconds(point, {
          attackingTeam: offense,
          teamHasControl: true,
          teamHasFrontcourtControl: true,
          imminentExit,
        })
      : shouldCountDefensiveThreeSeconds(
          point,
          offensePoints,
          {
            attackingTeam: offense,
            teamHasControl: true,
            teamHasFrontcourtControl: true,
            imminentExit,
          },
          activelyGuardingBallHandler,
        );
    clocks[player.id] = nextThreeSecondClock(clocks[player.id] ?? 0, elapsedSeconds, counting);
  }
  const next = { ...state, threeSecondClocks: clocks, motion };
  const violator = players.find((player) => clocks[player.id] > 3 + EPSILON);
  if (!violator) return next;
  if (violator.team !== offense) return callDefensiveThreeSeconds(next, violator.id);
  const lastOfficialCall = {
    id: `call-${next.eventSequence + 1}`,
    kind: "OFFENSIVE_THREE_SECONDS" as const,
    offendingTeam: violator.team,
    offenderId: violator.id,
    text: `${violator.number}号进攻三秒 · 球权转换`,
    atGameSecond: next.gameSeconds,
  };
  return violationRestart({ ...next, lastOfficialCall }, "OFFENSIVE_THREE_SECONDS", lastOfficialCall.text, violator.id);
}

function decrement(state: MatchState, step: number, fields: Array<keyof MatchState>) {
  const patch: Partial<MatchState> = {};
  for (const field of fields) {
    const value = state[field];
    if (typeof value === "number") {
      (patch as Record<string, unknown>)[field] = roundSeconds(value - step);
    }
  }
  return { ...state, ...patch };
}

function activateOpponentOffense(state: MatchState) {
  const started = startOpponentOffense(state);
  return applyOpponentStageMotion(commitGameEvent(state, started.kind, started.text, started.patch), state.ballHandlerId);
}

function resolveOpponentDecisionBoundary(state: MatchState) {
  const result = advanceOpponentDecision(state);
  if (result.kind === "STAGE" || result.kind === "ATTEMPT_READY") {
    const requestedHandlerId = result.patch.ballHandlerId;
    const requestedPoint = requestedHandlerId ? state.motion.positions[requestedHandlerId] : undefined;
    const requestedHandlerInFrontcourt = requestedPoint
      ? state.possession === "home" ? requestedPoint.x <= 50 : requestedPoint.x >= 50
      : true;
    if (
      state.frontcourtEstablished
      && requestedHandlerId
      && requestedHandlerId !== state.ballHandlerId
      && !requestedHandlerInFrontcourt
    ) {
      // Keep the current handler and let the receiver finish crossing midcourt;
      // otherwise the scripted pass itself would manufacture an over-and-back.
      return {
        ...state,
        aiDecisionClock: Math.min(0.25, Math.max(0.05, state.shotClock - 0.08)),
      };
    }
    const handlerChanged = Boolean(requestedHandlerId && requestedHandlerId !== state.ballHandlerId);
    const eventKind = result.kind === "STAGE" ? "AI_STAGE" : "AI_SHOT_PREP";
    // Pass-arrival model: the stage semantic patch is committed WITHOUT
    // reassigning the ball handler. If the stage moves the ball to a new
    // handler, a real pass flight is launched toward a fixed catch point and
    // the handler flips only at arrival (completePassArrival).
    const { ballHandlerId: _deferred, ...semanticPatch } = result.patch;
    const committed = commitGameEvent(state, eventKind, result.text, semanticPatch);
    if (handlerChanged && requestedHandlerId) {
      const staged = applyOpponentStageMotion(committed, state.ballHandlerId, requestedHandlerId);
      return attachPendingPass(staged, state.ballHandlerId, requestedHandlerId, "AI_STAGE");
    }
    return applyOpponentStageMotion(committed, state.ballHandlerId);
  }
  if (result.kind === "TURNOVER") {
    const response = state.pendingDefenseResponse?.action;
    const interceptor = response === "STEAL_PRESSURE" || response === "GAMBLE"
      ? playerById.get(state.controlledPlayerId)
      : players
          .filter((player) => player.team === "home")
          .sort((first, second) => second.ratings.steal + second.ratings.hands - first.ratings.steal - first.ratings.hands)[0];
    const playerBoxScores = applyPlayerStatsEvent(state.playerBoxScores, {
      type: "TURNOVER",
      playerId: state.ballHandlerId,
      stolenByPlayerId: interceptor?.id,
    });
    return startFastbreak(state, "home", "AI_TURNOVER", result.text, {
      seed: result.seed,
      opponentStats: withTurnover(state.opponentStats),
      playerStats: interceptor?.id === state.controlledPlayerId
        ? { ...state.playerStats, steals: state.playerStats.steals + 1 }
        : state.playerStats,
      playerBoxScores,
      ballHandlerId: interceptor?.id ?? defaultHandler("home"),
    });
  }

  const shotType: ShotFlightType = result.attempt.shotType === "THREE" || result.attempt.shotType === "KICK_THREE"
    ? "THREE"
    : result.attempt.shotType === "MID_RANGE" || result.attempt.shotType === "PULL_UP"
      ? "MID_RANGE"
      : "RIM";
  const defenderEntry = Object.entries(state.currentMatchups).find(([, awayId]) => awayId === result.attempt.shooterId);
  const defender = defenderEntry ? playerById.get(defenderEntry[0]) : undefined;
  const rimAttempt = shotType === "RIM";
  const contact = defender
    ? resolveShootingContact(
        playerById.get(result.attempt.shooterId)!.ratings,
        defender.ratings,
        result.seed,
        rimAttempt,
        state.pendingDefenseResponse?.action === "CONTEST",
      )
    : { foul: false, probability: 0, seed: result.seed };
  const naturalShootingFoul = contact.foul && canCallNaturalFoul(state, result.attempt.points === 3);
  const illegalTouchRoll = nextRandom(contact.seed);
  const goaltendChance = defender
    ? Math.max(0.01, Math.min(0.07, 0.018 + (75 - defender.ratings.helpDefenseIQ) / 500))
    : 0;
  const mistimedDescendingTouch = illegalTouchRoll.value < goaltendChance;
  const touchReview = defender && mistimedDescendingTouch
    ? evaluateBasketInterference({
        shootingTeam: "away",
        touchingTeam: defender.team,
        descending: true,
        aboveRing: true,
        withinCylinder: false,
        touchedBackboard: false,
        hasChanceToScore: true,
      })
    : "LEGAL";
  const goaltended = result.blocked && !naturalShootingFoul && rimAttempt && touchReview === "DEFENSIVE_GOALTENDING";
  const legalBlock = result.blocked && !naturalShootingFoul && !goaltended;
  const released = startResolvedShot(state, {
    attackingTeam: "away",
    shooterId: result.attempt.shooterId,
    points: result.attempt.points,
    made: result.made,
    blocked: legalBlock,
    blockerId: legalBlock ? defender?.id : undefined,
    goaltended,
    goaltenderId: goaltended ? defender?.id : undefined,
    shootingFoul: naturalShootingFoul,
    foulerId: naturalShootingFoul ? defender?.id : undefined,
    foulSource: "NATURAL",
    assistPlayerId: state.potentialAssistReceiverId === result.attempt.shooterId
      ? state.potentialAssistPlayerId
      : undefined,
    shotType,
    explanation: result.text,
    seed: illegalTouchRoll.seed,
  });
  if (!legalBlock || defender?.id !== state.controlledPlayerId) return released;
  return {
    ...released,
    playerStats: { ...released.playerStats, blocks: released.playerStats.blocks + 1 },
  };
}

function pendingDriveReady(state: MatchState) {
  const pending = state.pendingDrive;
  if (
    !pending
    || state.phase !== "SECOND_DECISION"
    || state.possession !== "home"
    || state.ballHandlerId !== pending.handlerId
    || state.motion.ballFlight
    || state.gameSeconds <= EPSILON
    || state.shotClock <= EPSILON
  ) return false;
  const handler = playerById.get(pending.handlerId);
  const point = state.motion.positions[pending.handlerId];
  if (!handler || !point) return false;
  return courtDistanceMeters(point, attackRim(handler.team)) <= 2.25;
}

function finishPendingDrive(state: MatchState) {
  const pending = state.pendingDrive;
  if (!pending || !pendingDriveReady(state)) return state;
  if (pending.laneOpenAtStart) {
    const roll = nextRandom(state.seed);
    return startResolvedShot(state, {
      attackingTeam: "home",
      shooterId: pending.handlerId,
      points: 2,
      made: true,
      shotType: "DUNK",
      explanation: "空篮突破抵达近筐 · 无人护筐直接扣篮",
      seed: roll.seed,
    });
  }

  const finish = resolveDrive(state, "LAYUP");
  const shooter = playerById.get(pending.handlerId);
  const defender = playerById.get(finish.helperId ?? finish.defenderId);
  const contact = shooter && defender
    ? resolveShootingContact(shooter.ratings, defender.ratings, finish.seed, true, state.advantage !== "MISMATCH")
    : { foul: false, seed: finish.seed, probability: 0 };
  const naturalShootingFoul = contact.foul && canCallNaturalFoul(state, false);
  const assistPlayerId = state.potentialAssistReceiverId === pending.handlerId
    ? state.potentialAssistPlayerId
    : undefined;
  return startResolvedShot(state, {
    attackingTeam: "home",
    shooterId: pending.handlerId,
    points: 2,
    made: finish.made,
    shotType: "RIM",
    explanation: `阵地突破抵达近筐 · ${finish.explanation}`,
    seed: contact.seed,
    shootingFoul: naturalShootingFoul,
    foulerId: naturalShootingFoul ? defender?.id : undefined,
    foulSource: "NATURAL",
    assistPlayerId: assistPlayerId === pending.handlerId ? undefined : assistPlayerId,
  });
}

export function advanceMatchTime(state: MatchState, elapsedMs: number): MatchState {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || state.phase === "FINAL") return state;
  let current = state;
  let remaining = elapsedMs / 1_000;
  let guard = 0;

  while (remaining > EPSILON && current.phase !== "FINAL" && guard < 4_096) {
    guard += 1;
    if (hasOverAndBackViolation(current)) {
      current = violationRestart(current, "OVER_AND_BACK_VIOLATION", "前场控制已建立后回到后场 · 回场违例，对方中线发球");
      continue;
    }
    const lateIntentionalFoulEligible = canAiCommitLateIntentionalFoul(current);
    if (!lateIntentionalFoulEligible && current.intentionalFoulClock !== null) {
      current = { ...current, intentionalFoulClock: null };
      continue;
    }
    if (lateIntentionalFoulEligible && current.intentionalFoulClock === null) {
      current = { ...current, intentionalFoulClock: lateIntentionalFoulDelay(current) };
      continue;
    }
    if (canRunOpponentOffense(current) && !current.opponentOffense && !current.motion.ballFlight) {
      current = activateOpponentOffense(current);
      continue;
    }
    const live = isLivePhase(current.phase);
    const gameRunning = live || ((current.phase === "DEAD_BALL" || current.phase === "INBOUND_READY") && Boolean(current.restart?.gameClockContinues));
    const running: Array<keyof MatchState> = [];
    if (gameRunning && current.gameSeconds > EPSILON) running.push("gameSeconds");
    const looseWithoutRim = current.phase === "REBOUND" && current.pendingRebound?.resolution.rimContacted === false;
    if (live && (current.phase !== "REBOUND" || looseWithoutRim) && current.shotClock > EPSILON) running.push("shotClock");
    if (current.phase === "INBOUND_READY") running.push("inboundClock");
    if (current.backcourtClock !== null) running.push("backcourtClock");
    if (current.phase === "FASTBREAK") running.push("fastbreakClock");
    if (current.transitionClock !== null) running.push("transitionClock");
    if (current.opponentOffense && current.aiDecisionClock !== null && !current.motion.ballFlight) running.push("aiDecisionClock");
    if (current.intentionalFoulClock !== null) running.push("intentionalFoulClock");
    const positiveBoundaries = running
      .map((field) => current[field])
      .filter((value): value is number => typeof value === "number" && value > EPSILON);
    const flightRemaining = current.motion.ballFlight
      ? Math.max(0, current.motion.ballFlight.duration - current.motion.ballFlight.elapsed)
      : 0;
    if (flightRemaining > EPSILON) positiveBoundaries.push(flightRemaining);
    const boundary = Math.min(...positiveBoundaries);
    const step = positiveBoundaries.length > 0 ? Math.min(remaining, boundary, 0.05) : 0;
    if (step > EPSILON) {
      const phaseTokenBeforeStep = current.phaseToken;
      current = decrement(current, step, running);
      current = advanceCourtMotion(current, step);
      if (gameRunning) {
        current = {
          ...current,
          playerBoxScores: applyPlayerStatsEvent(current.playerBoxScores, {
            type: "PLAYING_TIME",
            elapsedSeconds: step,
          }),
        };
        current = advanceThreeSecondClocks(current, step);
        if (current.phaseToken !== phaseTokenBeforeStep) {
          remaining -= step;
          continue;
        }
      }
      remaining -= step;
      if (current.backcourtClock !== null && hasFrontcourtControl(current)) {
        current = current.phase === "BACKCOURT_ADVANCE"
          ? completeBackcourtAdvance(current, current.phaseToken)
          : { ...current, backcourtClock: null, frontcourtEstablished: true };
        continue;
      }
      if (!current.frontcourtEstablished && hasLiveTeamControl(current) && !current.motion.ballFlight && hasFrontcourtControl(current)) {
        current = { ...current, frontcourtEstablished: true };
        continue;
      }
      if (hasOverAndBackViolation(current)) {
        current = violationRestart(current, "OVER_AND_BACK_VIOLATION", "前场控制已建立后回到后场 · 回场违例，对方中线发球");
        continue;
      }
      if (pendingDriveReady(current)) {
        current = finishPendingDrive(current);
        continue;
      }
    }

    if (current.phase === "FREE_THROW" && current.freeThrowSequence?.stage === "FLIGHT" && !current.motion.ballFlight) {
      current = finishFreeThrowFlight(current);
      continue;
    }
    if (current.pendingShot && !current.motion.ballFlight) {
      current = finishShotFlight(current);
      continue;
    }
    if (current.pendingRebound && !current.motion.ballFlight) {
      current = finishReboundContest(current);
      continue;
    }
    if (current.pendingPass && !current.motion.ballFlight) {
      current = completePassArrival(current);
      continue;
    }

    const gameExpired = gameRunning && current.gameSeconds <= EPSILON;
    const shotExpired = live && current.phase !== "SHOT_FLIGHT" && (current.phase !== "REBOUND" || looseWithoutRim) && current.shotClock <= EPSILON;
    const backcourtExpired = current.backcourtClock !== null && current.backcourtClock <= EPSILON;
    const inboundExpired = current.phase === "INBOUND_READY" && (current.inboundClock ?? 1) <= EPSILON;
    const fastbreakExpired = current.phase === "FASTBREAK" && (current.fastbreakClock ?? 1) <= EPSILON;
    const transitionExpired = current.transitionClock !== null && current.transitionClock <= EPSILON;
    const aiDecisionExpired = Boolean(current.opponentOffense) && (current.aiDecisionClock ?? 1) <= EPSILON;
    const intentionalFoulExpired = canAiCommitLateIntentionalFoul(current) && (current.intentionalFoulClock ?? 1) <= EPSILON;

    if (gameExpired && current.phase !== "SHOT_FLIGHT") {
      current = finishPeriodOrGame({ ...current, gameSeconds: 0 });
      continue;
    }
    if (intentionalFoulExpired) {
      current = callAiLateIntentionalFoul(current);
      continue;
    }
    if (shotExpired) {
      current = violationRestart({ ...current, shotClock: 0 }, "SHOT_CLOCK_VIOLATION", "24秒违例 · 对方获得边线球");
      continue;
    }
    if (backcourtExpired) {
      current = violationRestart(current, "BACKCOURT_VIOLATION", "8秒未过半场 · 对方中线发球");
      continue;
    }
    if (inboundExpired) {
      current = violationRestart(current, "INBOUND_VIOLATION", "发球5秒违例 · 球权转换");
      continue;
    }
    if (fastbreakExpired) {
      current = commitGameEvent(current, "FASTBREAK_END", "快攻机会被化解 · 降速进入阵地战", {
        phase: "SET_OFFENSE",
        fastbreakClock: null,
        aiDecisionClock: null,
        intentionalFoulClock: null,
        opponentOffense: undefined,
        pendingDefenseResponse: undefined,
        lastDefenseResponse: undefined,
        motion: cancelCourtRoutes(current.motion),
      });
      continue;
    }
    if (aiDecisionExpired) {
      current = resolveOpponentDecisionBoundary({ ...current, aiDecisionClock: null });
      continue;
    }
    if (transitionExpired) {
      const token = current.phaseToken;
      current = advanceAutomaticPhase({ ...current, transitionClock: null }, token);
      continue;
    }
    if (remaining > EPSILON && step > EPSILON) continue;
    break;
  }
  return current;
}

export function assertMatchInvariants(state: MatchState) {
  const errors: string[] = [];
  if (state.gameSeconds < 0) errors.push("game clock below zero");
  if (state.shotClock < 0 || state.shotClock > state.rules.fullShotClockSeconds) errors.push("shot clock out of range");
  if (state.inboundClock !== null && (state.phase !== "INBOUND_READY" || state.inboundClock < 0)) errors.push("invalid inbound clock");
  if (state.backcourtClock !== null && (!isLivePhase(state.phase) || state.backcourtClock < 0)) errors.push("invalid backcourt clock");
  if (typeof state.frontcourtEstablished !== "boolean") errors.push("invalid frontcourt-control flag");
  if (state.phase === "BACKCOURT_ADVANCE" && state.frontcourtEstablished) errors.push("backcourt advance already marked as established frontcourt");
  if (state.fastbreakClock !== null && (state.phase !== "FASTBREAK" || state.fastbreakClock < 0)) errors.push(`invalid fastbreak clock (${state.phase}, ${state.fastbreakClock})`);
  if (state.aiDecisionClock !== null && (!state.opponentOffense || state.aiDecisionClock < 0)) errors.push("invalid AI decision clock");
  if (state.intentionalFoulClock !== null && (!Number.isFinite(state.intentionalFoulClock) || state.intentionalFoulClock < 0)) errors.push("invalid intentional-foul clock");
  if (state.stealAttemptAccumulator) {
    const accumulator = state.stealAttemptAccumulator;
    const defender = playerById.get(accumulator.defenderId);
    if (
      !Number.isInteger(accumulator.count)
      || accumulator.count < 1
      || accumulator.count > 4
      || accumulator.possessionSerial !== state.offensivePossessionSerial
      || !defender
      || defender.team === state.possession
    ) errors.push("invalid consecutive-steal accumulator");
  }
  if (state.opponentOffense && (!canRunOpponentOffense(state) || state.aiDecisionClock === null)) errors.push("invalid opponent offense context");
  if ((state.phase === "SHOT_FLIGHT") !== Boolean(state.pendingShot)) errors.push("shot flight context does not match phase");
  if ((state.phase === "REBOUND") !== Boolean(state.pendingRebound)) errors.push("rebound context does not match phase");
  if ((state.phase === "FREE_THROW") !== Boolean(state.freeThrowSequence)) errors.push("free throw context does not match phase");
  if (
    state.pendingDrive
    && (
      state.phase !== "SECOND_DECISION"
      || state.possession !== "home"
      || state.pendingDrive.handlerId !== state.ballHandlerId
    )
  ) errors.push("drive context does not match live handler phase");
  if (state.pendingShot && state.motion.ballFlight?.kind !== "SHOT") errors.push("shot flight is missing ball trajectory");
  if (state.pendingRebound && !["RIM_REBOUND", "LOOSE_BALL"].includes(state.motion.ballFlight?.kind ?? "")) errors.push("rebound is missing loose-ball trajectory");
  if (state.pendingPass) {
    const flight = state.motion.ballFlight;
    const passKinds = ["PASS", "BOUNCE", "LOB", "ALLEY_OOP", "HANDOFF", "INBOUND", "OUTLET"];
    if (!flight || !passKinds.includes(flight.kind)) errors.push("pending pass is missing its live ball trajectory");
    if (!isLivePhase(state.phase)) errors.push("pending pass exists outside a live phase");
    if (state.ballHandlerId !== state.pendingPass.fromPlayerId) errors.push("pending pass handler is not the passer");
    const passer = playerById.get(state.pendingPass.fromPlayerId);
    if (!passer || passer.team !== state.possession) errors.push("pending pass passer does not own possession");
    if (state.pendingPass.toPlayerId === state.pendingPass.fromPlayerId) errors.push("pending pass receiver is the passer");
    if (state.pendingPass.possession !== state.possession || state.pendingPass.phaseTokenAtRelease !== state.phaseToken) {
      errors.push("pending pass world identity went stale before arrival");
    }
  }
  if (state.freeThrowSequence?.stage === "FLIGHT" && state.motion.ballFlight?.kind !== "FREE_THROW") errors.push("free throw flight is missing ball trajectory");
  if (state.freeThrowSequence?.stage !== "FLIGHT" && state.motion.ballFlight?.kind === "FREE_THROW") errors.push("free throw ball trajectory exists outside flight stage");
  if (state.pendingDefenseResponse && state.pendingDefenseResponse.decisionToken !== state.opponentOffense?.decisionToken) errors.push("stale defense response");
  if (state.playerStats.made > state.playerStats.attempts) errors.push("home makes exceed attempts");
  if (state.opponentStats.made > state.opponentStats.attempts) errors.push("away makes exceed attempts");
  if (state.playerStats.threesMade > state.playerStats.threesAttempted) errors.push("home threes invalid");
  if (state.opponentStats.threesMade > state.opponentStats.threesAttempted) errors.push("away threes invalid");
  if (new Set(Object.values(state.currentMatchups)).size !== Object.values(state.currentMatchups).length) errors.push("duplicate defensive matchup");
  const handler = playerById.get(state.ballHandlerId);
  if (!handler || handler.team !== state.possession) errors.push("ball handler does not belong to possession team");
  const restartPhase = state.phase === "DEAD_BALL" || state.phase === "INBOUND_READY" || state.phase === "BACKCOURT_ADVANCE";
  if (restartPhase !== Boolean(state.restart)) errors.push("restart context does not match phase");
  if (new Set(state.eventLog.map((event) => event.id)).size !== state.eventLog.length) errors.push("duplicate event id");
  if (state.phase === "FINAL" && (state.gameSeconds !== 0 || state.gameResult === undefined || state.intentionalFoulClock !== null)) errors.push("final is not frozen");
  if (Object.keys(state.threeSecondClocks).length !== players.length || Object.values(state.threeSecondClocks).some((clock) => clock < 0)) errors.push("invalid three-second clocks");
  if (state.teamFouls.home < 0 || state.teamFouls.away < 0 || state.latePeriodTeamFouls.home < 0 || state.latePeriodTeamFouls.away < 0) errors.push("invalid team foul totals");
  const createdPlayer = playerById.get(state.createdPlayerId);
  if (!createdPlayer || createdPlayer.team !== "home") errors.push("created player is missing from the home roster");
  if (state.createdPlayerId !== CREATED_PLAYER_ID || state.controlledPlayerId !== state.createdPlayerId) errors.push("created player control changed");
  if (
    !state.motion.positions[state.createdPlayerId]
    || !state.motion.velocities[state.createdPlayerId]
    || !state.currentMatchups[state.createdPlayerId]
    || !state.playerBoxScores.byPlayerId[state.createdPlayerId]
  ) errors.push("created player left the on-court state");
  try {
    assertNaturalFoulHistory(naturalFoulHistory(state));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "invalid natural foul history");
  }
  try {
    assertPlayerStatsLedger(state.playerBoxScores);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "invalid player stats ledger");
  }
  const statLines = Object.values(state.playerBoxScores.byPlayerId);
  const homePlayerPoints = statLines.filter((line) => line.team === "home").reduce((total, line) => total + line.points, 0);
  const awayPlayerPoints = statLines.filter((line) => line.team === "away").reduce((total, line) => total + line.points, 0);
  if (homePlayerPoints !== state.homeScore - state.initialHomeScore) errors.push("home player points do not match scoreboard");
  if (awayPlayerPoints !== state.awayScore - state.initialAwayScore) errors.push("away player points do not match scoreboard");
  if (Math.abs(statLines.reduce((total, line) => total + line.plusMinus, 0)) > 0.001) errors.push("plus-minus is not conserved");
  try {
    assertMotionInvariants(state);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "invalid motion state");
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  return true;
}
