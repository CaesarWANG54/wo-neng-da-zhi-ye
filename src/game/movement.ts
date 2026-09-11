import { playerById, players } from "./data";
import { getOpponentTactic } from "./opponent-tactics";
import { homeTacticIntent, isHomeTacticContactPair } from "./player-tactics";
import type {
  BallFlightKind,
  BallFlightKindForPass,
  CourtMotionState,
  CourtPlayer,
  CourtPoint,
  HomeTacticExecution,
  MatchState,
  MotionIntent,
  OpponentIntent,
  Position,
  TeamSide,
} from "./types";

export type ActionMotionId =
  | "pass"
  | "drive"
  | "shoot"
  | "screen"
  | "request"
  | "cut"
  | "spot"
  | "contain"
  | "steal"
  | "contest"
  | "switch"
  | "zone";

const MIN_X = 6;
const MAX_X = 94;
const MIN_Y = 7;
const MAX_Y = 93;
const COURT_X_VISUAL_SCALE = 2.05;
export const COURT_LENGTH_METERS = 28.65;
export const COURT_WIDTH_METERS = 15.24;
const MAX_SIMULATION_STEP_SECONDS = 0.05;
const WAYPOINT_REACHED_DISTANCE = 0.72;
const FINAL_WAYPOINT_REACHED_DISTANCE = 5.8;
const CONTACT_WAYPOINT_REACHED_DISTANCE = 12.8;
export const TEAMMATE_SPACING_VISUAL = 14;
export const TACTIC_TARGET_SPACING_VISUAL = 12.5;

const roleIndex: Record<Position, number> = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };

const baseHomeFormation: Record<Position, CourtPoint> = {
  PG: { x: 42, y: 50 },
  SG: { x: 32, y: 17 },
  SF: { x: 31, y: 83 },
  PF: { x: 20, y: 74 },
  C: { x: 16, y: 49 },
};

const tacticHomeFormations: Record<NonNullable<MatchState["activeTactic"]>, Record<Position, CourtPoint>> = {
  HORNS: {
    PG: { x: 42, y: 50 },
    SG: { x: 17, y: 14 },
    SF: { x: 17, y: 86 },
    PF: { x: 30, y: 38 },
    C: { x: 30, y: 62 },
  },
  FIVE_OUT: {
    PG: { x: 43, y: 50 },
    SG: { x: 32, y: 14 },
    SF: { x: 32, y: 86 },
    PF: { x: 17, y: 27 },
    C: { x: 17, y: 73 },
  },
  HANDOFF: {
    PG: { x: 35, y: 43 },
    SG: { x: 36, y: 60 },
    SF: { x: 22, y: 84 },
    PF: { x: 22, y: 22 },
    C: { x: 29, y: 51 },
  },
  STAGGER: {
    PG: { x: 42, y: 49 },
    SG: { x: 30, y: 20 },
    SF: { x: 18, y: 80 },
    PF: { x: 25, y: 44 },
    C: { x: 21, y: 61 },
  },
};

function clampPoint(point: CourtPoint): CourtPoint {
  return {
    x: Math.min(MAX_X, Math.max(MIN_X, Math.round(point.x * 100) / 100)),
    y: Math.min(MAX_Y, Math.max(MIN_Y, Math.round(point.y * 100) / 100)),
  };
}

function mirrorForTeam(point: CourtPoint, team: CourtPlayer["team"]): CourtPoint {
  return team === "home" ? point : { x: 100 - point.x, y: point.y };
}

function homeTacticPoint(
  point: CourtPoint,
  execution: HomeTacticExecution,
  position: Position,
  team: CourtPlayer["team"] = "home",
) {
  const index = roleIndex[position];
  const mirroredY = execution.side === "UPPER" ? point.y : 100 - point.y;
  const depthShift = execution.variant === 1
    ? (index % 2 === 0 ? 1.35 : -1.05)
    : execution.variant === 2
      ? (index < 2 ? -1.55 : 1.2)
      : 0;
  const laneShift = execution.variant === 1
    ? (index - 2) * 0.78
    : execution.variant === 2
      ? (2 - index) * 0.66
      : 0;
  return mirrorForTeam(
    clampPoint({
      x: point.x + depthShift,
      y: mirroredY + (execution.side === "UPPER" ? laneShift : -laneShift),
    }),
    team,
  );
}

export function courtDistance(a: CourtPoint, b: CourtPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function courtVisualDistance(a: CourtPoint, b: CourtPoint) {
  return Math.hypot((a.x - b.x) * COURT_X_VISUAL_SCALE, a.y - b.y);
}

export function courtDistanceMeters(a: CourtPoint, b: CourtPoint) {
  const longitudinalMeters = ((a.x - b.x) / 100) * COURT_LENGTH_METERS;
  const lateralMeters = ((a.y - b.y) / 100) * COURT_WIDTH_METERS;
  return Math.hypot(longitudinalMeters, lateralMeters);
}

function passSpeedMetersPerSecond(passSpeedRating: number, kind: BallFlightKind) {
  const rating = Math.min(99, Math.max(25, passSpeedRating));
  const chestPassSpeed = 7.6 + (rating / 99) * 4.8;
  if (kind === "LOB" || kind === "ALLEY_OOP") return chestPassSpeed * 0.72;
  if (kind === "BOUNCE") return chestPassSpeed * 0.9;
  if (kind === "HANDOFF") return 5.4;
  if (kind === "INBOUND") return chestPassSpeed * 0.88;
  if (kind === "OUTLET") return chestPassSpeed * 0.94;
  return chestPassSpeed;
}

export function calculatePassFlight(
  start: CourtPoint,
  end: CourtPoint,
  passSpeedRating: number,
  kind: BallFlightKind = "PASS",
) {
  const distanceMeters = courtDistanceMeters(start, end);
  const speedMetersPerSecond = passSpeedMetersPerSecond(passSpeedRating, kind);
  const rawDuration = distanceMeters / Math.max(0.1, speedMetersPerSecond);
  const minimum = kind === "HANDOFF" ? 0.24 : kind === "LOB" ? 0.48 : 0.32;
  const maximum = kind === "LOB" ? 1.85 : 1.62;
  const boundedDuration = Math.min(maximum, Math.max(minimum, rawDuration));
  return {
    distanceMeters: Math.round(distanceMeters * 100) / 100,
    speedMetersPerSecond: Math.round(speedMetersPerSecond * 100) / 100,
    duration: Math.ceil(boundedDuration / MAX_SIMULATION_STEP_SECONDS) * MAX_SIMULATION_STEP_SECONDS,
  };
}

function visualVector(from: CourtPoint, to: CourtPoint): CourtPoint {
  return { x: (to.x - from.x) * COURT_X_VISUAL_SCALE, y: to.y - from.y };
}

function coordinateVector(vector: CourtPoint): CourtPoint {
  return { x: vector.x / COURT_X_VISUAL_SCALE, y: vector.y };
}

function vectorLength(vector: CourtPoint) {
  return Math.hypot(vector.x, vector.y);
}

function desiredVelocity(from: CourtPoint, to: CourtPoint, maxVisualSpeed: number, slowArrival: boolean): CourtPoint {
  const visual = visualVector(from, to);
  const distance = vectorLength(visual);
  if (distance < 0.001) return { x: 0, y: 0 };
  const visualSpeed = slowArrival ? Math.min(maxVisualSpeed, distance * 2.7) : maxVisualSpeed;
  return coordinateVector({ x: (visual.x / distance) * visualSpeed, y: (visual.y / distance) * visualSpeed });
}

function approachVelocity(current: CourtPoint, desired: CourtPoint, maxVisualDelta: number): CourtPoint {
  const currentVisual = { x: current.x * COURT_X_VISUAL_SCALE, y: current.y };
  const desiredVisual = { x: desired.x * COURT_X_VISUAL_SCALE, y: desired.y };
  const delta = { x: desiredVisual.x - currentVisual.x, y: desiredVisual.y - currentVisual.y };
  const distance = vectorLength(delta);
  if (distance <= maxVisualDelta || distance < 0.001) return desired;
  return coordinateVector({
    x: currentVisual.x + (delta.x / distance) * maxVisualDelta,
    y: currentVisual.y + (delta.y / distance) * maxVisualDelta,
  });
}

function waypointReachedDistance(intent: MotionIntent, finalWaypoint: boolean) {
  if (!finalWaypoint) return WAYPOINT_REACHED_DISTANCE;
  return intent === "DRIVE" || intent === "ROLL" || intent === "CUT" || intent === "REBOUND"
    ? CONTACT_WAYPOINT_REACHED_DISTANCE
    : FINAL_WAYPOINT_REACHED_DISTANCE;
}

function cloneMotion(motion: CourtMotionState): CourtMotionState {
  return {
    ...motion,
    positions: Object.fromEntries(Object.entries(motion.positions).map(([id, point]) => [id, { ...point }])),
    velocities: Object.fromEntries(Object.entries(motion.velocities).map(([id, point]) => [id, { ...point }])),
    routes: Object.fromEntries(Object.entries(motion.routes).map(([id, route]) => [id, route.map((point) => ({ ...point }))])),
    intents: { ...motion.intents },
    ballFlight: motion.ballFlight
      ? { ...motion.ballFlight, start: { ...motion.ballFlight.start }, end: { ...motion.ballFlight.end } }
      : undefined,
  };
}

export function startBallFlight(
  motionState: CourtMotionState,
  fromPlayerId: string | undefined,
  toPlayerId: string,
  kind: BallFlightKind = "PASS",
  startOverride?: CourtPoint,
) {
  const motion = cloneMotion(motionState);
  const start = startOverride ?? (fromPlayerId ? motion.positions[fromPlayerId] : undefined);
  const end = motion.positions[toPlayerId];
  const passer = fromPlayerId ? playerById.get(fromPlayerId) : undefined;
  if (!start || !end) return motion;
  const metrics = calculatePassFlight(start, end, passer?.ratings.passSpeed ?? 70, kind);
  motion.ballFlight = {
    fromPlayerId,
    toPlayerId,
    start: { ...start },
    end: { ...end },
    elapsed: 0,
    kind,
    ...metrics,
    ...passFlightHeights(kind),
  };
  return motion;
}

/**
 * Start a pass-like flight from the passer to a FIXED catch point
 * (arrival-aware, P3). The end is frozen at release time: the ball never
 * homes toward a moving receiver, and the receiver runs onto the point.
 */
export function startPassFlight(
  motionState: CourtMotionState,
  fromPlayerId: string | undefined,
  toPlayerId: string,
  kind: BallFlightKindForPass,
  catchPoint?: CourtPoint,
): CourtMotionState {
  const motion = cloneMotion(motionState);
  const start = fromPlayerId ? motion.positions[fromPlayerId] : undefined;
  const end = catchPoint ?? (toPlayerId ? motion.positions[toPlayerId] : undefined);
  if (!start || !end) return motionState;
  const passer = fromPlayerId ? playerById.get(fromPlayerId) : undefined;
  const metrics = calculatePassFlight(start, end, passer?.ratings.passSpeed ?? 70, kind);
  motion.ballFlight = {
    fromPlayerId,
    toPlayerId,
    start: { ...start },
    end: { ...end },
    elapsed: 0,
    kind,
    ...metrics,
    ...passFlightHeights(kind),
  };
  return motion;
}

export function startFreeBallFlight(
  motionState: CourtMotionState,
  start: CourtPoint,
  end: CourtPoint,
  kind: "SHOT" | "FREE_THROW" | "RIM_REBOUND" | "LOOSE_BALL",
  options: {
    duration: number;
    startHeightMeters: number;
    endHeightMeters: number;
    apexHeightMeters: number;
    lateralCurve?: number;
    fromPlayerId?: string;
    toPlayerId?: string;
  },
) {
  const motion = cloneMotion(motionState);
  const distanceMeters = courtDistanceMeters(start, end);
  const duration = Math.max(0.18, options.duration);
  motion.ballFlight = {
    fromPlayerId: options.fromPlayerId,
    toPlayerId: options.toPlayerId,
    start: { ...start },
    end: { ...end },
    elapsed: 0,
    duration,
    distanceMeters: Math.round(distanceMeters * 100) / 100,
    speedMetersPerSecond: Math.round((distanceMeters / duration) * 100) / 100,
    kind,
    startHeightMeters: options.startHeightMeters,
    endHeightMeters: options.endHeightMeters,
    apexHeightMeters: options.apexHeightMeters,
    lateralCurve: options.lateralCurve,
  };
  return motion;
}

export function sampleBallFlight(flight: NonNullable<CourtMotionState["ballFlight"]>) {
  const progress = Math.min(1, Math.max(0, flight.elapsed / flight.duration));
  const lateral = Math.sin(Math.PI * progress) * (flight.lateralCurve ?? 0);
  const baselineHeight = flight.startHeightMeters + (flight.endHeightMeters - flight.startHeightMeters) * progress;
  const apexLift = Math.max(0, flight.apexHeightMeters - Math.max(flight.startHeightMeters, flight.endHeightMeters));
  const heightMeters = Math.max(0, baselineHeight + 4 * apexLift * progress * (1 - progress));
  return {
    x: flight.start.x + (flight.end.x - flight.start.x) * progress,
    y: flight.start.y + (flight.end.y - flight.start.y) * progress + lateral,
    heightMeters,
    progress,
  };
}

/**
 * Distinct trajectory profiles (P3): normal passes are the fastest and
 * flattest; bounce passes dip lower and arrive slower; outlet passes are
 * long and high; lobs and alley-oops hang high and arc late. This makes
 * every pass category visually distinguishable and gives the defense (and
 * the viewer) a real window to react.
 */
export function passFlightHeights(kind: BallFlightKind): {
  startHeightMeters: number;
  endHeightMeters: number;
  apexHeightMeters: number;
  speedScale: number;
} {
  if (kind === "BOUNCE") {
    return { startHeightMeters: 1.3, endHeightMeters: 0.5, apexHeightMeters: 1.75, speedScale: 0.92 };
  }
  if (kind === "LOB" || kind === "ALLEY_OOP") {
    return { startHeightMeters: 1.7, endHeightMeters: 1.6, apexHeightMeters: 3.9, speedScale: 0.82 };
  }
  if (kind === "HANDOFF") {
    return { startHeightMeters: 1.05, endHeightMeters: 1.05, apexHeightMeters: 1.18, speedScale: 1 };
  }
  if (kind === "INBOUND") {
    return { startHeightMeters: 1.35, endHeightMeters: 1.3, apexHeightMeters: 2.05, speedScale: 0.9 };
  }
  if (kind === "OUTLET") {
    return { startHeightMeters: 1.7, endHeightMeters: 1.25, apexHeightMeters: 2.9, speedScale: 0.86 };
  }
  // PASS: crisp, fast, low.
  return { startHeightMeters: 1.35, endHeightMeters: 1.25, apexHeightMeters: 2.15, speedScale: 1 };
}

/**
 * Catch-point prediction (P3): never extend the passer-to-receiver vector.
 * Instead, extrapolate where the receiver is already heading (its current
 * velocity or its first route waypoint) over a realistic flight window,
 * bound the extrapolation by receiver speed, fix that point at release
 * time, clamp it to the court, and never let it drag an established
 * frontcourt possession back across half-court.
 */
export function passCatchPoint(
  motion: CourtMotionState,
  fromPlayerId: string | undefined,
  toPlayerId: string,
  kind: BallFlightKind,
  frontcourtEstablished: boolean,
  possession: TeamSide,
): CourtPoint | undefined {
  const start = fromPlayerId ? motion.positions[fromPlayerId] : undefined;
  const receiverPoint = toPlayerId ? motion.positions[toPlayerId] : undefined;
  if (!start || !receiverPoint) return undefined;
  const passer = fromPlayerId ? playerById.get(fromPlayerId) : undefined;
  const receiver = toPlayerId ? playerById.get(toPlayerId) : undefined;
  const passerSpeed = passer?.ratings.passSpeed ?? 70;
  const flightTime = calculatePassFlight(start, receiverPoint, passerSpeed, kind).duration;
  const boundSeconds = Math.min(0.6, Math.max(0.18, flightTime));

  // Predict from actual movement: current velocity if moving, otherwise the
  // first remaining route waypoint (the receiver's declared destination).
  let predicted: CourtPoint = { ...receiverPoint };
  const velocity = motion.velocities[toPlayerId];
  const route = motion.routes[toPlayerId];
  if (velocity && (Math.abs(velocity.x) > 0.05 || Math.abs(velocity.y) > 0.05)) {
    predicted = {
      x: receiverPoint.x + velocity.x * boundSeconds,
      y: receiverPoint.y + velocity.y * boundSeconds,
    };
  } else if (route && route.length > 0) {
    predicted = { ...route[0] };
  }

  // Bound the prediction by how far the receiver can actually run in the
  // window (visual units per second from speedWithBall/acceleration).
  const receiverRating = receiver
    ? receiver.ratings.speed * 0.7 + receiver.ratings.acceleration * 0.3
    : 70;
  const maxReachVisual = Math.max(3.2, (8.2 + receiverRating * 0.14) * boundSeconds);
  const predictionDistance = courtVisualDistance(receiverPoint, predicted);
  if (predictionDistance > maxReachVisual) {
    const clampRatio = maxReachVisual / Math.max(0.001, predictionDistance);
    predicted = {
      x: receiverPoint.x + (predicted.x - receiverPoint.x) * clampRatio,
      y: receiverPoint.y + (predicted.y - receiverPoint.y) * clampRatio,
    };
  }

  const catchPoint = clampPoint(predicted);
  // Never manufacture a backcourt route: with frontcourt control already
  // established, the catch point must stay on the attacking half.
  if (frontcourtEstablished) {
    if (possession === "away" && catchPoint.x < 50) catchPoint.x = 50;
    if (possession === "home" && catchPoint.x > 50) catchPoint.x = 50;
  }
  return catchPoint;
}

function setRoute(motion: CourtMotionState, playerId: string | undefined, route: CourtPoint[], intent: MotionIntent) {
  if (!playerId || !playerById.has(playerId)) return;
  motion.routes[playerId] = route.map(clampPoint);
  motion.intents[playerId] = intent;
}

/** Engine-side routing helper (flow/controller): point one player at a target. */
export function routePlayerTo(motion: CourtMotionState, playerId: string, target: CourtPoint, intent: MotionIntent) {
  if (!playerById.has(playerId)) return motion;
  const next = cloneMotion(motion);
  next.routes[playerId] = [clampPoint({ ...target })];
  next.intents[playerId] = intent;
  return next;
}

export function attackRim(team: CourtPlayer["team"], y = 50): CourtPoint {
  return { x: team === "home" ? 11 : 89, y };
}

export type FreeThrowFormationRole = "SHOOTER" | "LANE_DEFENSE" | "LANE_OFFENSE" | "PERIMETER";

export function freeThrowLinePoint(team: CourtPlayer["team"]): CourtPoint {
  return { x: team === "home" ? 23.5 : 76.5, y: 50 };
}

function mirrorFreeThrowPoint(point: CourtPoint, team: CourtPlayer["team"]): CourtPoint {
  return team === "home" ? point : { x: 100 - point.x, y: point.y };
}

export function freeThrowFormation(shooterId: string, laneOccupied: boolean) {
  const shooter = playerById.get(shooterId);
  if (!shooter) throw new Error(`Unknown free-throw shooter: ${shooterId}`);
  const offense = players.filter((player) => player.team === shooter.team && player.id !== shooter.id)
    .sort((first, second) => second.ratings.offensiveRebound - first.ratings.offensiveRebound);
  const defense = players.filter((player) => player.team !== shooter.team)
    .sort((first, second) => second.ratings.defensiveRebound - first.ratings.defensiveRebound);
  const assignments: Record<string, { point: CourtPoint; role: FreeThrowFormationRole }> = {
    [shooter.id]: { point: freeThrowLinePoint(shooter.team), role: "SHOOTER" },
  };
  const perimeterPoints = [
    { x: 32, y: 17 }, { x: 32, y: 83 }, { x: 35, y: 30 },
    { x: 35, y: 70 }, { x: 39, y: 22 }, { x: 39, y: 78 },
    { x: 42, y: 38 }, { x: 42, y: 62 }, { x: 45, y: 50 },
  ].map((point) => mirrorFreeThrowPoint(point, shooter.team));
  if (!laneOccupied) {
    [...defense, ...offense].forEach((player, index) => {
      assignments[player.id] = { point: perimeterPoints[index], role: "PERIMETER" };
    });
    return assignments;
  }

  const laneDefensePoints = [
    { x: 14.2, y: 40.5 }, { x: 14.2, y: 59.5 }, { x: 20.2, y: 40.5 },
  ].map((point) => mirrorFreeThrowPoint(point, shooter.team));
  const laneOffensePoints = [
    { x: 17.2, y: 40.5 }, { x: 17.2, y: 59.5 },
  ].map((point) => mirrorFreeThrowPoint(point, shooter.team));
  defense.slice(0, 3).forEach((player, index) => {
    assignments[player.id] = { point: laneDefensePoints[index], role: "LANE_DEFENSE" };
  });
  offense.slice(0, 2).forEach((player, index) => {
    assignments[player.id] = { point: laneOffensePoints[index], role: "LANE_OFFENSE" };
  });
  const perimeterPlayers = [...defense.slice(3), ...offense.slice(2)];
  perimeterPlayers.forEach((player, index) => {
    assignments[player.id] = { point: perimeterPoints[index], role: "PERIMETER" };
  });
  return assignments;
}

export function applyFreeThrowFormation(
  state: MatchState,
  shooterId: string,
  laneOccupied: boolean,
  settle = false,
): MatchState {
  const assignments = freeThrowFormation(shooterId, laneOccupied);
  const motion = cloneMotion(state.motion);
  motion.ballFlight = undefined;
  for (const player of players) {
    const assignment = assignments[player.id];
    if (!assignment) continue;
    motion.routes[player.id] = settle ? [] : [{ ...assignment.point }];
    motion.velocities[player.id] = { x: 0, y: 0 };
    motion.intents[player.id] = "FREE_THROW";
    if (settle) motion.positions[player.id] = { ...assignment.point };
  }
  // The action owner represents the user-controlled piece, not the player who
  // happens to take an automatic free throw. Keeping it stable also ensures the
  // red control ring never jumps to a teammate during the cutscene.
  motion.lastActionOwnerId = state.controlledPlayerId;
  return { ...state, motion };
}

function threePointSpot(team: CourtPlayer["team"], upper: boolean): CourtPoint {
  return mirrorForTeam({ x: 31, y: upper ? 18 : 82 }, team);
}

function betweenBallAndRim(offender: CourtPlayer, point: CourtPoint, visualDistance = 11.2): CourtPoint {
  const rim = attackRim(offender.team);
  const towardRim = visualVector(point, rim);
  const length = Math.max(0.001, vectorLength(towardRim));
  const offset = coordinateVector({
    x: (towardRim.x / length) * visualDistance,
    y: (towardRim.y / length) * visualDistance,
  });
  return clampPoint({
    x: point.x + offset.x,
    y: point.y + offset.y,
  });
}

function assignedOffender(state: MatchState, defender: CourtPlayer) {
  if (defender.team === "home") return playerById.get(state.currentMatchups[defender.id]);
  const pairing = Object.entries(state.currentMatchups).find(([, defenderId]) => defenderId === defender.id);
  return pairing ? playerById.get(pairing[0]) : undefined;
}

function zoneAnchor(state: MatchState, player: CourtPlayer): CourtPoint {
  const anchors: Record<Position, CourtPoint> = {
    PG: { x: 71, y: 35 },
    SG: { x: 71, y: 65 },
    SF: { x: 82, y: 20 },
    PF: { x: 82, y: 80 },
    C: { x: 85, y: 50 },
  };
  const base = player.team === "home" ? anchors[player.position] : mirrorForTeam(anchors[player.position], "away");
  const handlerPoint = state.motion.positions[state.ballHandlerId];
  if (!handlerPoint) return base;
  const ballSideShift = Math.max(-11, Math.min(11, (handlerPoint.y - 50) * (player.position === "C" ? 0.12 : 0.24)));
  const depthShift = Math.max(-2.5, Math.min(2.5, (handlerPoint.x - base.x) * 0.08));
  return clampPoint({ x: base.x + depthShift, y: base.y + ballSideShift });
}

function automaticPhaseAnchor(state: MatchState, player: CourtPlayer): CourtPoint | null {
  const index = roleIndex[player.position];
  const offense = player.team === state.possession;
  const direction = state.possession === "home" ? -1 : 1;

  if (state.phase === "TIP_OFF" || state.phase === "PERIOD_END") {
    const side = player.team === "home" ? -1 : 1;
    return { x: 50 + side * (5 + index * 1.5), y: 16 + index * 17 };
  }

  if (state.phase === "DEAD_BALL" || state.phase === "INBOUND_READY") {
    const inboundX = state.possession === "home" ? 91 : 9;
    if (offense) {
      if (player.position === "C") return { x: inboundX, y: 50 };
      if (player.position === "PG") return { x: inboundX + direction * 12, y: 50 };
      return {
        x: inboundX + direction * (9 + index * 4),
        y: 14 + index * 18,
      };
    }
    return mirrorForTeam(baseHomeFormation[player.position], state.possession);
  }

  if (state.phase === "BACKCOURT_ADVANCE") {
    const progressX = state.possession === "home" ? 48 : 52;
    if (offense) return { x: progressX - direction * index * 3.2, y: 15 + index * 17.2 };
    return { x: progressX + direction * (9 + index * 2.4), y: 15 + index * 17.2 };
  }

  if (state.phase === "FASTBREAK") {
    const laneY = [50, 18, 82, 68, 36][index];
    if (offense) return { x: state.possession === "home" ? 15 + index * 3.2 : 85 - index * 3.2, y: laneY };
    return { x: state.possession === "home" ? 23 + index * 3.6 : 77 - index * 3.6, y: laneY + (index % 2 ? 3 : -3) };
  }

  return null;
}

function offenseAnchor(state: MatchState, player: CourtPlayer, clock: number): CourtPoint {
  const formation = state.activeTactic ? tacticHomeFormations[state.activeTactic] : baseHomeFormation;
  let anchor = state.homeTacticExecution && state.homeTacticExecution.tacticId === state.activeTactic
    ? homeTacticPoint(formation[player.position], state.homeTacticExecution, player.position, player.team)
    : mirrorForTeam(formation[player.position], player.team);
  if (player.id === state.ballHandlerId) {
    const handlerAnchor: CourtPoint = player.position === "C"
      ? { x: 23, y: 50 }
      : player.position === "PF"
        ? { x: 28, y: 50 }
        : { x: 42, y: 50 };
    anchor = mirrorForTeam(handlerAnchor, player.team);
  }
  const index = roleIndex[player.position];
  const pulse = clock * 1.16 + index * 1.37;
  const amplitude = player.position === "C" || player.position === "PF" ? 1.08 : 1.45;
  anchor = {
    x: anchor.x + Math.cos(pulse * 0.72) * 0.82,
    y: anchor.y + Math.sin(pulse) * amplitude,
  };
  return clampPoint(anchor);
}

function defenseAnchor(state: MatchState, player: CourtPlayer, clock: number): CourtPoint {
  if (state.defenseScheme === "ZONE_2_3" && player.team === "home" && state.possession === "away") {
    const anchor = zoneAnchor(state, player);
    const pulse = clock * 0.9 + roleIndex[player.position];
    return clampPoint({ x: anchor.x + Math.cos(pulse) * 0.45, y: anchor.y + Math.sin(pulse) * 0.7 });
  }
  const offender = assignedOffender(state, player);
  if (!offender) return state.motion.positions[player.id] ?? { x: player.x, y: player.y };
  const offenderPoint = state.motion.positions[offender.id] ?? { x: offender.x, y: offender.y };
  let target = betweenBallAndRim(offender, offenderPoint, player.position === "C" ? 10.4 : 11.4);
  if ((player.position === "PF" || player.position === "C") && offender.id !== state.ballHandlerId) {
    const help = attackRim(offender.team);
    const helpAnchor = { x: help.x + (offender.team === "home" ? 9 : -9), y: 50 };
    target = {
      x: target.x * 0.76 + helpAnchor.x * 0.24,
      y: target.y * 0.76 + helpAnchor.y * 0.24,
    };
  }
  const index = roleIndex[player.position];
  const footwork = Math.sin(clock * 1.45 + index * 1.21) * (player.position === "C" ? 0.42 : 0.72);
  const towardRim = visualVector(offenderPoint, attackRim(offender.team));
  const length = Math.max(0.001, vectorLength(towardRim));
  const tangent = coordinateVector({ x: (-towardRim.y / length) * footwork, y: (towardRim.x / length) * footwork });
  return clampPoint({ x: target.x + tangent.x, y: target.y + tangent.y });
}

function automaticTarget(state: MatchState, player: CourtPlayer, clock: number): CourtPoint {
  const automatic = automaticPhaseAnchor(state, player);
  if (automatic) return clampPoint(automatic);
  return player.team === state.possession ? offenseAnchor(state, player, clock) : defenseAnchor(state, player, clock);
}

function controlledMayAutoMove(state: MatchState) {
  return (
    state.phase === "DEAD_BALL" ||
    state.phase === "INBOUND_READY" ||
    state.phase === "BACKCOURT_ADVANCE" ||
    state.phase === "FASTBREAK" ||
    state.phase === "PERIOD_END" ||
    state.phase === "TIP_OFF"
  );
}

function samePair(firstId: string, secondId: string, left: string | undefined, right: string | undefined) {
  return (firstId === left && secondId === right) || (firstId === right && secondId === left);
}

function isResolvedScreenContactPair(state: MatchState, firstId: string, secondId: string) {
  const screen = state.screen;
  if (!screen) return false;
  return samePair(firstId, secondId, screen.handlerId, screen.screenerId)
    || samePair(firstId, secondId, screen.screenerId, screen.handlerDefenderBefore)
    || samePair(firstId, secondId, screen.screenerId, screen.screenerDefenderBefore);
}

function isOpponentTacticContactPair(state: MatchState, first: CourtPlayer, second: CourtPlayer) {
  const offense = state.opponentOffense;
  if (!offense || first.team !== "away" || second.team !== "away") return false;
  const stage = getOpponentTactic(offense.playId).stages[offense.stageIndex];
  return Boolean(stage?.contactPairs?.some(([left, right]) => (
    (first.position === left && second.position === right)
    || (first.position === right && second.position === left)
  )));
}

function minimumPairGap(state: MatchState, motion: CourtMotionState, firstId: string, secondId: string) {
  const first = playerById.get(firstId);
  const second = playerById.get(secondId);
  if (!first || !second) return 11.7;
  if (state.phase === "FREE_THROW") return 5.8;
  if (
    isResolvedScreenContactPair(state, firstId, secondId)
    || isHomeTacticContactPair(state.homeTacticExecution, first, second)
    || isOpponentTacticContactPair(state, first, second)
  ) return 9.1;
  if (motion.intents[firstId] === "REBOUND" && motion.intents[secondId] === "REBOUND") return 10.6;
  if (state.currentMatchups[firstId] === secondId || state.currentMatchups[secondId] === firstId) return 11.1;
  return first.team === second.team ? TEAMMATE_SPACING_VISUAL : 11.9;
}

function canSpacingMoveControlled(state: MatchState, motion: CourtMotionState) {
  return controlledMayAutoMove(state) || (motion.routes[state.controlledPlayerId]?.length ?? 0) > 0;
}

function resolveCourtSpacing(state: MatchState, motion: CourtMotionState, step: number) {
  const ids = players.map((player) => player.id);
  const controlledCanMove = canSpacingMoveControlled(state, motion);
  const correctionCap = 1.4 * Math.max(0.4, step / MAX_SIMULATION_STEP_SECONDS);

  for (let pass = 0; pass < 3; pass += 1) {
    for (let firstIndex = 0; firstIndex < ids.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < ids.length; secondIndex += 1) {
        const firstId = ids[firstIndex];
        const secondId = ids[secondIndex];
        const firstPoint = motion.positions[firstId];
        const secondPoint = motion.positions[secondId];
        let visual = {
          x: (firstPoint.x - secondPoint.x) * COURT_X_VISUAL_SCALE,
          y: firstPoint.y - secondPoint.y,
        };
        let distance = vectorLength(visual);
        const minimum = minimumPairGap(state, motion, firstId, secondId);
        if (distance >= minimum) continue;
        if (distance < 0.001) {
          const direction = (firstIndex * 7 + secondIndex * 11) % 4;
          visual = direction % 2 === 0 ? { x: direction === 0 ? 1 : -1, y: 0 } : { x: 0, y: direction === 1 ? 1 : -1 };
          distance = 1;
        }
        const overlap = Math.min(minimum - distance, correctionCap);
        const firstLocked = firstId === state.controlledPlayerId && !controlledCanMove;
        const secondLocked = secondId === state.controlledPlayerId && !controlledCanMove;
        const firstShare = firstLocked ? 0 : secondLocked ? 1 : 0.5;
        const secondShare = secondLocked ? 0 : firstLocked ? 1 : 0.5;
        const unit = { x: visual.x / distance, y: visual.y / distance };
        const firstOffset = coordinateVector({ x: unit.x * overlap * firstShare, y: unit.y * overlap * firstShare });
        const secondOffset = coordinateVector({ x: unit.x * overlap * secondShare, y: unit.y * overlap * secondShare });
        motion.positions[firstId] = clampPoint({ x: firstPoint.x + firstOffset.x, y: firstPoint.y + firstOffset.y });
        motion.positions[secondId] = clampPoint({ x: secondPoint.x - secondOffset.x, y: secondPoint.y - secondOffset.y });
      }
    }
  }
}

export function advanceCourtMotion(state: MatchState, seconds: number): MatchState {
  if (!Number.isFinite(seconds) || seconds <= 0 || state.phase === "FINAL") return state;
  const motion = cloneMotion(state.motion);
  let remaining = seconds;

  while (remaining > 0.000_1) {
    const step = Math.min(remaining, MAX_SIMULATION_STEP_SECONDS);
    const referenceMotion: CourtMotionState = {
      ...motion,
      positions: Object.fromEntries(Object.entries(motion.positions).map(([id, point]) => [id, { ...point }])),
    };
    const targetClock = motion.clock + step;
    const nextPositions: Record<string, CourtPoint> = {};
    const nextVelocities: Record<string, CourtPoint> = {};
    const nextRoutes: Record<string, CourtPoint[]> = {};

    for (const player of players) {
      const point = referenceMotion.positions[player.id] ?? { x: player.x, y: player.y };
      let currentVelocity = motion.velocities[player.id] ?? { x: 0, y: 0 };
      const route = [...(motion.routes[player.id] ?? [])];
      const intent = motion.intents[player.id] ?? "HOLD";
      let consumedFinalWaypoint = false;
      while (
        route.length > 0 &&
        courtVisualDistance(point, route[0]) <= waypointReachedDistance(intent, route.length === 1)
      ) {
        consumedFinalWaypoint ||= route.length === 1;
        route.shift();
      }
      if (consumedFinalWaypoint && player.id === state.controlledPlayerId) currentVelocity = { x: 0, y: 0 };
      const canAutoMove = player.id !== state.controlledPlayerId || controlledMayAutoMove(state);
      const target = route[0] ?? (canAutoMove ? automaticTarget({ ...state, motion: referenceMotion }, player, targetClock) : null);
      const speedRating = intent === "HANDLE" || intent === "DRIVE"
        ? player.ratings.speedWithBall * 0.7 + player.ratings.acceleration * 0.3
        : player.ratings.speed * 0.72 + player.ratings.acceleration * 0.28;
      const maxVisualSpeed = 11.5 + speedRating * 0.17;
      const maxVisualAcceleration = 48 + player.ratings.acceleration * 0.62;
      const requestedVelocity = target
        ? desiredVelocity(point, target, maxVisualSpeed, route.length <= 1)
        : { x: 0, y: 0 };
      let velocity = approachVelocity(currentVelocity, requestedVelocity, maxVisualAcceleration * step);
      let nextPoint = clampPoint({ x: point.x + velocity.x * step, y: point.y + velocity.y * step });

      if (target && route.length > 0) {
        const before = visualVector(point, target);
        const after = visualVector(nextPoint, target);
        const passedTarget = before.x * after.x + before.y * after.y <= 0;
        const reachedDistance = waypointReachedDistance(intent, route.length === 1) * (route.length === 1 ? 1 : 0.55);
        if (passedTarget || courtVisualDistance(nextPoint, target) <= reachedDistance) {
          nextPoint = clampPoint(target);
          const finishedRoute = route.length === 1;
          route.shift();
          if (finishedRoute) velocity = { x: 0, y: 0 };
        }
      }

      nextPositions[player.id] = nextPoint;
      nextVelocities[player.id] = velocity;
      nextRoutes[player.id] = route;
      if (route.length === 0) {
        motion.intents[player.id] = player.id === state.controlledPlayerId
          ? player.id === state.ballHandlerId ? "HANDLE" : "HOLD"
          : player.team === state.possession ? (player.id === state.ballHandlerId ? "HANDLE" : "SPACE") : "CONTAIN";
      }
    }

    motion.positions = nextPositions;
    motion.velocities = nextVelocities;
    motion.routes = nextRoutes;
    motion.clock = targetClock;
    if (motion.ballFlight) {
      motion.ballFlight.elapsed = Math.min(motion.ballFlight.duration, motion.ballFlight.elapsed + step);
      // P3: the flight target is fixed at release (the catch point), so the
      // ball never homes toward a moving receiver. The end stays exactly the
      // fixed point the flight was launched at.
      if (motion.ballFlight.elapsed >= motion.ballFlight.duration - 0.000_1) motion.ballFlight = undefined;
    }
    resolveCourtSpacing(state, motion, step);
    remaining -= step;
  }

  motion.clock = Math.round(motion.clock * 1_000) / 1_000;
  motion.frame += 1;
  return { ...state, motion };
}

function routeForTactic(
  state: MatchState,
  player: CourtPlayer,
  tactic: NonNullable<MatchState["activeTactic"]>,
  execution: HomeTacticExecution,
) {
  const point = (target: CourtPoint) => homeTacticPoint(target, execution, player.position, player.team);
  const final = point(tacticHomeFormations[tactic][player.position]);
  if (tactic === "HANDOFF") {
    if (player.position === "PG") return [point({ x: execution.variant === 1 ? 32 : 38, y: 45 }), final];
    if (player.position === "SG") return [point({ x: 38, y: execution.variant === 2 ? 47 : 52 }), final];
  }
  if (tactic === "STAGGER" && player.id === execution.primaryPlayerId) {
    const middle = execution.variant === 1 ? { x: 23, y: 51 } : execution.variant === 2 ? { x: 18, y: 88 } : { x: 24, y: 55 };
    return [point({ x: 20, y: 78 }), point(middle), final];
  }
  if (tactic === "HORNS" && (player.position === "PF" || player.position === "C")) {
    const elbowY = player.position === "PF" ? 38 : 62;
    const readPoint = execution.variant === 2 && player.position === "C" ? { x: 17, y: 50 } : { x: 34, y: elbowY };
    return [point(readPoint), final];
  }
  if (tactic === "FIVE_OUT" && player.id === execution.primaryPlayerId) {
    const readPoint = execution.variant === 0
      ? { x: 18, y: 50 }
      : execution.variant === 1
        ? { x: 36, y: 45 }
        : { x: 29, y: player.position === "SF" ? 78 : 24 };
    return [point(readPoint), final];
  }
  return [final];
}

export function applyTacticMotion(state: MatchState, tactic: NonNullable<MatchState["activeTactic"]>): MatchState {
  const execution = state.homeTacticExecution;
  if (!execution || execution.tacticId !== tactic) return state;
  const motion = cloneMotion(state.motion);
  for (const player of players.filter((candidate) => candidate.team === state.possession)) {
    const intent: MotionIntent = player.id === state.ballHandlerId ? "HANDLE" : homeTacticIntent(execution, player);
    setRoute(motion, player.id, routeForTactic(state, player, tactic, execution), intent);
  }
  motion.lastActionOwnerId = state.controlledPlayerId;
  return { ...state, motion };
}

function opponentStagePoint(
  point: CourtPoint,
  side: "UPPER" | "LOWER",
  variant: 0 | 1 | 2,
  position: Position,
) {
  const index = roleIndex[position];
  const depthShift = variant === 1 ? (index % 2 === 0 ? 1.4 : -1.1) : variant === 2 ? (index < 2 ? -1.6 : 1.25) : 0;
  const laneShift = variant === 1 ? (index - 2) * 0.82 : variant === 2 ? (2 - index) * 0.68 : 0;
  const mirroredY = side === "UPPER" ? point.y : 100 - point.y;
  return clampPoint({
    x: 100 - point.x + depthShift,
    y: mirroredY + (side === "UPPER" ? laneShift : -laneShift),
  });
}

function opponentMotionIntent(intent: OpponentIntent): MotionIntent {
  if (intent === "CUT") return "CUT";
  if (intent === "DRIVE") return "DRIVE";
  if (intent === "BALL_SCREEN") return "SCREEN";
  if (intent === "SHOOT") return "SHOOT";
  if (intent === "HANDOFF" || intent === "PASS") return "RECEIVE";
  return "SPACE";
}

/**
 * Applies the motion (routes) for the opponent's current stage.
 *
 * Pass-arrival model (P3): when a stage transition moves the ball to a new
 * handler, the rules commit does NOT reassign ballHandlerId anymore. The
 * caller passes the intended receiver as `deferredHandlerId`; here we
 * freeze a catch point and launch a real pass flight toward it. Control
 * transfers only when the engine completes the arrival (see
 * completePassArrival in flow.ts). The receiver is routed onto the fixed
 * catch point and continues to his stage target after the catch.
 *
 * `previousBallHandlerId` is retained only for the legacy decorative-flight
 * branch used by offense activation (ball pickup, no pass).
 */
export function applyOpponentStageMotion(
  state: MatchState,
  previousBallHandlerId?: string,
  deferredHandlerId?: string,
): MatchState {
  const offense = state.opponentOffense;
  if (!offense || state.possession !== "away") return state;
  const tactic = getOpponentTactic(offense.playId);
  const stage = tactic.stages[offense.stageIndex] ?? tactic.stages.at(-1)!;
  let motion = cloneMotion(state.motion);

  for (const player of players.filter((candidate) => candidate.team === "away")) {
    const via = stage.via?.[player.position] ?? [];
    const target = stage.targets[player.position];
    const route = [...via, target].map((point) => opponentStagePoint(point, offense.side, offense.variant, player.position));
    let intent = player.id === state.ballHandlerId ? "HANDLE" : opponentMotionIntent(stage.intent);
    if (offense.pendingAttempt?.shooterId === player.id) intent = "SHOOT";
    if (offense.pendingAttempt && (player.position === "PF" || player.position === "C") && player.id !== offense.pendingAttempt.shooterId) {
      route.push(attackRim("away", player.position === "C" ? 47 : 58));
      intent = "REBOUND";
    }
    setRoute(motion, player.id, route, intent);
  }

  for (const defender of players.filter((candidate) => candidate.team === "home" && candidate.id !== state.controlledPlayerId)) {
    if (state.defenseScheme === "ZONE_2_3") {
      setRoute(motion, defender.id, [zoneAnchor(state, defender)], defender.position === "C" ? "ZONE_RIM" : defender.position === "PG" ? "ZONE_TOP" : "ZONE_WING");
      continue;
    }
    const offender = playerById.get(state.currentMatchups[defender.id]);
    if (!offender) continue;
    const offenderTarget = opponentStagePoint(stage.targets[offender.position], offense.side, offense.variant, offender.position);
    setRoute(motion, defender.id, [betweenBallAndRim(offender, offenderTarget, defender.position === "C" ? 10.2 : 11)], offense.pendingAttempt?.shooterId === offender.id ? "CONTEST" : "CONTAIN");
  }

  motion.routes[state.controlledPlayerId] = [];
  motion.velocities[state.controlledPlayerId] = { x: 0, y: 0 };
  motion.intents[state.controlledPlayerId] = state.controlledPlayerId === state.ballHandlerId ? "HANDLE" : "HOLD";
  motion.lastActionOwnerId = undefined;
  if (deferredHandlerId && deferredHandlerId !== state.ballHandlerId) {
    // Arrival-aware AI pass: ball leaves the current handler toward a fixed
    // catch point; the handler changes only when the engine completes the
    // arrival. Kind reflects the pass type (handoff / pocket bounce / lob).
    const kind: BallFlightKindForPass = stage.intent === "HANDOFF"
      ? "HANDOFF"
      : state.screen?.route === "ROLL" || state.screen?.route === "SHORT_ROLL"
        ? "BOUNCE"
        : offense.pendingAttempt
          ? "PASS"
          : "PASS";
    const catchPoint = passCatchPoint(motion, state.ballHandlerId, deferredHandlerId, kind, state.frontcourtEstablished, state.possession)
      ?? motion.positions[deferredHandlerId];
    motion = startPassFlight(motion, state.ballHandlerId, deferredHandlerId, kind, catchPoint);
    // The receiver runs onto the fixed catch point instead of the ball
    // homing toward a moving target.
    setRoute(motion, deferredHandlerId, [catchPoint], "RECEIVE");
    return { ...state, motion };
  }
  if (previousBallHandlerId && previousBallHandlerId !== state.ballHandlerId) {
    // Legacy decorative branch: activation / direct pickup (no real pass).
    const kind: BallFlightKindForPass = stage.intent === "HANDOFF" ? "HANDOFF" : "PASS";
    motion = startPassFlight(motion, previousBallHandlerId, state.ballHandlerId, kind);
    setRoute(motion, state.ballHandlerId, [motion.positions[state.ballHandlerId]], "RECEIVE");
  }
  return { ...state, motion };
}

export function cancelCourtRoutes(motionState: CourtMotionState): CourtMotionState {
  const motion = cloneMotion(motionState);
  for (const player of players) {
    motion.routes[player.id] = [];
    motion.velocities[player.id] = { x: 0, y: 0 };
    motion.intents[player.id] = "HOLD";
  }
  motion.lastActionOwnerId = undefined;
  motion.ballFlight = undefined;
  return motion;
}

export function applyReboundContestMotion(state: MatchState): MatchState {
  const resolution = state.pendingRebound?.resolution;
  if (!resolution) return state;
  const motion = cloneMotion(state.motion);
  const ranked = [...resolution.candidates].sort((first, second) =>
    first.playerId === resolution.winnerId
      ? -1
      : second.playerId === resolution.winnerId
        ? 1
        : second.score - first.score,
  );
  const contestIds = new Set(ranked.slice(0, 7).map((candidate) => candidate.playerId));
  const contestOrder = new Map(ranked.map((candidate, index) => [candidate.playerId, index]));
  for (const player of players) {
    if (contestIds.has(player.id)) {
      const index = contestOrder.get(player.id) ?? 0;
      const angle = (index * Math.PI * 2) / 7;
      const radius = player.id === resolution.winnerId ? 0 : 5.8 + (index % 2) * 1.4;
      const target = clampPoint({
        x: resolution.landingPoint.x + Math.cos(angle) * radius / COURT_X_VISUAL_SCALE,
        y: resolution.landingPoint.y + Math.sin(angle) * radius,
      });
      setRoute(motion, player.id, [target], "REBOUND");
      continue;
    }
    const retreatX = resolution.attackingTeam === "home" ? 47 : 53;
    setRoute(
      motion,
      player.id,
      [{ x: retreatX, y: player.position === "PG" || player.position === "SF" ? 21 : 79 }],
      "TRANSITION",
    );
  }
  motion.lastActionOwnerId = undefined;
  return { ...state, motion };
}

function screenMotion(previous: MatchState, next: MatchState, motion: CourtMotionState) {
  const screen = next.screen;
  if (!screen) return;
  const handler = playerById.get(screen.handlerId);
  const screener = playerById.get(screen.screenerId);
  if (!handler || !screener) return;
  const handlerPoint = previous.motion.positions[handler.id];
  if (!handlerPoint) return;
  const towardRim = handler.team === "home" ? -1 : 1;
  const screenPoint = { x: handlerPoint.x + towardRim * 6.4, y: handlerPoint.y + (handlerPoint.y < 50 ? 1.8 : -1.8) };
  const routeTarget =
    screen.route === "POP"
      ? threePointSpot(screener.team, handlerPoint.y < 50)
      : screen.route === "SHORT_ROLL"
        ? mirrorForTeam({ x: 25, y: 50 }, screener.team)
        : attackRim(screener.team, handlerPoint.y < 50 ? 43 : 57);
  setRoute(motion, screener.id, [screenPoint, routeTarget], screen.route === "POP" ? "POP" : "ROLL");
  setRoute(motion, handler.id, [{ x: handlerPoint.x + towardRim * 7, y: handlerPoint.y + (handlerPoint.y < 50 ? 7 : -7) }], "HANDLE");
  const handlerDefender = previous.currentMatchups[screen.handlerId];
  const screenerDefender = previous.currentMatchups[screen.screenerId];
  const handlerRouteTarget = { x: handlerPoint.x + towardRim * 7, y: handlerPoint.y + (handlerPoint.y < 50 ? 7 : -7) };
  const guardHandler = betweenBallAndRim(handler, handlerRouteTarget, 10.7);
  const guardScreener = betweenBallAndRim(screener, routeTarget, 10.3);
  setRoute(
    motion,
    handlerDefender,
    [betweenBallAndRim(handler, handlerPoint, 10.7), screen.coverage === "SWITCH" ? guardScreener : guardHandler],
    screen.coverage === "SWITCH" ? "SWITCH" : "CONTAIN",
  );
  setRoute(
    motion,
    screenerDefender,
    [betweenBallAndRim(screener, screenPoint, 10.3), screen.coverage === "SWITCH" ? guardHandler : guardScreener],
    screen.coverage === "SWITCH" ? "SWITCH" : "CONTAIN",
  );
}

export function applyActionMotion(previous: MatchState, next: MatchState, actionId: ActionMotionId): MatchState {
  if (next === previous) return next;
  let motion = cloneMotion(next.motion);
  motion.lastActionOwnerId = previous.controlledPlayerId;
  const phaseOwnsMovement = next.phase !== previous.phase && (
    next.phase === "DEAD_BALL" ||
    next.phase === "INBOUND_READY" ||
    next.phase === "BACKCOURT_ADVANCE" ||
    next.phase === "FASTBREAK" ||
    next.phase === "FREE_THROW" ||
    next.phase === "PERIOD_END" ||
    next.phase === "TIP_OFF" ||
    next.phase === "FINAL"
  );
  if (phaseOwnsMovement) return { ...next, motion };
  const controlled = playerById.get(previous.controlledPlayerId);
  if (!controlled) return { ...next, motion };
  const controlledPoint = previous.motion.positions[controlled.id] ?? { x: controlled.x, y: controlled.y };
  const eventKind = next.eventLog.at(-1)?.kind;
  const onBall = previous.possession === "home" && previous.ballHandlerId === controlled.id;

  if (previous.possession === next.possession && previous.ballHandlerId !== next.ballHandlerId) {
    // Legacy visual flight only (handler already changed in the commit —
    // kept for paths not yet migrated to pass-arrival). Migrated passes use
    // pendingPass + PASS_RELEASE and never reach this branch.
    const kind: BallFlightKindForPass = eventKind === "LOB" || eventKind === "ALLEY_OOP"
      ? "ALLEY_OOP"
      : actionId === "drive" || actionId === "screen" || next.phase === "FASTBREAK"
        ? "BOUNCE"
        : "PASS";
    const catchPoint = passCatchPoint(motion, previous.ballHandlerId, next.ballHandlerId, kind, next.frontcourtEstablished, next.possession);
    motion = startPassFlight(motion, previous.ballHandlerId, next.ballHandlerId, kind, catchPoint);
    motion.lastActionOwnerId = previous.controlledPlayerId;
  }

  if (actionId === "screen") {
    screenMotion(previous, next, motion);
  } else if (onBall && actionId === "pass") {
    if (eventKind === "PASS" || eventKind === "RETURN_PASS" || eventKind === "DRIVE_KICK") {
      setRoute(motion, controlled.id, [threePointSpot(controlled.team, controlledPoint.y < 50)], "SPACE");
      const receiver = playerById.get(next.ballHandlerId);
      const catchPoint = motion.ballFlight?.end;
      if (receiver) setRoute(motion, receiver.id, [catchPoint ?? offenseAnchor(next, receiver, next.motion.clock)], "RECEIVE");
    }
  } else if (onBall && actionId === "drive") {
    const rim = attackRim(controlled.team, 50);
    const drivePoint = mirrorForTeam({ x: 28, y: 50 }, controlled.team);
    const pendingDrive = next.pendingDrive ?? previous.pendingDrive;
    setRoute(motion, controlled.id, pendingDrive?.laneOpenAtStart ? [rim] : [drivePoint, rim], "DRIVE");
    const primary = previous.currentMatchups[controlled.id];
    if (pendingDrive?.laneOpenAtStart) {
      const primaryPoint = previous.motion.positions[primary];
      const chaseY = primaryPoint?.y && primaryPoint.y < 50 ? 42 : 58;
      setRoute(motion, primary, [mirrorForTeam({ x: 19, y: chaseY }, controlled.team)], "CONTAIN");
    } else {
      setRoute(motion, primary, [betweenBallAndRim(controlled, drivePoint, 10.7), mirrorForTeam({ x: 17, y: 57 }, controlled.team)], "CONTAIN");
      const helperId = pendingDrive?.rimProtectorId;
      if (helperId && helperId !== primary) {
        setRoute(motion, helperId, [mirrorForTeam({ x: 18, y: 42 }, controlled.team)], "CONTEST");
      }
    }
  } else if (onBall && actionId === "shoot") {
    setRoute(motion, controlled.id, [{ x: controlledPoint.x, y: controlledPoint.y - 1.4 }], "SHOOT");
    const defenderId = previous.currentMatchups[controlled.id];
    const closeout = betweenBallAndRim(controlled, controlledPoint, 10.6);
    setRoute(motion, defenderId, [closeout], "CONTEST");
    for (const player of players.filter((candidate) => candidate.position === "C" || candidate.position === "PF")) {
      setRoute(motion, player.id, [attackRim(controlled.team, player.team === controlled.team ? 56 : 44)], "REBOUND");
    }
  } else if (!onBall && previous.possession === "home" && actionId === "request") {
    setRoute(motion, controlled.id, [mirrorForTeam({ x: 38, y: controlledPoint.y < 50 ? 34 : 66 }, controlled.team)], "RECEIVE");
  } else if (!onBall && previous.possession === "home" && actionId === "cut") {
    const received = next.ballHandlerId === controlled.id;
    const rim = attackRim(controlled.team, controlledPoint.y < 50 ? 43 : 57);
    setRoute(motion, controlled.id, received ? [rim] : [rim, threePointSpot(controlled.team, controlledPoint.y < 50)], "CUT");
  } else if (!onBall && previous.possession === "home" && actionId === "spot") {
    setRoute(motion, controlled.id, [threePointSpot(controlled.team, controlledPoint.y < 50)], "SPACE");
  } else if (previous.possession === "away") {
    const handler = playerById.get(previous.ballHandlerId);
    const handlerPoint = handler ? previous.motion.positions[handler.id] : undefined;
    if (handler && handlerPoint && (actionId === "contain" || actionId === "steal" || actionId === "contest")) {
      const target = actionId === "contain" ? betweenBallAndRim(handler, handlerPoint, 10.8) : handlerPoint;
      setRoute(motion, controlled.id, [target], actionId === "contain" ? "CONTAIN" : actionId === "steal" ? "STEAL" : "CONTEST");
    }
    if (actionId === "switch") {
      const newOpponent = playerById.get(next.currentMatchups[controlled.id]);
      if (newOpponent) setRoute(motion, controlled.id, [betweenBallAndRim(newOpponent, next.motion.positions[newOpponent.id], 10.8)], "SWITCH");
      const swappedHome = Object.entries(next.currentMatchups).find(([homeId, awayId]) => homeId !== controlled.id && awayId === previous.currentMatchups[controlled.id]);
      if (swappedHome) {
        const opponent = playerById.get(swappedHome[1]);
        if (opponent) setRoute(motion, swappedHome[0], [betweenBallAndRim(opponent, next.motion.positions[opponent.id], 10.8)], "SWITCH");
      }
    }
    if (actionId === "zone") {
      for (const teammate of players.filter((player) => player.team === "home")) {
        const intent: MotionIntent = teammate.position === "PG" ? "ZONE_TOP" : teammate.position === "C" ? "ZONE_RIM" : "ZONE_WING";
        const target = next.defenseScheme === "ZONE_2_3" ? zoneAnchor(next, teammate) : defenseAnchor(next, teammate, next.motion.clock);
        setRoute(motion, teammate.id, [target], intent);
      }
    }
  }

  return { ...next, motion };
}

export function assertMotionInvariants(state: MatchState) {
  const errors: string[] = [];
  for (const player of players) {
    const point = state.motion.positions[player.id];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) errors.push(`missing position ${player.id}`);
    else if (point.x < MIN_X || point.x > MAX_X || point.y < MIN_Y || point.y > MAX_Y) errors.push(`out of bounds ${player.id}`);
    const velocity = state.motion.velocities[player.id];
    if (!velocity || !Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) errors.push(`invalid velocity ${player.id}`);
    for (const waypoint of state.motion.routes[player.id] ?? []) {
      if (!Number.isFinite(waypoint.x) || !Number.isFinite(waypoint.y)) errors.push(`invalid waypoint ${player.id}`);
      else if (waypoint.x < MIN_X || waypoint.x > MAX_X || waypoint.y < MIN_Y || waypoint.y > MAX_Y) errors.push(`waypoint out of bounds ${player.id}`);
    }
  }
  if (Object.keys(state.motion.positions).length !== players.length) errors.push("position count mismatch");
  if (Object.keys(state.motion.velocities).length !== players.length) errors.push("velocity count mismatch");
  if (state.motion.ballFlight) {
    const flight = state.motion.ballFlight;
    if (flight.toPlayerId && !playerById.has(flight.toPlayerId)) errors.push("invalid ball flight receiver");
    if (!Number.isFinite(flight.duration) || flight.duration <= 0 || flight.elapsed < 0 || flight.elapsed > flight.duration + 0.001) {
      errors.push("invalid ball flight clock");
    }
    if (!Number.isFinite(flight.distanceMeters) || !Number.isFinite(flight.speedMetersPerSecond)) errors.push("invalid ball flight metrics");
    if (
      !Number.isFinite(flight.startHeightMeters) ||
      !Number.isFinite(flight.endHeightMeters) ||
      !Number.isFinite(flight.apexHeightMeters) ||
      flight.startHeightMeters < 0 ||
      flight.endHeightMeters < 0 ||
      flight.apexHeightMeters < Math.max(flight.startHeightMeters, flight.endHeightMeters)
    ) errors.push("invalid ball flight height");
  }
  if (state.motion.lastActionOwnerId && state.motion.lastActionOwnerId !== state.controlledPlayerId) errors.push("action owner changed");
  if (errors.length > 0) throw new Error(errors.join("; "));
  return true;
}
