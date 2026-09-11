import { playerById, players } from "./data";
import { scaleControlledAttributeContribution } from "./difficulty";
import type {
  CourtPoint,
  CourtPlayer,
  DifficultyId,
  MatchState,
  Resolution,
  ScreenCoverage,
  ScreenResolution,
  ScreenResult,
  ScreenRoute,
} from "./types";

const UINT32_MAX_PLUS_ONE = 4_294_967_296;
const COURT_LENGTH_METERS = 28.65;
const COURT_WIDTH_METERS = 15.24;
const RIM_PROTECTION_RADIUS_METERS = 4.35;
const DRIVE_PATH_CORRIDOR_METERS = 1.35;
const PERIMETER_RECEIVER_RADIUS_METERS = 6.55;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function nextRandom(seed: number) {
  let next = seed >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;
  return { seed: next, value: next / UINT32_MAX_PLUS_ONE };
}

function normalized(rating: number) {
  return clamp((rating - 70) / 20, -1.5, 1.45);
}

function controlledDifficultyFor(state: MatchState, playerId: string): DifficultyId | undefined {
  return playerId === state.createdPlayerId && playerId === state.controlledPlayerId
    ? state.difficulty
    : undefined;
}

function attackerContribution(value: number, difficulty?: DifficultyId) {
  return difficulty ? scaleControlledAttributeContribution(value, difficulty) : value;
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function getPlayer(id: string) {
  const player = playerById.get(id);
  if (!player) throw new Error(`Unknown player: ${id}`);
  return player;
}

function attackRimPoint(team: CourtPlayer["team"]): CourtPoint {
  return { x: team === "home" ? 11 : 89, y: 50 };
}

function pointInMeters(point: CourtPoint) {
  return {
    x: (point.x / 100) * COURT_LENGTH_METERS,
    y: (point.y / 100) * COURT_WIDTH_METERS,
  };
}

function distanceMeters(first: CourtPoint, second: CourtPoint) {
  const a = pointInMeters(first);
  const b = pointInMeters(second);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToDrivePathMeters(point: CourtPoint, start: CourtPoint, rim: CourtPoint) {
  const metricPoint = pointInMeters(point);
  const metricStart = pointInMeters(start);
  const metricRim = pointInMeters(rim);
  const dx = metricRim.x - metricStart.x;
  const dy = metricRim.y - metricStart.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.000_001) {
    return { distance: Math.hypot(metricPoint.x - metricStart.x, metricPoint.y - metricStart.y), projection: 0 };
  }
  const projection = ((metricPoint.x - metricStart.x) * dx + (metricPoint.y - metricStart.y) * dy) / lengthSquared;
  const bounded = clamp(projection, 0, 1);
  const closest = { x: metricStart.x + dx * bounded, y: metricStart.y + dy * bounded };
  return {
    distance: Math.hypot(metricPoint.x - closest.x, metricPoint.y - closest.y),
    projection,
  };
}

function livePoint(state: MatchState, player: CourtPlayer) {
  return state.motion.positions[player.id] ?? { x: player.x, y: player.y };
}

function isFrontcourtPoint(team: CourtPlayer["team"], point: CourtPoint) {
  return team === "home" ? point.x <= 50 : point.x >= 50;
}

function defenderForTarget(state: MatchState, target: CourtPlayer) {
  const defenderId = target.team === "home"
    ? state.currentMatchups[target.id]
    : Object.entries(state.currentMatchups).find(([, offenderId]) => offenderId === target.id)?.[0];
  return defenderId ? playerById.get(defenderId) : undefined;
}

export interface PassOptionAssessment {
  targetId: string;
  opportunityScore: number;
  receiverSpaceMeters: number;
  scoringFit: number;
  tacticalFit: number;
  laneRisk: number;
  passDistanceMeters: number;
}

function passLaneRisk(state: MatchState, handler: CourtPlayer, target: CourtPlayer) {
  const start = livePoint(state, handler);
  const end = livePoint(state, target);
  let cleanLaneProbability = 1;

  for (const defender of players.filter((candidate) => candidate.team !== handler.team)) {
    const lane = distanceToDrivePathMeters(livePoint(state, defender), start, end);
    if (lane.projection <= 0.04 || lane.projection >= 0.98 || lane.distance >= 2.35) continue;
    const proximity = 1 - clamp(lane.distance / 2.35, 0, 1);
    const centrality = 1 - Math.abs(lane.projection - 0.5) * 0.55;
    const disruption = (
      defender.ratings.steal * 0.42
      + defender.ratings.hands * 0.24
      + defender.ratings.helpDefenseIQ * 0.2
      + defender.ratings.lateralQuickness * 0.14
    ) / 100;
    const individualRisk = clamp(proximity * centrality * (0.34 + disruption * 0.48), 0, 0.78);
    cleanLaneProbability *= 1 - individualRisk;
  }

  const passDistance = distanceMeters(start, end);
  const lengthRisk = clamp((passDistance - 7.5) / 13, 0, 0.16);
  return clamp(1 - cleanLaneProbability + lengthRisk, 0, 0.96);
}

function receiverScoringFit(state: MatchState, target: CourtPlayer) {
  const targetPoint = livePoint(state, target);
  const rimDistance = distanceMeters(targetPoint, attackRimPoint(target.team));
  if (rimDistance <= 4.1) {
    return target.ratings.layup * 0.27
      + target.ratings.closeShot * 0.22
      + target.ratings.drivingDunk * 0.18
      + target.ratings.standingDunk * 0.08
      + target.ratings.hands * 0.15
      + target.ratings.strength * 0.1;
  }
  if (rimDistance <= PERIMETER_RECEIVER_RADIUS_METERS) {
    return target.ratings.midRange * 0.34
      + target.ratings.catchShoot * 0.22
      + target.ratings.layup * 0.14
      + target.ratings.shotConsistency * 0.12
      + target.ratings.hands * 0.1
      + target.ratings.basketballIQ * 0.08;
  }
  return target.ratings.threePoint * 0.42
    + target.ratings.catchShoot * 0.27
    + target.ratings.shotConsistency * 0.13
    + target.ratings.offBallMovement * 0.1
    + target.ratings.hands * 0.08;
}

function receiverTacticalFit(state: MatchState, target: CourtPlayer) {
  const intent = state.motion.intents[target.id] ?? "HOLD";
  const intentFit: Partial<Record<typeof intent, number>> = {
    RECEIVE: 92,
    CUT: 90,
    ROLL: 94,
    POP: 93,
    DRIVE: 86,
    SPACE: 72,
    HOLD: 48,
    SCREEN: 42,
    HANDLE: 28,
  };
  let fit = intentFit[intent] ?? 55;
  if (state.homeTacticExecution?.primaryPlayerId === target.id) fit += 18;
  if (state.screen?.screenerId === target.id) {
    const openness = state.screen.route === "POP" ? state.screen.popOpenness : state.screen.rollOpenness;
    fit = Math.max(fit, 66 + openness * 34);
  }
  return clamp(fit, 0, 100);
}

/**
 * Score every teammate who can legally catch an ordinary pass. The score is
 * deliberately derived from the live board, not from a fixed position order:
 * space and scoring fit describe the opportunity, tactical fit rewards the
 * current cut/roll/pop/read, and lane risk penalizes defenders sitting between
 * passer and receiver.
 */
export function evaluateOrdinaryPassOptions(state: MatchState): PassOptionAssessment[] {
  const handler = getPlayer(state.ballHandlerId);
  const handlerPoint = livePoint(state, handler);
  const defenders = players.filter((candidate) => candidate.team !== handler.team);
  return players
    .filter((candidate) => {
      if (candidate.team !== handler.team || candidate.id === handler.id) return false;
      if (state.disqualifiedPlayerIds.includes(candidate.id)) return false;
      return !state.frontcourtEstablished || isFrontcourtPoint(candidate.team, livePoint(state, candidate));
    })
    .map((target) => {
      const targetPoint = livePoint(state, target);
      const receiverSpaceMeters = defenders.reduce(
        (nearest, defender) => Math.min(nearest, distanceMeters(targetPoint, livePoint(state, defender))),
        Number.POSITIVE_INFINITY,
      );
      const scoringFit = receiverScoringFit(state, target);
      const tacticalFit = receiverTacticalFit(state, target);
      const laneRisk = passLaneRisk(state, handler, target);
      const passDistanceMeters = distanceMeters(handlerPoint, targetPoint);
      const spaceScore = clamp(receiverSpaceMeters / 4.25, 0, 1) * 100;
      const laneSafety = (1 - laneRisk) * 100;
      const longPassPenalty = clamp((passDistanceMeters - 9) / 6, 0, 1) * 7;
      const opportunityScore = clamp(
        spaceScore * 0.36
          + scoringFit * 0.29
          + tacticalFit * 0.19
          + laneSafety * 0.16
          - longPassPenalty,
        0,
        100,
      );
      return {
        targetId: target.id,
        opportunityScore,
        receiverSpaceMeters,
        scoringFit,
        tacticalFit,
        laneRisk,
        passDistanceMeters,
      };
    })
    .sort((first, second) => second.opportunityScore - first.opportunityScore || first.targetId.localeCompare(second.targetId));
}

export interface DriveLaneAssessment {
  openRim: boolean;
  rimProtectorId?: string;
  pathBlockerIds: string[];
  laneOpenness: number;
}

/**
 * Reads live board geometry rather than assigning a distant PF/C as an
 * imaginary rim protector. A defender can close the lane by already occupying
 * the paint/help radius or by being legally ahead of the handler in the drive
 * corridor.
 */
export function assessDriveLane(state: MatchState): DriveLaneAssessment {
  const attacker = getPlayer(state.ballHandlerId);
  const attackerPoint = livePoint(state, attacker);
  const rim = attackRimPoint(attacker.team);
  const defenders = players.filter((candidate) => candidate.team !== attacker.team);
  const rimDefenders = defenders.filter(
    (candidate) => distanceMeters(livePoint(state, candidate), rim) <= RIM_PROTECTION_RADIUS_METERS,
  );
  const pathBlockers = defenders.filter((candidate) => {
    const path = distanceToDrivePathMeters(livePoint(state, candidate), attackerPoint, rim);
    return path.projection >= 0.06 && path.projection <= 1.02 && path.distance <= DRIVE_PATH_CORRIDOR_METERS;
  });
  const rimProtector = [...rimDefenders].sort((first, second) => {
    const firstPoint = livePoint(state, first);
    const secondPoint = livePoint(state, second);
    const firstScore = first.ratings.interiorDefense * 0.45
      + first.ratings.block * 0.3
      + first.ratings.helpDefenseIQ * 0.2
      - distanceMeters(firstPoint, rim) * 2;
    const secondScore = second.ratings.interiorDefense * 0.45
      + second.ratings.block * 0.3
      + second.ratings.helpDefenseIQ * 0.2
      - distanceMeters(secondPoint, rim) * 2;
    return secondScore - firstScore || first.id.localeCompare(second.id);
  })[0];
  const blockerIds = [...new Set(pathBlockers.map((candidate) => candidate.id))];
  const primaryId = state.currentMatchups[attacker.id];
  const secondaryPathBlockers = blockerIds.filter((id) => id !== primaryId).length;
  const baseOpenness = state.screen ? clamp(state.screen.separation + 0.08, 0.2, 0.88) : 0.56;
  const laneOpenness = clamp(
    rimDefenders.length === 0 && blockerIds.length === 0
      ? 0.9
      : baseOpenness - rimDefenders.length * 0.11 - secondaryPathBlockers * 0.07,
    0.14,
    0.9,
  );
  return {
    openRim: rimDefenders.length === 0 && blockerIds.length === 0,
    rimProtectorId: rimProtector?.id,
    pathBlockerIds: blockerIds,
    laneOpenness,
  };
}

/** Selects the physically nearest legal teammate who is currently outside. */
export function findNearestLegalPerimeterTeammate(state: MatchState) {
  const handler = getPlayer(state.ballHandlerId);
  const handlerPoint = livePoint(state, handler);
  const rim = attackRimPoint(handler.team);
  return players
    .filter((candidate) => {
      if (candidate.team !== handler.team || candidate.id === handler.id || candidate.position === "C") return false;
      const point = livePoint(state, candidate);
      if (state.frontcourtEstablished && !isFrontcourtPoint(candidate.team, point)) return false;
      return distanceMeters(point, rim) >= PERIMETER_RECEIVER_RADIUS_METERS;
    })
    .sort((first, second) => {
      const distanceDelta = distanceMeters(handlerPoint, livePoint(state, first))
        - distanceMeters(handlerPoint, livePoint(state, second));
      return distanceDelta || first.id.localeCompare(second.id);
    })[0];
}

export function resolveDriveKickPass(state: MatchState) {
  const handler = getPlayer(state.ballHandlerId);
  const difficulty = controlledDifficultyFor(state, handler.id);
  const target = findNearestLegalPerimeterTeammate(state);
  if (!target) return undefined;
  const defender = defenderForTarget(state, target);
  const targetPoint = livePoint(state, target);
  const defenderPoint = defender ? livePoint(state, defender) : undefined;
  const receiverSpace = defenderPoint ? clamp((distanceMeters(targetPoint, defenderPoint) - 0.8) / 3.2, 0, 1) : 1;
  const completion = clamp(
    0.8
      + attackerContribution(normalized(handler.ratings.passAccuracy) * 0.08, difficulty)
      + attackerContribution(normalized(handler.ratings.passVision) * 0.045, difficulty)
      + attackerContribution(normalized(handler.ratings.basketballIQ) * 0.045, difficulty)
      + attackerContribution(normalized(handler.ratings.passSpeed) * 0.03, difficulty)
      + attackerContribution(normalized(handler.ratings.ballSecurity) * 0.025, difficulty)
      + normalized(target.ratings.hands) * 0.025
      - (defender ? normalized(defender.ratings.steal) * 0.07 : 0)
      + (receiverSpace - 0.5) * 0.045,
    0.42,
    0.98,
  );
  const roll = nextRandom(state.seed);
  const completed = roll.value < completion;
  return {
    targetId: target.id,
    seed: roll.seed,
    selectedCorrectly: true,
    completed,
    selectionQuality: 1,
    completion,
    explanation: completed
      ? `突分找到最近外线${target.number}号 · 协防收缩后形成接球空间`
      : `突分找到${target.number}号，但传球线路被破坏`,
  };
}

export function calculateTacticExecutionBonus(state: MatchState) {
  const execution = state.homeTacticExecution;
  if (!execution || state.possession !== "home" || state.activeTactic !== execution.tacticId) return 0;
  const elapsed = Math.max(0, execution.startedAtShotClock - state.shotClock);
  if (elapsed < 0.85) return -0.015;
  const qualityBonus = clamp((execution.executionScore - 70) / 750, -0.02, 0.03);
  const primaryStillMoving = (state.motion.routes[execution.primaryPlayerId]?.length ?? 0) > 0;
  const readiness = elapsed < 2.2 ? 0.25 : primaryStillMoving ? 0.65 : 1;
  return clamp(qualityBonus * readiness, -0.02, 0.03);
}

function chooseScreener(handlerId: string) {
  const teammates = players.filter((player) => player.team === "home" && player.id !== handlerId);
  return teammates.reduce((best, player) => {
    const screening =
      player.ratings.strength * 0.45 +
      player.ratings.basketballIQ * 0.35 +
      player.ratings.stamina * 0.2;
    const bestScreening =
      best.ratings.strength * 0.45 + best.ratings.basketballIQ * 0.35 + best.ratings.stamina * 0.2;
    return screening > bestScreening ? player : best;
  });
}

function routeUtilities(screener: CourtPlayer, coverage: ScreenCoverage, rollOpen: number, popOpen: number) {
  const roll =
    screener.ratings.layup * 0.18 +
    screener.ratings.drivingDunk * 0.16 +
    screener.ratings.basketballIQ * 0.16 +
    screener.ratings.speed * 0.1 +
    screener.ratings.hands * 0.1 +
    rollOpen * 30;
  const pop =
    screener.ratings.threePoint * 0.34 +
    screener.ratings.midRange * 0.12 +
    screener.ratings.basketballIQ * 0.16 +
    popOpen * 30 +
    (coverage.startsWith("DROP") ? 7 : 0);
  return { roll, pop };
}

export function resolvePickAndRoll(state: MatchState): Resolution<ScreenResolution> {
  if (state.possession !== "home") throw new Error("Pick-and-roll requires home possession in this prototype");

  const handlerId = state.ballHandlerId;
  const controlledHasBall = state.controlledPlayerId === handlerId;
  const screener = controlledHasBall ? chooseScreener(handlerId) : getPlayer(state.controlledPlayerId);
  const handler = getPlayer(handlerId);
  const handlerDefenderBefore = state.currentMatchups[handlerId];
  const screenerDefenderBefore = state.currentMatchups[screener.id];
  const handlerDefender = getPlayer(handlerDefenderBefore);
  const screenerDefender = getPlayer(screenerDefenderBefore);

  const rollA = nextRandom(state.seed);
  const rollB = nextRandom(rollA.seed);
  const rollC = nextRandom(rollB.seed);
  const screening =
    screener.ratings.strength * 0.45 +
    screener.ratings.basketballIQ * 0.35 +
    screener.ratings.stamina * 0.2;
  const navigation =
    handlerDefender.ratings.screenNavigation * 0.55 +
    handlerDefender.ratings.lateralQuickness * 0.25 +
    handlerDefender.ratings.helpDefenseIQ * 0.2;
  const contactQuality = clamp(0.5 + (screening - navigation) / 70 + (rollA.value - 0.5) * 0.28, 0.08, 0.94);

  let coverage: ScreenCoverage;
  const switchSuitability =
    screenerDefender.ratings.perimeterDefense * 0.45 +
    screenerDefender.ratings.lateralQuickness * 0.35 +
    screenerDefender.ratings.helpDefenseIQ * 0.2;
  if (rollB.value < 0.2) coverage = "BLITZ";
  else if (switchSuitability >= 66 && rollB.value < 0.54) coverage = "SWITCH";
  else if (rollB.value < 0.72) coverage = handler.ratings.threePoint >= 76 ? "DROP_OVER" : "DROP_UNDER";
  else coverage = "HEDGE_RECOVER";

  const separation = clamp(
    contactQuality +
      normalized(handler.ratings.ballHandle) * 0.07 +
      normalized(handler.ratings.acceleration) * 0.04 +
      normalized(handler.ratings.agility) * 0.03 -
      normalized(handlerDefender.ratings.lateralQuickness) * 0.07 -
      normalized(handlerDefender.ratings.defenseConsistency) * 0.03,
    0.05,
    0.95,
  );
  const rollOpenness = clamp(
    0.52 + separation * 0.28 - normalized(screenerDefender.ratings.interiorDefense) * 0.12 - (coverage === "BLITZ" ? -0.1 : 0),
    0.05,
    0.95,
  );
  const popOpenness = clamp(
    0.44 + separation * 0.26 + (coverage.startsWith("DROP") ? 0.18 : 0) - normalized(screenerDefender.ratings.perimeterDefense) * 0.1,
    0.05,
    0.95,
  );
  const utilities = routeUtilities(screener, coverage, rollOpenness, popOpenness);
  let route: ScreenRoute = utilities.roll >= utilities.pop ? "ROLL" : "POP";
  if (coverage === "BLITZ") route = "SHORT_ROLL";
  if (contactQuality < 0.26 && screener.ratings.basketballIQ >= 76) route = "SLIP";

  let result: ScreenResult;
  if (contactQuality < 0.22) result = "MISSED_CONTACT";
  else if (coverage === "SWITCH") result = "MISMATCH_CREATED";
  else if (separation > 0.72) result = "CLEAN_ADVANTAGE";
  else if (separation > 0.42) result = "SMALL_ADVANTAGE";
  else result = "DEFENSE_SOLVED";

  const switched = coverage === "SWITCH" && result !== "MISSED_CONTACT";
  const handlerDefenderAfter = switched ? screenerDefenderBefore : handlerDefenderBefore;
  const screenerDefenderAfter = switched ? handlerDefenderBefore : screenerDefenderBefore;
  const mismatch = switched
    ? screenerDefender.position === "C" || screenerDefender.position === "PF"
      ? "BIG_ON_HANDLER"
      : "SMALL_ON_ROLLER"
    : "NONE";
  const explanation = buildScreenExplanation(coverage, route, result, mismatch);

  return {
    value: {
      id: `screen-${state.version}-${rollC.seed}`,
      handlerId,
      screenerId: screener.id,
      decisionOwnerId: handlerId,
      handlerDefenderBefore,
      screenerDefenderBefore,
      handlerDefenderAfter,
      screenerDefenderAfter,
      coverage,
      route,
      result,
      mismatch,
      contactQuality,
      separation,
      rollOpenness,
      popOpenness,
      explanation,
    },
    seed: rollC.seed,
    probability: separation,
    explanation,
  };
}

function buildScreenExplanation(
  coverage: ScreenCoverage,
  route: ScreenRoute,
  result: ScreenResult,
  mismatch: ScreenResolution["mismatch"],
) {
  const coverageText: Record<ScreenCoverage, string> = {
    SWITCH: "防守换防",
    BLITZ: "防守夹击",
    DROP_OVER: "大个沉退，后卫挤过",
    DROP_UNDER: "大个沉退，后卫绕过",
    HEDGE_RECOVER: "大个延误后回位",
  };
  const routeText: Record<ScreenRoute, string> = {
    ROLL: "掩护人顺下",
    POP: "掩护人外弹",
    SHORT_ROLL: "掩护人短顺下",
    SLIP: "假掩护提前顺下",
  };
  if (result === "MISSED_CONTACT") return "掩护角度被识破 · 重新组织";
  if (mismatch === "BIG_ON_HANDLER") return `${coverageText[coverage]} · 内线留在外线形成错位`;
  return `${coverageText[coverage]} · ${routeText[route]}`;
}

export function calculateShotChance(
  shooter: CourtPlayer,
  defender: CourtPlayer,
  openness: number,
  isThree = true,
  context: "CATCH" | "PULL_UP" = "CATCH",
  controlledDifficulty?: DifficultyId,
) {
  const shooting = isThree ? shooter.ratings.threePoint : shooter.ratings.midRange;
  const contextRating = context === "PULL_UP" ? shooter.ratings.pullUpShot : shooter.ratings.catchShoot;
  const attack =
    attackerContribution(normalized(shooting) * 0.56, controlledDifficulty) +
    attackerContribution(normalized(contextRating) * 0.14, controlledDifficulty) +
    attackerContribution(normalized(shooter.ratings.shotConsistency) * 0.1, controlledDifficulty) +
    attackerContribution(normalized(shooter.ratings.basketballIQ) * 0.08, controlledDifficulty);
  const defense =
    normalized(defender.ratings.perimeterDefense) * 0.42 +
    normalized(defender.ratings.lateralQuickness) * 0.14 +
    normalized(defender.ratings.defenseConsistency) * 0.06;
  const baseLogit = isThree ? -0.42 : -0.1;
  return clamp(sigmoid(baseLogit + attack - defense + (openness - 0.5) * 1.55), 0.05, 0.86);
}

export function calculateFinishChance(
  attacker: CourtPlayer,
  primaryDefender: CourtPlayer,
  rimHelper: CourtPlayer | undefined,
  laneOpenness: number,
  finishType: "LAYUP" | "DUNK" = "LAYUP",
  controlledDifficulty?: DifficultyId,
) {
  const finishSkill = finishType === "DUNK"
    ? attackerContribution(normalized(attacker.ratings.drivingDunk) * 0.34, controlledDifficulty)
      + attackerContribution(normalized(attacker.ratings.standingDunk) * 0.06, controlledDifficulty)
      + attackerContribution(normalized(attacker.ratings.layup) * 0.06, controlledDifficulty)
      + attackerContribution(normalized(attacker.ratings.vertical) * 0.12, controlledDifficulty)
    : attackerContribution(normalized(attacker.ratings.layup) * 0.4, controlledDifficulty)
      + attackerContribution(normalized(attacker.ratings.closeShot) * 0.08, controlledDifficulty)
      + attackerContribution(normalized(attacker.ratings.drivingDunk) * 0.05, controlledDifficulty)
      + attackerContribution(normalized(attacker.ratings.vertical) * 0.06, controlledDifficulty);
  const attack =
    finishSkill +
    attackerContribution(normalized(attacker.ratings.strength) * 0.1, controlledDifficulty) +
    attackerContribution(normalized(attacker.ratings.acceleration) * 0.07, controlledDifficulty) +
    attackerContribution(normalized(attacker.ratings.ballSecurity) * 0.07, controlledDifficulty) +
    attackerContribution(normalized(attacker.ratings.basketballIQ) * 0.08, controlledDifficulty);
  const pointOfAttack =
    normalized(primaryDefender.ratings.perimeterDefense) * 0.18 +
    normalized(primaryDefender.ratings.lateralQuickness) * 0.12;
  const rimDefense = rimHelper
    ? normalized(rimHelper.ratings.interiorDefense) * 0.42 +
      normalized(rimHelper.ratings.block) * 0.25 +
      normalized(rimHelper.ratings.helpDefenseIQ) * 0.15
    : 0;
  return clamp(sigmoid(0.16 + attack - pointOfAttack - rimDefense + (laneOpenness - 0.5) * 1.45), 0.05, 0.92);
}

export function resolveShot(state: MatchState, isThree = true) {
  const shooter = getPlayer(state.ballHandlerId);
  const difficulty = controlledDifficultyFor(state, shooter.id);
  const defender = getPlayer(state.currentMatchups[state.ballHandlerId]);
  const openness = state.advantage === "KICK_OUT"
    ? 0.72
    : state.screen
    ? state.screen.result === "MISMATCH_CREATED"
      ? 0.72
      : clamp(state.screen.separation, 0.18, 0.88)
    : 0.44;
  const tacticBonus = calculateTacticExecutionBonus(state);
  const probability = clamp(
    calculateShotChance(
      shooter,
      defender,
      openness,
      isThree,
      state.advantage === "KICK_OUT" ? "CATCH" : state.screen ? "PULL_UP" : "CATCH",
      difficulty,
    ) + tacticBonus,
    0.05,
    0.86,
  );
  const roll = nextRandom(state.seed);
  return {
    made: roll.value < probability,
    seed: roll.seed,
    probability,
    defenderId: defender.id,
    explanation: `当前防守人${defender.number}号 · 外线干扰已计入${tacticBonus === 0 ? "" : ` · 战术执行${tacticBonus > 0 ? "+" : ""}${Math.round(tacticBonus * 100)}%`}`,
  };
}

export function resolveDrive(state: MatchState, finishType: "LAYUP" | "DUNK" = "LAYUP") {
  const attacker = getPlayer(state.ballHandlerId);
  const difficulty = controlledDifficultyFor(state, attacker.id);
  const defender = getPlayer(state.currentMatchups[state.ballHandlerId]);
  const lane = assessDriveLane(state);
  const rimProtector = lane.rimProtectorId ? getPlayer(lane.rimProtectorId) : undefined;
  const tacticBonus = calculateTacticExecutionBonus(state);
  const probability = clamp(
    calculateFinishChance(attacker, defender, rimProtector, lane.laneOpenness, finishType, difficulty) + tacticBonus,
    0.05,
    0.92,
  );
  const roll = nextRandom(state.seed);
  return {
    made: roll.value < probability,
    seed: roll.seed,
    probability,
    defenderId: defender.id,
    helperId: rimProtector?.id === defender.id ? undefined : rimProtector?.id,
    openRim: lane.openRim,
    explanation: `${rimProtector
      ? rimProtector.id === defender.id
        ? `突破进入阵地终结 · ${rimProtector.number}号主防回收护筐`
        : `突破过掉当前对位 · ${rimProtector.number}号从实际禁区位置协防护筐`
      : lane.pathBlockerIds.length > 0
        ? "突破进入阵地终结 · 防守仍在突破线路前方"
        : "突破过掉当前对位 · 篮下无人及时协防"}${tacticBonus === 0 ? "" : ` · 战术执行${tacticBonus > 0 ? "+" : ""}${Math.round(tacticBonus * 100)}%`}`,
  };
}

export function resolvePass(state: MatchState, lob = false) {
  const handler = getPlayer(state.ballHandlerId);
  const difficulty = controlledDifficultyFor(state, handler.id);
  const tacticBonus = calculateTacticExecutionBonus(state);

  // Double-tap is a declared alley-oop action rather than an ordinary read.
  // Keep its established screener/finisher targeting contract intact.
  if (lob) {
    const target = state.screen ? getPlayer(state.screen.screenerId) : chooseScreener(state.ballHandlerId);
    const correctRead = state.screen
      ? state.screen.route === "ROLL" || state.screen.route === "SHORT_ROLL" || state.screen.route === "SLIP"
        ? state.screen.rollOpenness
        : state.screen.popOpenness
      : 0.45;
    const selectionQuality = clamp(
      0.52
        + attackerContribution(normalized(handler.ratings.basketballIQ) * 0.12, difficulty)
        + attackerContribution(normalized(handler.ratings.passVision) * 0.14, difficulty)
        + attackerContribution(normalized(handler.ratings.decisionSpeed) * 0.08, difficulty)
        + (correctRead - 0.5) * 0.3
        + tacticBonus * 0.8,
      0.12,
      0.96,
    );
    const defender = getPlayer(state.currentMatchups[target.id]);
    const completion = clamp(
      0.82
        + attackerContribution(normalized(handler.ratings.passAccuracy) * 0.07, difficulty)
        + attackerContribution(normalized(handler.ratings.passSpeed) * 0.04, difficulty)
        + attackerContribution(normalized(handler.ratings.ballSecurity) * 0.03, difficulty)
        + normalized(target.ratings.hands) * 0.03
        - normalized(defender.ratings.steal) * 0.08
        - 0.08
        + tacticBonus * 0.35,
      0.4,
      0.98,
    );
    const readRoll = nextRandom(state.seed);
    const passRoll = nextRandom(readRoll.seed);
    const selectedCorrectly = readRoll.value < selectionQuality;
    const completed = passRoll.value < completion;
    return {
      targetId: target.id,
      seed: passRoll.seed,
      selectedCorrectly,
      completed,
      selectionQuality,
      completion,
      explanation: selectedCorrectly
        ? completed
          ? `读到${target.number}号的空接路线`
          : "空接目标判断正确，但传球线路被破坏"
        : "没有识别最优空接时机",
    };
  }

  const options = evaluateOrdinaryPassOptions(state);
  if (options.length === 0) throw new Error("Ordinary pass requires at least one legal teammate");
  const best = options[0];
  const nextBest = options[1] ?? best;
  const opportunityClarity = clamp((best.opportunityScore - nextBest.opportunityScore) / 24, 0, 1);
  const selectionQuality = clamp(
    0.48
      + attackerContribution(normalized(handler.ratings.basketballIQ) * 0.14, difficulty)
      + attackerContribution(normalized(handler.ratings.passVision) * 0.15, difficulty)
      + attackerContribution(normalized(handler.ratings.passAccuracy) * 0.08, difficulty)
      + attackerContribution(normalized(handler.ratings.decisionSpeed) * 0.07, difficulty)
      + opportunityClarity * 0.06
      + tacticBonus * 0.8,
    0.1,
    0.97,
  );
  const readRoll = nextRandom(state.seed);
  const selectedCorrectly = options.length === 1 || readRoll.value < selectionQuality;
  let selected = best;
  if (!selectedCorrectly) {
    const alternatives = options.slice(1);
    const errorDepth = clamp(
      (readRoll.value - selectionQuality) / Math.max(0.001, 1 - selectionQuality),
      0,
      0.999_999,
    );
    selected = alternatives[Math.min(alternatives.length - 1, Math.floor(errorDepth * alternatives.length))] ?? best;
  }
  const target = getPlayer(selected.targetId);
  const defender = defenderForTarget(state, target);
  const spaceQuality = clamp(selected.receiverSpaceMeters / 4.25, 0, 1);
  const distancePenalty = clamp((selected.passDistanceMeters - 8) / 12, 0, 1);
  const completion = clamp(
    0.84
      + attackerContribution(normalized(handler.ratings.passAccuracy) * 0.08, difficulty)
      + attackerContribution(normalized(handler.ratings.passVision) * 0.035, difficulty)
      + attackerContribution(normalized(handler.ratings.passSpeed) * 0.035, difficulty)
      + attackerContribution(normalized(handler.ratings.ballSecurity) * 0.045, difficulty)
      + normalized(target.ratings.hands) * 0.025
      - (defender ? normalized(defender.ratings.steal) * 0.045 : 0)
      + (spaceQuality - 0.5) * 0.065
      - selected.laneRisk * 0.3
      - distancePenalty * 0.07
      - (selectedCorrectly ? 0 : 0.035)
      + tacticBonus * 0.35,
    0.18,
    0.98,
  );
  const passRoll = nextRandom(readRoll.seed);
  const completed = passRoll.value < completion;
  return {
    targetId: target.id,
    seed: passRoll.seed,
    selectedCorrectly,
    completed,
    selectionQuality,
    completion,
    bestTargetId: best.targetId,
    consideredTargetIds: options.map((option) => option.targetId),
    laneRisk: selected.laneRisk,
    options,
    explanation: selectedCorrectly
      ? completed
        ? `阅读全部${options.length}个接应点 · 找到${target.number}号的最佳机会`
        : `找到${target.number}号的最佳机会，但传球线路被破坏`
      : `未识别${getPlayer(best.targetId).number}号的最优机会 · 转向${target.number}号次优接应点`,
  };
}

export function calculateOffensiveReboundChance(attackingTeam: CourtPlayer["team"] = "home") {
  const offense = players
    .filter((player) => player.team === attackingTeam)
    .map(
      (player) =>
        player.ratings.offensiveRebound * 0.56 +
        player.ratings.vertical * 0.24 +
        player.ratings.strength * 0.2,
    )
    .sort((a, b) => b - a)
    .slice(0, 2);
  const defense = players
    .filter((player) => player.team !== attackingTeam)
    .map(
      (player) =>
        player.ratings.defensiveRebound * 0.58 +
        player.ratings.strength * 0.22 +
        player.ratings.hands * 0.2,
    )
    .sort((a, b) => b - a)
    .slice(0, 2);
  const offensiveStrength = offense.reduce((total, value) => total + value, 0) / offense.length;
  const defensiveStrength = defense.reduce((total, value) => total + value, 0) / defense.length;
  return clamp(0.27 + (offensiveStrength - defensiveStrength) / 180, 0.14, 0.42);
}

export function calculateStealChance(defender: CourtPlayer, handler: CourtPlayer) {
  return clamp(
    0.24 +
      normalized(defender.ratings.steal) * 0.1 +
      normalized(defender.ratings.hands) * 0.04 +
      normalized(defender.ratings.basketballIQ) * 0.03 -
      normalized(handler.ratings.ballSecurity) * 0.08 -
      normalized(handler.ratings.ballHandle) * 0.05,
    0.08,
    0.5,
  );
}

export function calculateBlockChance(defender: CourtPlayer, shooter: CourtPlayer) {
  return clamp(
    0.06 +
      normalized(defender.ratings.block) * 0.1 +
      normalized(defender.ratings.vertical) * 0.05 +
      normalized(defender.ratings.helpDefenseIQ) * 0.03 -
      normalized(shooter.ratings.shotConsistency) * 0.04,
    0.02,
    0.24,
  );
}

export function applySwitchMatchups(state: MatchState, screen: ScreenResolution) {
  if (screen.coverage !== "SWITCH" || screen.result === "MISSED_CONTACT") return state.currentMatchups;
  return {
    ...state.currentMatchups,
    [screen.handlerId]: screen.handlerDefenderAfter,
    [screen.screenerId]: screen.screenerDefenderAfter,
  };
}
