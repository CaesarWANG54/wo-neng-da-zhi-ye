import { clamp, nextRandom } from "./core";
import { playerById, players } from "./data";
import { getOpponentTactic, opponentTactics, type OpponentShotOption } from "./opponent-tactics";
import type {
  CourtPlayer,
  DifficultyId,
  MatchState,
  OpponentPlayId,
  OpponentPossessionState,
  OpponentShotType,
  PendingOpponentAttempt,
  Position,
} from "./types";

const awayByPosition = new Map(players.filter((player) => player.team === "away").map((player) => [player.position, player]));

const difficultyDefenseFactors: Record<DifficultyId, number> = {
  ROOKIE: 1.2,
  PRO: 0.9,
  STARTER: 0.8,
  ALL_STAR: 0.75,
  HALL_OF_FAME: 0.7,
};

export type OpponentDecisionResult =
  | { kind: "STAGE"; text: string; patch: Partial<MatchState> }
  | { kind: "ATTEMPT_READY"; text: string; patch: Partial<MatchState> }
  | { kind: "TURNOVER"; text: string; seed: number }
  | {
      kind: "SHOT";
      text: string;
      seed: number;
      made: boolean;
      blocked: boolean;
      probability: number;
      attempt: PendingOpponentAttempt;
    };

function normalized(rating: number) {
  return clamp((rating - 70) / 20, -1.5, 1.45);
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function playerAt(position: Position) {
  const player = awayByPosition.get(position);
  if (!player) throw new Error(`Missing away ${position}`);
  return player;
}

function weightedAverage(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function teamTrait(playId: OpponentPlayId) {
  const pg = playerAt("PG");
  const sg = playerAt("SG");
  const sf = playerAt("SF");
  const pf = playerAt("PF");
  const c = playerAt("C");
  const traits: Record<OpponentPlayId, number> = {
    OPEN_41: weightedAverage([pg.ratings.basketballIQ, pg.ratings.passVision, sg.ratings.offBallMovement, sf.ratings.offBallMovement]),
    PRIN_CHIN: weightedAverage([c.ratings.passVision, c.ratings.basketballIQ, pg.ratings.offBallMovement, sg.ratings.offBallMovement]),
    BLOCKER_MOVER: weightedAverage([sg.ratings.catchShoot, sf.ratings.offBallMovement, pf.ratings.strength, c.ratings.strength]),
    HORNS_STS: weightedAverage([pg.ratings.ballHandle, pg.ratings.passVision, pf.ratings.basketballIQ, c.ratings.basketballIQ]),
    FLEX_CONT: weightedAverage([sg.ratings.basketballIQ, sf.ratings.offBallMovement, pf.ratings.offBallMovement, c.ratings.strength]),
    HIGH_LOW: weightedAverage([pf.ratings.passVision, pf.ratings.basketballIQ, c.ratings.postFinish, c.ratings.strength]),
    DRIBBLE_DRIVE: weightedAverage([pg.ratings.ballHandle, sg.ratings.speedWithBall, sg.ratings.layup, sf.ratings.threePoint]),
    ZONE_OVERLOAD: weightedAverage([pg.ratings.passVision, c.ratings.basketballIQ, pf.ratings.closeShot, sf.ratings.catchShoot]),
    EARLY_DHO: weightedAverage([pg.ratings.speedWithBall, sf.ratings.speed, c.ratings.drivingDunk, pf.ratings.catchShoot]),
  };
  return traits[playId];
}

export function difficultyDefenseFactor(difficulty: DifficultyId) {
  return difficultyDefenseFactors[difficulty];
}

export function canRunOpponentOffense(state: MatchState) {
  return (
    state.possession === "away" &&
    state.gameSeconds > 0 &&
    (state.phase === "SET_OFFENSE" || state.phase === "SECOND_DECISION" || state.phase === "FASTBREAK")
  );
}

export function chooseOpponentPlay(state: MatchState) {
  if (state.phase === "FASTBREAK") {
    return { playId: "EARLY_DHO" as const, seed: state.seed, probability: 1 };
  }

  const last = state.opponentPlayHistory.at(-1);
  const previous = state.opponentPlayHistory.at(-2);
  const eligible = opponentTactics.filter(
    (tactic) => tactic.id !== "EARLY_DHO" && tactic.id !== last,
  );
  const weights = eligible.map((tactic) => {
    const traitWeight = clamp(0.72 + (teamTrait(tactic.id) - 68) / 35, 0.55, 1.45);
    const schemeWeight = state.defenseScheme === "ZONE_2_3"
      ? tactic.id === "ZONE_OVERLOAD"
        ? 5.8
        : tactic.phaseTags.includes("ZONE")
          ? 1.65
          : 0.34
      : tactic.id === "ZONE_OVERLOAD"
        ? 0.16
        : 1;
    const repetitionWeight = tactic.id === previous ? 0.78 : 1;
    return Math.max(0.01, traitWeight * schemeWeight * repetitionWeight);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const roll = nextRandom(state.seed);
  let cursor = roll.value * total;
  for (let index = 0; index < eligible.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return { playId: eligible[index].id, seed: roll.seed, probability: weights[index] / total };
  }
  return { playId: eligible.at(-1)!.id, seed: roll.seed, probability: weights.at(-1)! / total };
}

function emergencyAttempt(): PendingOpponentAttempt {
  const handler = playerAt("PG");
  return {
    shooterId: handler.id,
    shotType: "PULL_UP",
    points: 2,
    label: "压哨急停",
    quality: 0.34,
  };
}

export function startOpponentOffense(state: MatchState) {
  const chosen = chooseOpponentPlay(state);
  const sideRoll = nextRandom(chosen.seed);
  const variantRoll = nextRandom(sideRoll.seed);
  const tactic = getOpponentTactic(chosen.playId);
  const stage = tactic.stages[0];
  const id = `ai-${state.eventSequence + 1}-${variantRoll.seed}`;
  const lateClock = state.shotClock <= 3.1;
  const side = sideRoll.value < 0.5 ? "UPPER" as const : "LOWER" as const;
  let variant = Math.floor(variantRoll.value * 3) as 0 | 1 | 2;
  let guideKey = `${chosen.playId}-${side}-${variant}`;
  if (guideKey === state.lastOpponentGuideKey) {
    variant = ((variant + 1) % 3) as 0 | 1 | 2;
    guideKey = `${chosen.playId}-${side}-${variant}`;
  }
  const offense: OpponentPossessionState = {
    id,
    playId: chosen.playId,
    stageIndex: lateClock ? tactic.stages.length - 1 : 0,
    stage: lateClock ? "SHOT_PREP" : stage.key,
    side,
    variant,
    decisionToken: `${id}-0`,
    decisionCount: 0,
    startedAtShotClock: state.shotClock,
    visibleIntent: lateClock ? "SHOOT" : stage.intent,
    qualityModifier: 0,
    pendingAttempt: lateClock ? emergencyAttempt() : undefined,
  };
  const handler = lateClock ? playerAt("PG") : playerAt(stage.handler);
  return {
    kind: "AI_PLAY_START" as const,
    text: lateClock ? "进攻时间不足 · 对方直接进入压哨出手" : `${tactic.name} · ${stage.label}`,
    patch: {
      seed: variantRoll.seed,
      opponentOffense: offense,
      lastOpponentGuideKey: guideKey,
      opponentPlayHistory: [...state.opponentPlayHistory.slice(-3), chosen.playId],
      pendingDefenseResponse: undefined,
      aiDecisionClock: lateClock ? Math.min(0.62, Math.max(0.12, state.shotClock - 0.08)) : stage.duration,
      ballHandlerId: handler.id,
    } satisfies Partial<MatchState>,
  };
}

function directDefender(state: MatchState, shooterId: string) {
  const entry = Object.entries(state.currentMatchups).find(([, awayId]) => awayId === shooterId);
  return entry ? playerById.get(entry[0]) : undefined;
}

function effectiveDefense(rating: number, defender: CourtPlayer | undefined, state: MatchState) {
  const value = normalized(rating);
  if (!defender || defender.id !== state.controlledPlayerId || value <= 0) return value;
  return value * difficultyDefenseFactor(state.difficulty);
}

function isRimAttempt(type: OpponentShotType) {
  return type === "RIM" || type === "CUT" || type === "ROLL" || type === "POST";
}

function isThreeAttempt(type: OpponentShotType) {
  return type === "THREE" || type === "KICK_THREE";
}

function shotRating(shooter: CourtPlayer, type: OpponentShotType) {
  if (isThreeAttempt(type)) return shooter.ratings.threePoint;
  if (type === "MID_RANGE" || type === "PULL_UP") return shooter.ratings.midRange;
  if (type === "POST") return shooter.ratings.postFinish;
  if (type === "ROLL") return shooter.ratings.closeShot * 0.4 + shooter.ratings.drivingDunk * 0.6;
  return shooter.ratings.layup * 0.58 + shooter.ratings.drivingDunk * 0.42;
}

export function calculateOpponentAttemptChance(state: MatchState, attempt: PendingOpponentAttempt) {
  const shooter = playerById.get(attempt.shooterId);
  if (!shooter) throw new Error(`Unknown opponent shooter: ${attempt.shooterId}`);
  const defender = directDefender(state, shooter.id);
  const pendingResponse = state.pendingDefenseResponse;
  const response = pendingResponse && pendingResponse.decisionToken === state.opponentOffense?.decisionToken
    ? pendingResponse.action
    : undefined;
  let openness = clamp(0.42 + (attempt.quality - 0.5) * 0.85, 0.12, 0.88);
  if (response === "CONTEST") openness -= isRimAttempt(attempt.shotType) ? 0.08 : 0.14;
  if (response === "CONTAIN") openness -= isRimAttempt(attempt.shotType) ? 0.1 : 0.035;
  if (response === "GAMBLE") openness += 0.1;
  if (response === "STEAL_PRESSURE") openness += 0.025;
  if (state.defenseScheme === "ZONE_2_3") openness += isRimAttempt(attempt.shotType) ? -0.065 : 0.025;
  openness = clamp(openness, 0.08, 0.92);

  const attack =
    normalized(shotRating(shooter, attempt.shotType)) * 0.54 +
    normalized(isThreeAttempt(attempt.shotType) ? shooter.ratings.catchShoot : shooter.ratings.shotConsistency) * 0.13 +
    normalized(shooter.ratings.basketballIQ) * 0.08 +
    (attempt.shotType === "PULL_UP" ? normalized(shooter.ratings.pullUpShot) * 0.12 : 0);

  if (!defender) return clamp(sigmoid((isThreeAttempt(attempt.shotType) ? -0.42 : 0.08) + attack + (openness - 0.5) * 1.55), 0.05, 0.92);

  if (!isRimAttempt(attempt.shotType)) {
    const defense =
      effectiveDefense(defender.ratings.perimeterDefense, defender, state) * 0.4 +
      effectiveDefense(defender.ratings.lateralQuickness, defender, state) * 0.15 +
      effectiveDefense(defender.ratings.defenseConsistency, defender, state) * 0.07;
    const base = isThreeAttempt(attempt.shotType) ? -0.42 : -0.08;
    return clamp(sigmoid(base + attack - defense + (openness - 0.5) * 1.55), 0.05, 0.88);
  }

  const helper = players
    .filter((player) => player.team === "home" && player.id !== defender.id && (player.position === "PF" || player.position === "C"))
    .sort((first, second) => second.ratings.helpDefenseIQ + second.ratings.interiorDefense - first.ratings.helpDefenseIQ - first.ratings.interiorDefense)[0];
  const pointDefense =
    effectiveDefense(defender.ratings.interiorDefense, defender, state) * 0.18 +
    effectiveDefense(defender.ratings.lateralQuickness, defender, state) * 0.08;
  const helpDefense = helper
    ? effectiveDefense(helper.ratings.interiorDefense, helper, state) * 0.22 +
      effectiveDefense(helper.ratings.block, helper, state) * 0.14 +
      effectiveDefense(helper.ratings.helpDefenseIQ, helper, state) * 0.09
    : 0;
  return clamp(sigmoid(0.18 + attack - pointDefense - helpDefense + (openness - 0.5) * 1.5), 0.05, 0.93);
}

export function calculateOpponentTurnoverChance(state: MatchState) {
  const handler = playerById.get(state.ballHandlerId);
  if (!handler) return 0.08;
  const pendingResponse = state.pendingDefenseResponse;
  const response = pendingResponse && pendingResponse.decisionToken === state.opponentOffense?.decisionToken
    ? pendingResponse.action
    : undefined;
  const security = weightedAverage([
    handler.ratings.ballSecurity,
    handler.ratings.passAccuracy,
    handler.ratings.passVision,
    handler.ratings.basketballIQ,
  ]);
  const pressure = response === "STEAL_PRESSURE" ? 0.045 : response === "GAMBLE" ? 0.06 : 0;
  return clamp(0.072 - (security - 70) / 360 + (state.defenseScheme === "ZONE_2_3" ? 0.012 : 0) + pressure, 0.018, 0.19);
}

function optionUtility(state: MatchState, option: OpponentShotOption) {
  const shooter = playerAt(option.shooter);
  const defender = directDefender(state, shooter.id);
  const relevantDefense = defender
    ? isRimAttempt(option.shotType)
      ? defender.ratings.interiorDefense * 0.65 + defender.ratings.block * 0.35
      : defender.ratings.perimeterDefense * 0.7 + defender.ratings.lateralQuickness * 0.3
    : 70;
  return option.quality * 58 + shotRating(shooter, option.shotType) * 0.42 + shooter.ratings.shotConsistency * 0.12 - relevantDefense * 0.18;
}

function chooseAttempt(state: MatchState, options: OpponentShotOption[]) {
  const ranked = [...options].sort((first, second) => optionUtility(state, second) - optionUtility(state, first));
  const handler = playerById.get(state.ballHandlerId) ?? playerAt("PG");
  const readChance = clamp(
    0.54 +
      (handler.ratings.basketballIQ - 70) / 145 +
      (handler.ratings.passVision - 70) / 190 +
      (handler.ratings.decisionSpeed - 70) / 220,
    0.38,
    0.93,
  );
  const roll = nextRandom(state.seed);
  const selected = roll.value < readChance ? ranked[0] : ranked[Math.min(1, ranked.length - 1)];
  const shooter = playerAt(selected.shooter);
  return {
    seed: roll.seed,
    attempt: {
      shooterId: shooter.id,
      shotType: selected.shotType,
      points: isThreeAttempt(selected.shotType) ? 3 : 2,
      label: selected.label,
      quality: clamp(selected.quality + (selected === ranked[0] ? 0.045 : -0.055), 0.18, 0.88),
    } satisfies PendingOpponentAttempt,
  };
}

function responseWindow(state: MatchState) {
  return state.phase === "FASTBREAK" ? 0.62 : 0.9;
}

function nextDecisionToken(offense: OpponentPossessionState) {
  return `${offense.id}-${offense.decisionCount + 1}`;
}

function consumedResponseModifier(state: MatchState) {
  const offense = state.opponentOffense;
  const response = state.pendingDefenseResponse;
  if (!offense || !response || response.decisionToken !== offense.decisionToken) return 0;
  if (response.action === "GAMBLE") return 0.075;
  if (response.action === "CONTAIN") return offense.visibleIntent === "DRIVE" || offense.visibleIntent === "BALL_SCREEN" ? -0.075 : -0.018;
  if (response.action === "CONTEST") return offense.visibleIntent === "SHOOT" ? -0.04 : -0.012;
  if (response.action === "STEAL_PRESSURE") return -0.01;
  if (response.action === "SWITCH") return -0.025;
  return 0;
}

export function advanceOpponentDecision(state: MatchState): OpponentDecisionResult {
  const offense = state.opponentOffense;
  if (!offense) throw new Error("Opponent decision requires an active offense");
  const tactic = getOpponentTactic(offense.playId);

  if (offense.pendingAttempt) {
    const probability = calculateOpponentAttemptChance(state, offense.pendingAttempt);
    const shotRoll = nextRandom(state.seed);
    const made = shotRoll.value < probability;
    const defender = directDefender(state, offense.pendingAttempt.shooterId);
    const blockRoll = nextRandom(shotRoll.seed);
    const response = state.pendingDefenseResponse?.decisionToken === offense.decisionToken
      ? state.pendingDefenseResponse.action
      : undefined;
    const rimBias = isRimAttempt(offense.pendingAttempt.shotType) ? 0.055 : 0.012;
    const blockChance = defender
      ? clamp(rimBias + normalized(defender.ratings.block) * 0.075 + normalized(defender.ratings.vertical) * 0.035 + (response === "CONTEST" ? 0.035 : 0), 0.01, 0.23)
      : 0.01;
    const blocked = !made && blockRoll.value < blockChance;
    return {
      kind: "SHOT",
      text: `${tactic.name} · ${offense.pendingAttempt.label}`,
      seed: blockRoll.seed,
      made,
      blocked,
      probability,
      attempt: offense.pendingAttempt,
    };
  }

  const currentStage = tactic.stages[offense.stageIndex];
  const carriedQuality = clamp(offense.qualityModifier + consumedResponseModifier(state), -0.14, 0.14);
  const passRisk = currentStage.intent === "PASS" || currentStage.intent === "HANDOFF";
  let seed = state.seed;
  if (passRisk) {
    const turnoverRoll = nextRandom(seed);
    seed = turnoverRoll.seed;
    if (turnoverRoll.value < calculateOpponentTurnoverChance(state)) {
      return { kind: "TURNOVER", text: `${tactic.name}传球线路被破坏 · 我方形成快攻`, seed };
    }
  }

  const mustShoot = state.shotClock <= 2.2;
  const finalStage = offense.stageIndex >= tactic.stages.length - 1;
  if (finalStage || mustShoot) {
    const options = currentStage.options ?? tactic.stages.at(-1)?.options ?? [];
    const selected = options.length > 0 ? chooseAttempt({ ...state, seed }, options) : { seed, attempt: emergencyAttempt() };
    selected.attempt.quality = clamp(selected.attempt.quality + carriedQuality, 0.12, 0.92);
    const decisionCount = offense.decisionCount + 1;
    const nextOffense: OpponentPossessionState = {
      ...offense,
      stage: "SHOT_PREP",
      visibleIntent: "SHOOT",
      decisionCount,
      decisionToken: `${offense.id}-${decisionCount}`,
      qualityModifier: carriedQuality,
      pendingAttempt: selected.attempt,
    };
    const assistPlayerId = state.ballHandlerId !== selected.attempt.shooterId
      ? state.ballHandlerId
      : state.potentialAssistReceiverId === selected.attempt.shooterId
        ? state.potentialAssistPlayerId
        : undefined;
    return {
      kind: "ATTEMPT_READY",
      text: `${tactic.name}完成阅读 · ${selected.attempt.label}`,
      patch: {
        seed: selected.seed,
        opponentOffense: nextOffense,
        ballHandlerId: selected.attempt.shooterId,
        potentialAssistPlayerId: assistPlayerId,
        potentialAssistReceiverId: assistPlayerId ? selected.attempt.shooterId : undefined,
        pendingDefenseResponse: undefined,
        aiDecisionClock: Math.min(responseWindow(state), Math.max(0.1, state.shotClock - 0.06)),
      },
    };
  }

  const nextIndex = offense.stageIndex + 1;
  const nextStage = tactic.stages[nextIndex];
  const decisionCount = offense.decisionCount + 1;
  const nextOffense: OpponentPossessionState = {
    ...offense,
    stageIndex: nextIndex,
    stage: nextStage.key,
    visibleIntent: nextStage.intent,
    decisionCount,
    decisionToken: nextDecisionToken(offense),
    qualityModifier: carriedQuality,
  };
  const nextHandlerId = playerAt(nextStage.handler).id;
  const handlerChanged = nextHandlerId !== state.ballHandlerId;
  return {
    kind: "STAGE",
    text: `${tactic.name} · ${nextStage.label}`,
    patch: {
      seed,
      opponentOffense: nextOffense,
      ballHandlerId: nextHandlerId,
      potentialAssistPlayerId: handlerChanged ? state.ballHandlerId : state.potentialAssistPlayerId,
      potentialAssistReceiverId: handlerChanged ? nextHandlerId : state.potentialAssistReceiverId,
      pendingDefenseResponse: undefined,
      aiDecisionClock: Math.min(nextStage.duration, Math.max(0.12, state.shotClock - 1.05)),
    },
  };
}
