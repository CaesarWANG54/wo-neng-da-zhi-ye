import { nextRandom } from "./core";
import { courtDistanceMeters } from "./movement";
import type {
  CourtPlayer,
  CourtPoint,
  MatchState,
  MissCollision,
  Ratings,
  ReboundCandidate,
  ReboundResolutionState,
  TeamSide,
} from "./types";

const COURT_LENGTH_METERS = 28.65;
const COURT_WIDTH_METERS = 15.24;
const MIN_LANDING_X = 5;
const MAX_LANDING_X = 95;
const MIN_LANDING_Y = 5;
const MAX_LANDING_Y = 95;
const REBOUND_SOFTMAX_TEMPERATURE = 7.5;

export interface MissTrajectory {
  collision: MissCollision;
  landingPoint: CourtPoint;
  rimContacted: boolean;
  shotDistanceMeters: number;
  reboundDistanceMeters: number;
  longRebound: boolean;
  seed: number;
}

export interface ResolveMissedShotInput {
  state: MatchState;
  roster: readonly CourtPlayer[];
  shooterId: string;
  shotOrigin: CourtPoint;
  rim: CourtPoint;
  seed?: number;
}

export interface OutletCandidate {
  playerId: string;
  score: number;
  distanceMeters: number;
  nearestDefenderMeters: number;
  handlingScore: number;
}

export interface DefensiveOutletDecision {
  rebounderId: string;
  receiverId: string;
  shouldPass: boolean;
  risk: number;
  candidates: OutletCandidate[];
  explanation: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, places = 3) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function positionOf(state: MatchState, player: CourtPlayer): CourtPoint {
  return state.motion.positions[player.id] ?? { x: player.x, y: player.y };
}

function physicalVector(from: CourtPoint, to: CourtPoint) {
  return {
    x: ((to.x - from.x) / 100) * COURT_LENGTH_METERS,
    y: ((to.y - from.y) / 100) * COURT_WIDTH_METERS,
  };
}

function normalize(vector: CourtPoint): CourtPoint {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 0.000_001) return { x: 1, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

function rotate(vector: CourtPoint, radians: number): CourtPoint {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: vector.x * cosine - vector.y * sine,
    y: vector.x * sine + vector.y * cosine,
  };
}

function courtPointFromMeters(origin: CourtPoint, vector: CourtPoint): CourtPoint {
  return {
    x: clamp(origin.x + (vector.x / COURT_LENGTH_METERS) * 100, MIN_LANDING_X, MAX_LANDING_X),
    y: clamp(origin.y + (vector.y / COURT_WIDTH_METERS) * 100, MIN_LANDING_Y, MAX_LANDING_Y),
  };
}

function weightedCollision(roll: number, entries: ReadonlyArray<readonly [MissCollision, number]>) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = roll * total;
  for (const [collision, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) return collision;
  }
  return entries.at(-1)?.[0] ?? "FRONT_RIM";
}

/**
 * Produces a deterministic, explainable miss using exactly three PRNG draws:
 * contact type, deflection angle/side and rebound distance. It is intentionally
 * a stable gameplay approximation rather than a rigid-body rim simulation.
 */
export function generateMissTrajectory(
  shooter: CourtPlayer,
  shotOrigin: CourtPoint,
  rim: CourtPoint,
  seed: number,
): MissTrajectory {
  const collisionRoll = nextRandom(seed);
  const deflectionRoll = nextRandom(collisionRoll.seed);
  const lengthRoll = nextRandom(deflectionRoll.seed);
  const shotDistanceMeters = courtDistanceMeters(shotOrigin, rim);
  const rangeFactor = clamp((shotDistanceMeters - 2.2) / 7.2, 0, 1);
  const consistencyPenalty = clamp((72 - shooter.ratings.shotConsistency) / 100, -0.08, 0.2);
  const airballWeight = clamp(0.018 + rangeFactor * 0.055 + consistencyPenalty * 0.22, 0.008, 0.115);
  const backboardWeight = clamp(0.17 - rangeFactor * 0.105, 0.045, 0.18);
  const collision = weightedCollision(collisionRoll.value, [
    ["AIRBALL", airballWeight],
    ["BACKBOARD", backboardWeight],
    ["FRONT_RIM", 0.305 + rangeFactor * 0.045],
    ["BACK_RIM", 0.225],
    ["SIDE_RIM", 0.285 + rangeFactor * 0.04],
  ]);

  const approach = normalize(physicalVector(shotOrigin, rim));
  const towardShooter = { x: -approach.x, y: -approach.y };
  const signedRoll = deflectionRoll.value * 2 - 1;
  let direction = towardShooter;
  let deflectionRadians = signedRoll * 0.34;
  let baseDistance = 0.85;
  let randomDistance = 2.15;
  let rangeDistance = rangeFactor * (1.65 + lengthRoll.value * 2.05);

  if (collision === "BACK_RIM") {
    deflectionRadians = signedRoll * 0.48;
    baseDistance = 1.35;
    randomDistance = 2.75;
  } else if (collision === "SIDE_RIM") {
    const side = signedRoll < 0 ? -1 : 1;
    deflectionRadians = side * (0.52 + Math.abs(signedRoll) * 0.7);
    baseDistance = 1.55;
    randomDistance = 3.1;
  } else if (collision === "BACKBOARD") {
    deflectionRadians = signedRoll * 0.42;
    baseDistance = 0.65;
    randomDistance = 1.65;
    rangeDistance *= 0.42;
  } else if (collision === "AIRBALL") {
    // Negative half of the angle roll is a short airball; positive is long.
    direction = signedRoll < 0 ? towardShooter : approach;
    deflectionRadians = signedRoll * 0.22;
    baseDistance = 1.45;
    randomDistance = 3.65;
    rangeDistance += rangeFactor * 1.15;
  }

  direction = rotate(direction, deflectionRadians);
  const intendedDistance = baseDistance + lengthRoll.value * randomDistance + rangeDistance;
  const intendedVector = { x: direction.x * intendedDistance, y: direction.y * intendedDistance };
  const landingPoint = courtPointFromMeters(rim, intendedVector);
  const reboundDistanceMeters = courtDistanceMeters(rim, landingPoint);

  return {
    collision,
    landingPoint: { x: round(landingPoint.x, 2), y: round(landingPoint.y, 2) },
    rimContacted: collision !== "AIRBALL",
    shotDistanceMeters: round(shotDistanceMeters, 2),
    reboundDistanceMeters: round(reboundDistanceMeters, 2),
    longRebound: reboundDistanceMeters >= 4.25,
    seed: lengthRoll.seed,
  };
}

export function reboundRating(ratings: Ratings, offensive: boolean) {
  return offensive ? ratings.offensiveRebound : ratings.defensiveRebound;
}

function pairedOpponentId(state: MatchState, player: CourtPlayer) {
  if (player.team === "home") return state.currentMatchups[player.id];
  return Object.entries(state.currentMatchups).find(([, awayId]) => awayId === player.id)?.[0];
}

function boxOutPositionEdge(
  state: MatchState,
  roster: readonly CourtPlayer[],
  player: CourtPlayer,
  landingPoint: CourtPoint,
  rim: CourtPoint,
) {
  const playerPoint = positionOf(state, player);
  const opponents = roster.filter((candidate) => candidate.team !== player.team);
  const pairedId = pairedOpponentId(state, player);
  const opponent = opponents.find((candidate) => candidate.id === pairedId)
    ?? opponents.reduce<CourtPlayer | undefined>((nearest, candidate) => {
      if (!nearest) return candidate;
      return courtDistanceMeters(positionOf(state, candidate), playerPoint)
        < courtDistanceMeters(positionOf(state, nearest), playerPoint)
        ? candidate
        : nearest;
    }, undefined);
  if (!opponent) return 0;

  const opponentPoint = positionOf(state, opponent);
  const insideEdge = clamp(
    (courtDistanceMeters(opponentPoint, rim) - courtDistanceMeters(playerPoint, rim)) / 2.4,
    -1,
    1,
  );
  const landingEdge = clamp(
    (courtDistanceMeters(opponentPoint, landingPoint) - courtDistanceMeters(playerPoint, landingPoint)) / 2.8,
    -1,
    1,
  );
  const nearRimImportance = 1 - clamp(courtDistanceMeters(rim, landingPoint) / 7, 0, 0.82);
  return clamp(insideEdge * nearRimImportance * 0.62 + landingEdge * 0.38, -1, 1);
}

/**
 * Scores every player with one symmetric formula. Travel/reaction time is the
 * largest term; no home/away, user/AI or hidden defensive-team multiplier exists.
 */
export function scoreReboundCandidates(
  state: MatchState,
  roster: readonly CourtPlayer[],
  landingPoint: CourtPoint,
  rim: CourtPoint,
  attackingTeam: TeamSide,
): ReboundCandidate[] {
  return roster.map((player) => {
    const point = positionOf(state, player);
    const distanceMeters = courtDistanceMeters(point, landingPoint);
    const reactionSeconds = clamp(
      0.5 - ((player.ratings.basketballIQ - 50) / 49) * 0.15 - ((player.ratings.hands - 50) / 49) * 0.055,
      0.25,
      0.57,
    );
    const runningSpeedMetersPerSecond =
      3.35 + (player.ratings.speed / 99) * 2.55 + (player.ratings.acceleration / 99) * 0.9;
    const arrivalSeconds = reactionSeconds + distanceMeters / runningSpeedMetersPerSecond;
    const offensive = player.team === attackingTeam;
    const boxOutEdge = boxOutPositionEdge(state, roster, player, landingPoint, rim);
    const skill = reboundRating(player.ratings, offensive) * 0.34
      + player.ratings.vertical * 0.12
      + player.ratings.strength * 0.09
      + player.ratings.hands * 0.09
      + player.ratings.basketballIQ * 0.065;
    // A one-second arrival loss costs 43 points, more than any single rating
    // can recover. Ratings and box-out position then separate nearby contenders.
    const score = 108 - arrivalSeconds * 43 + skill + boxOutEdge * 9;
    return {
      playerId: player.id,
      team: player.team,
      distanceMeters: round(distanceMeters),
      arrivalSeconds: round(arrivalSeconds),
      score: round(score),
      probability: 0,
      boxOutEdge: round(boxOutEdge),
    };
  });
}

function withProbabilities(candidates: ReboundCandidate[]) {
  const maxScore = Math.max(...candidates.map((candidate) => candidate.score));
  const earliestArrival = Math.min(...candidates.map((candidate) => candidate.arrivalSeconds));
  const latestEligibleArrival = Math.min(1.45, earliestArrival + 0.68);
  const weights = candidates.map((candidate) =>
    candidate.arrivalSeconds <= latestEligibleArrival
      ? Math.exp((candidate.score - maxScore) / REBOUND_SOFTMAX_TEMPERATURE)
      : 0,
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return candidates.map((candidate, index) => ({
    ...candidate,
    // Keep the unrounded probability for selection so even an underdog retains
    // its mathematically assigned chance; presentation can round at the UI edge.
    probability: weights[index] / total,
  }));
}

function chooseWeighted(candidates: ReboundCandidate[], roll: number) {
  const exactTotal = candidates.reduce((sum, candidate) => sum + candidate.probability, 0);
  let cursor = roll * exactTotal;
  for (const candidate of candidates) {
    cursor -= candidate.probability;
    if (cursor <= 0) return candidate;
  }
  return candidates.at(-1);
}

export function resolveMissedShotRebound(input: ResolveMissedShotInput): ReboundResolutionState {
  const shooter = input.roster.find((player) => player.id === input.shooterId);
  if (!shooter) throw new Error(`Unknown rebound shooter: ${input.shooterId}`);
  if (input.roster.length === 0) throw new Error("Cannot resolve a rebound without players");

  const trajectory = generateMissTrajectory(
    shooter,
    input.shotOrigin,
    input.rim,
    input.seed ?? input.state.seed,
  );
  const candidates = withProbabilities(scoreReboundCandidates(
    input.state,
    input.roster,
    trajectory.landingPoint,
    input.rim,
    shooter.team,
  ));
  const winnerRoll = nextRandom(trajectory.seed);
  const winner = chooseWeighted(candidates, winnerRoll.value);
  if (!winner) throw new Error("Rebound candidate selection failed");
  const bestOpponent = candidates
    .filter((candidate) => candidate.team !== winner.team)
    .sort((a, b) => b.score - a.score)[0];
  const contested = Boolean(bestOpponent && (
    Math.abs(winner.arrivalSeconds - bestOpponent.arrivalSeconds) <= 0.34
    || (winner.distanceMeters <= 1.7 && bestOpponent.distanceMeters <= 1.7)
  ) && Math.abs(winner.score - bestOpponent.score) <= 15);

  return {
    id: `rebound-${input.state.eventSequence + 1}-${winnerRoll.seed}`,
    attackingTeam: shooter.team,
    winnerId: winner.playerId,
    offensive: winner.team === shooter.team,
    contested,
    landingPoint: trajectory.landingPoint,
    collision: trajectory.collision,
    rimContacted: trajectory.rimContacted,
    candidates,
    seed: winnerRoll.seed,
  };
}

function closestOpponentDistance(
  state: MatchState,
  roster: readonly CourtPlayer[],
  player: CourtPlayer,
) {
  const point = positionOf(state, player);
  const distances = roster
    .filter((candidate) => candidate.team !== player.team)
    .map((candidate) => courtDistanceMeters(point, positionOf(state, candidate)));
  return distances.length > 0 ? Math.min(...distances) : 8;
}

/** Selects a safe handler after a defensive rebound, including self-push. */
export function selectDefensiveReboundOutlet(
  state: MatchState,
  roster: readonly CourtPlayer[],
  rebound: ReboundResolutionState,
): DefensiveOutletDecision {
  const rebounder = roster.find((player) => player.id === rebound.winnerId);
  if (!rebounder) throw new Error(`Unknown rebound winner: ${rebound.winnerId}`);
  const rebounderPoint = positionOf(state, rebounder);
  const teammates = roster.filter((player) => player.team === rebounder.team);
  const candidates = teammates.map<OutletCandidate>((player) => {
    const point = positionOf(state, player);
    const distanceMeters = courtDistanceMeters(rebounderPoint, point);
    const nearestDefenderMeters = closestOpponentDistance(state, roster, player);
    const pressureSafety = clamp((nearestDefenderMeters - 0.7) / 4.1, 0, 1);
    const handlingScore = player.ratings.ballHandle * 0.3
      + player.ratings.basketballIQ * 0.25
      + player.ratings.ballSecurity * 0.17
      + player.ratings.hands * 0.11
      + player.ratings.speedWithBall * 0.1
      + player.ratings.passAccuracy * 0.07;
    const attackProgress = rebounder.team === "home" ? rebounderPoint.x - point.x : point.x - rebounderPoint.x;
    const progressBonus = clamp(attackProgress / 22, -1, 1) * 3.2;
    const distancePenalty = player.id === rebounder.id ? 0 : Math.max(0, distanceMeters - 8) * 1.35;
    const score = handlingScore + pressureSafety * 11 + progressBonus - distancePenalty;
    return {
      playerId: player.id,
      score: round(score),
      distanceMeters: round(distanceMeters),
      nearestDefenderMeters: round(nearestDefenderMeters),
      handlingScore: round(handlingScore),
    };
  }).sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));

  const self = candidates.find((candidate) => candidate.playerId === rebounder.id);
  const bestTeammate = candidates.find((candidate) => candidate.playerId !== rebounder.id);
  if (!self || !bestTeammate || rebound.offensive) {
    return {
      rebounderId: rebounder.id,
      receiverId: rebounder.id,
      shouldPass: false,
      risk: 0.03,
      candidates,
      explanation: rebound.offensive ? "进攻篮板由篮板手保护球，优先组织二次进攻" : "篮板手直接推进",
    };
  }

  const receiver = teammates.find((player) => player.id === bestTeammate.playerId);
  if (!receiver) throw new Error(`Unknown outlet receiver: ${bestTeammate.playerId}`);
  const passerQuality = (
    rebounder.ratings.passAccuracy * 0.48
    + rebounder.ratings.passVision * 0.3
    + rebounder.ratings.basketballIQ * 0.22
  ) / 99;
  const receiverSecurity = (
    receiver.ratings.ballSecurity * 0.42
    + receiver.ratings.hands * 0.26
    + receiver.ratings.basketballIQ * 0.32
  ) / 99;
  const receiverPressure = 1 - clamp((bestTeammate.nearestDefenderMeters - 0.7) / 4.1, 0, 1);
  const risk = clamp(
    0.11 + (bestTeammate.distanceMeters / 28) * 0.33 + receiverPressure * 0.28
      - passerQuality * 0.26 - receiverSecurity * 0.16,
    0.025,
    0.68,
  );
  const shouldPass = bestTeammate.score >= self.score + 1.25 && risk <= 0.4;

  return {
    rebounderId: rebounder.id,
    receiverId: shouldPass ? bestTeammate.playerId : rebounder.id,
    shouldPass,
    risk: round(shouldPass ? risk : 0.03),
    candidates,
    explanation: shouldPass
      ? `安全出球给${bestTeammate.playerId}，兼顾控球、阅读、接应距离与防守压力`
      : "出球风险偏高，篮板手直接推进",
  };
}
