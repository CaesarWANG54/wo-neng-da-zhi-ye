import { assertRatings, RATING_IDS, type RatingId } from "./ratings";
import { DIFFICULTY_PROGRESSION_POLICY } from "./difficulty";
import type { DifficultyId, Ratings } from "./types";

export {
  DIFFICULTY_PROGRESSION_POLICY,
  scaleControlledAttributeContribution,
  scaleControlledPositiveContribution,
} from "./difficulty";
export type { DifficultyProgressionPolicy } from "./difficulty";

export const CAREER_PROGRESSION_SCHEMA_VERSION = 1 as const;
export const WEEKLY_TRAINING_LIMIT = 2 as const;
export const BASE_ATTRIBUTE_POINT_COST = 90 as const;
export const SECONDARY_PROGRESS_PER_SESSION = 50 as const;
export const SECONDARY_PROGRESS_REQUIRED = 100 as const;
export const INACTIVITY_PROGRESS_REQUIRED = 100 as const;

export type TrainingGroupId =
  | "FINISHING"
  | "SHOOTING"
  | "BALL_HANDLING"
  | "PLAYMAKING"
  | "TACTICS"
  | "ATHLETIC"
  | "DEFENSE"
  | "REBOUNDING";

export interface TrainingGroupDefinition {
  id: TrainingGroupId;
  label: string;
  ratingIds: readonly RatingId[];
}

export const TRAINING_GROUPS: readonly TrainingGroupDefinition[] = [
  { id: "FINISHING", label: "终结训练", ratingIds: ["closeShot", "layup", "drivingDunk", "standingDunk", "postFinish", "drawFoul"] },
  { id: "SHOOTING", label: "投篮训练", ratingIds: ["midRange", "threePoint", "freeThrow", "pullUpShot", "catchShoot", "shotConsistency"] },
  { id: "BALL_HANDLING", label: "控球训练", ratingIds: ["ballHandle", "ballSecurity", "speedWithBall", "agility"] },
  { id: "PLAYMAKING", label: "组织训练", ratingIds: ["passAccuracy", "passVision", "passSpeed", "decisionSpeed", "basketballIQ"] },
  { id: "TACTICS", label: "战术训练", ratingIds: ["offBallMovement", "basketballIQ", "hands", "helpDefenseIQ"] },
  { id: "ATHLETIC", label: "体能训练", ratingIds: ["speed", "speedWithBall", "acceleration", "strength", "vertical", "stamina", "agility"] },
  { id: "DEFENSE", label: "防守训练", ratingIds: ["perimeterDefense", "interiorDefense", "steal", "block", "lateralQuickness", "screenNavigation", "helpDefenseIQ", "defenseConsistency"] },
  { id: "REBOUNDING", label: "篮板训练", ratingIds: ["offensiveRebound", "defensiveRebound", "strength", "vertical", "hands"] },
] as const;

export const TRAINING_GROUP_IDS = TRAINING_GROUPS.map((group) => group.id);

export type ProgressionSource = "TRAINING" | "INACTIVITY" | "PURCHASE" | "AGE";

export interface ProgressionLedgerEntry {
  id: string;
  season: number;
  week: number;
  age: number;
  source: ProgressionSource;
  ratingId: RatingId;
  delta: -1 | 1;
  previousValue: number;
  nextValue: number;
  reason: string;
}

export interface CareerProgressionState {
  schemaVersion: typeof CAREER_PROGRESSION_SCHEMA_VERSION;
  season: number;
  week: number;
  age: number;
  retired: boolean;
  ratings: Ratings;
  rookieBaseline: Ratings;
  coins: number;
  chemistryPercent: number;
  sessionsUsedThisWeek: number;
  trainedGroupsThisWeek: TrainingGroupId[];
  groupDormancyWeeks: Record<TrainingGroupId, number>;
  secondaryProgressUnits: Partial<Record<RatingId, number>>;
  inactivityProgressUnits: Partial<Record<RatingId, number>>;
  seasonInactivityLosses: Partial<Record<RatingId, number>>;
  processedTrainingSessionIds: string[];
  processedWeekIds: string[];
  processedRewardIds: string[];
  processedPurchaseIds: string[];
  processedChemistryEventIds: string[];
  processedSeasonIds: string[];
  ledger: ProgressionLedgerEntry[];
}

export interface TrainingSessionRequest {
  sessionId: string;
  groupId: TrainingGroupId;
  primaryRatingId: RatingId;
  secondaryRatingIds?: readonly RatingId[];
}

export type ChemistryEvent =
  | "WIN"
  | "LOSS"
  | "TACTIC_SUCCESS"
  | "TEAM_TRAINING"
  | "STABLE_ROTATION"
  | "TRADE"
  | "ROLE_CONFLICT"
  | "FATIGUE_CRISIS";

export type CareerGameRewardMode = "PLAYED" | "SIMULATED" | "TUTORIAL";

export interface CareerGameRewardRequest {
  rewardId: string;
  difficulty: DifficultyId;
  gameMinutes: 8 | 12 | 24;
  mode: CareerGameRewardMode;
  completed: boolean;
}

const chemistryEventDelta: Record<ChemistryEvent, number> = {
  WIN: 1,
  LOSS: -1,
  TACTIC_SUCCESS: 1,
  TEAM_TRAINING: 2,
  STABLE_ROTATION: 1,
  TRADE: -4,
  ROLE_CONFLICT: -2,
  FATIGUE_CRISIS: -1,
};

export const GAME_LENGTH_REWARD_MULTIPLIER: Readonly<Record<8 | 12 | 24, number>> = {
  8: 1,
  12: 1.2,
  24: 1.45,
};

const agingGroups = {
  ATHLETIC: ["speed", "speedWithBall", "acceleration", "strength", "vertical", "stamina", "agility"],
  EXECUTION: [
    "closeShot",
    "layup",
    "drivingDunk",
    "standingDunk",
    "postFinish",
    "perimeterDefense",
    "interiorDefense",
    "steal",
    "block",
    "lateralQuickness",
    "screenNavigation",
    "defenseConsistency",
    "offensiveRebound",
    "defensiveRebound",
  ],
  SKILL: [
    "drawFoul",
    "midRange",
    "threePoint",
    "freeThrow",
    "pullUpShot",
    "catchShoot",
    "shotConsistency",
    "ballHandle",
    "ballSecurity",
    "passAccuracy",
    "passVision",
    "passSpeed",
    "offBallMovement",
    "decisionSpeed",
    "helpDefenseIQ",
    "basketballIQ",
    "hands",
  ],
} as const satisfies Record<string, readonly RatingId[]>;

type AgingGroupId = keyof typeof agingGroups;

export interface AgeDeclineBudget {
  athletic: number;
  execution: number;
  skill: number;
}

const progressionSources = new Set<ProgressionSource>(["TRAINING", "INACTIVITY", "PURCHASE", "AGE"]);
const ratingIdSet = new Set<RatingId>(RATING_IDS);
const trainingGroupIdSet = new Set<TrainingGroupId>(TRAINING_GROUP_IDS);

function assertIdList(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || id.trim().length === 0)) {
    throw new Error(`${label} must contain non-empty string IDs`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicate IDs`);
}

function assertPartialRatingUnits(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const [key, units] of Object.entries(value)) {
    if (!ratingIdSet.has(key as RatingId)) throw new Error(`${label} contains unknown rating ${key}`);
    if (!Number.isInteger(units) || (units as number) < 0) throw new Error(`${label}.${key} must be a non-negative integer`);
  }
}

export function assertCareerProgression(value: unknown, context = "career-progression"): asserts value is CareerProgressionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context} must be an object`);
  const state = value as Partial<CareerProgressionState>;
  if (state.schemaVersion !== CAREER_PROGRESSION_SCHEMA_VERSION) throw new Error(`${context} has an unsupported schema version`);
  assertRatings(state.ratings as Ratings, `${context}.ratings`);
  assertRatings(state.rookieBaseline as Ratings, `${context}.rookieBaseline`);
  const integerFields: Array<[string, unknown, number, number]> = [
    ["season", state.season, 1, Number.MAX_SAFE_INTEGER],
    ["week", state.week, 1, Number.MAX_SAFE_INTEGER],
    ["age", state.age, 20, 40],
    ["coins", state.coins, 0, Number.MAX_SAFE_INTEGER],
    ["chemistryPercent", state.chemistryPercent, 0, 100],
    ["sessionsUsedThisWeek", state.sessionsUsedThisWeek, 0, WEEKLY_TRAINING_LIMIT],
  ];
  for (const [field, fieldValue, minimum, maximum] of integerFields) {
    if (!Number.isSafeInteger(fieldValue) || (fieldValue as number) < minimum || (fieldValue as number) > maximum) {
      throw new Error(`${context}.${field} is invalid`);
    }
  }
  if (typeof state.retired !== "boolean" || state.retired !== (state.age === 40)) throw new Error(`${context}.retired is invalid`);
  if (!Array.isArray(state.trainedGroupsThisWeek)
    || state.trainedGroupsThisWeek.some((id) => !trainingGroupIdSet.has(id))) {
    throw new Error(`${context}.trainedGroupsThisWeek is invalid`);
  }
  if (new Set(state.trainedGroupsThisWeek).size !== state.trainedGroupsThisWeek.length) {
    throw new Error(`${context}.trainedGroupsThisWeek contains duplicates`);
  }
  if (!state.groupDormancyWeeks || Object.keys(state.groupDormancyWeeks).length !== TRAINING_GROUP_IDS.length) {
    throw new Error(`${context}.groupDormancyWeeks is incomplete`);
  }
  for (const groupId of TRAINING_GROUP_IDS) {
    if (!Number.isSafeInteger(state.groupDormancyWeeks[groupId]) || state.groupDormancyWeeks[groupId] < 0) {
      throw new Error(`${context}.groupDormancyWeeks.${groupId} is invalid`);
    }
  }
  assertPartialRatingUnits(state.secondaryProgressUnits, `${context}.secondaryProgressUnits`);
  assertPartialRatingUnits(state.inactivityProgressUnits, `${context}.inactivityProgressUnits`);
  assertPartialRatingUnits(state.seasonInactivityLosses, `${context}.seasonInactivityLosses`);
  assertIdList(state.processedTrainingSessionIds, `${context}.processedTrainingSessionIds`);
  assertIdList(state.processedWeekIds, `${context}.processedWeekIds`);
  assertIdList(state.processedRewardIds, `${context}.processedRewardIds`);
  assertIdList(state.processedPurchaseIds, `${context}.processedPurchaseIds`);
  assertIdList(state.processedChemistryEventIds, `${context}.processedChemistryEventIds`);
  assertIdList(state.processedSeasonIds, `${context}.processedSeasonIds`);
  if (!Array.isArray(state.ledger)) throw new Error(`${context}.ledger must be an array`);
  const ledgerIds = new Set<string>();
  let previousSeason = 0;
  let previousWeek = 0;
  const replayedRatings = cloneRatings(state.rookieBaseline as Ratings);
  const currentRatings = state.ratings as Ratings;
  for (const entry of state.ledger) {
    if (!entry || typeof entry !== "object"
      || typeof entry.id !== "string" || !entry.id.trim()
      || !progressionSources.has(entry.source)
      || !ratingIdSet.has(entry.ratingId)
      || (entry.delta !== -1 && entry.delta !== 1)
      || !Number.isInteger(entry.previousValue) || entry.previousValue < 25 || entry.previousValue > 99
      || !Number.isInteger(entry.nextValue) || entry.nextValue < 25 || entry.nextValue > 99
      || entry.nextValue - entry.previousValue !== entry.delta
      || typeof entry.reason !== "string" || !entry.reason.trim()) {
      throw new Error(`${context}.ledger contains an invalid entry`);
    }
    if (ledgerIds.has(entry.id)) throw new Error(`${context}.ledger contains duplicate IDs`);
    ledgerIds.add(entry.id);
    if (!Number.isSafeInteger(entry.season) || entry.season < 1
      || !Number.isSafeInteger(entry.week) || entry.week < 1
      || !Number.isSafeInteger(entry.age) || entry.age < 20 || entry.age > 40) {
      throw new Error(`${context}.ledger contains invalid career coordinates`);
    }
    if (entry.season < previousSeason || (entry.season === previousSeason && entry.week < previousWeek)) {
      throw new Error(`${context}.ledger is not chronological`);
    }
    if (replayedRatings[entry.ratingId] !== entry.previousValue) {
      throw new Error(`${context}.ledger cannot be replayed from the rookie baseline`);
    }
    replayedRatings[entry.ratingId] = entry.nextValue;
    previousSeason = entry.season;
    previousWeek = entry.week;
  }
  if (RATING_IDS.some((ratingId) => replayedRatings[ratingId] !== currentRatings[ratingId])) {
    throw new Error(`${context}.ratings drift from the permanent progression ledger`);
  }
}

function cloneRatings(ratings: Ratings): Ratings {
  return { ...ratings };
}

function emptyGroupCounters(): Record<TrainingGroupId, number> {
  return Object.fromEntries(TRAINING_GROUP_IDS.map((id) => [id, 0])) as Record<TrainingGroupId, number>;
}

function clampInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) throw new Error("Expected a finite number");
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function appendLedger(
  state: CareerProgressionState,
  source: ProgressionSource,
  ratingId: RatingId,
  delta: -1 | 1,
  reason: string,
): CareerProgressionState {
  const previousValue = state.ratings[ratingId];
  const nextValue = clampInteger(previousValue + delta, 25, 99);
  if (nextValue === previousValue) return state;
  const entry: ProgressionLedgerEntry = {
    id: `${state.season}:${state.week}:${state.ledger.length + 1}:${source}:${ratingId}`,
    season: state.season,
    week: state.week,
    age: state.age,
    source,
    ratingId,
    delta,
    previousValue,
    nextValue,
    reason,
  };
  return {
    ...state,
    ratings: { ...state.ratings, [ratingId]: nextValue },
    ledger: [...state.ledger, entry],
  };
}

function trainingGroup(groupId: TrainingGroupId) {
  const group = TRAINING_GROUPS.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`Unknown training group: ${groupId}`);
  return group;
}

export function createCareerProgression(
  ratings: Ratings,
  options: { age?: number; coins?: number; chemistryPercent?: number; season?: number } = {},
): CareerProgressionState {
  assertRatings(ratings, "career-progression-start");
  const age = clampInteger(options.age ?? 20, 20, 40);
  const seasonOption = options.season ?? 1;
  const coinsOption = options.coins ?? 0;
  if (!Number.isFinite(seasonOption) || !Number.isFinite(coinsOption)) throw new Error("Career options must be finite numbers");
  return {
    schemaVersion: CAREER_PROGRESSION_SCHEMA_VERSION,
    season: Math.max(1, Math.floor(seasonOption)),
    week: 1,
    age,
    retired: age >= 40,
    ratings: cloneRatings(ratings),
    rookieBaseline: cloneRatings(ratings),
    coins: Math.max(0, Math.floor(coinsOption)),
    chemistryPercent: clampInteger(options.chemistryPercent ?? 10, 0, 100),
    sessionsUsedThisWeek: 0,
    trainedGroupsThisWeek: [],
    groupDormancyWeeks: emptyGroupCounters(),
    secondaryProgressUnits: {},
    inactivityProgressUnits: {},
    seasonInactivityLosses: {},
    processedTrainingSessionIds: [],
    processedWeekIds: [],
    processedRewardIds: [],
    processedPurchaseIds: [],
    processedChemistryEventIds: [],
    processedSeasonIds: [],
    ledger: [],
  };
}

export function applyTrainingSession(state: CareerProgressionState, request: TrainingSessionRequest): CareerProgressionState {
  const normalizedSessionId = request.sessionId.trim();
  if (!normalizedSessionId) throw new Error("Training session ID is required");
  if (state.processedTrainingSessionIds.includes(normalizedSessionId)) return state;
  if (state.retired) throw new Error("Retired players cannot train");
  if (state.sessionsUsedThisWeek >= WEEKLY_TRAINING_LIMIT) throw new Error("Weekly training limit reached");
  const group = trainingGroup(request.groupId);
  const allowed = new Set<RatingId>(group.ratingIds);
  if (!allowed.has(request.primaryRatingId)) throw new Error("Primary rating is not covered by the selected training group");
  const secondary = [...(request.secondaryRatingIds ?? [])];
  if (secondary.length > 2) throw new Error("A training session supports at most two secondary ratings");
  if (new Set([request.primaryRatingId, ...secondary]).size !== secondary.length + 1) throw new Error("Training ratings must be unique");
  if (secondary.some((id) => !allowed.has(id))) throw new Error("Secondary rating is not covered by the selected training group");
  if (state.ratings[request.primaryRatingId] >= 99) throw new Error("Primary rating is already at 99");

  let next: CareerProgressionState = {
    ...state,
    sessionsUsedThisWeek: state.sessionsUsedThisWeek + 1,
    trainedGroupsThisWeek: state.trainedGroupsThisWeek.includes(request.groupId)
      ? state.trainedGroupsThisWeek
      : [...state.trainedGroupsThisWeek, request.groupId],
    secondaryProgressUnits: { ...state.secondaryProgressUnits },
    inactivityProgressUnits: { ...state.inactivityProgressUnits },
    processedTrainingSessionIds: [...state.processedTrainingSessionIds, normalizedSessionId],
  };
  for (const ratingId of group.ratingIds) next.inactivityProgressUnits[ratingId] = 0;
  next = appendLedger(next, "TRAINING", request.primaryRatingId, 1, `${group.label} · 主属性`);

  for (const ratingId of secondary) {
    if (next.ratings[ratingId] >= 99) {
      next.secondaryProgressUnits[ratingId] = 0;
      continue;
    }
    const progress = (next.secondaryProgressUnits[ratingId] ?? 0) + SECONDARY_PROGRESS_PER_SESSION;
    if (progress >= SECONDARY_PROGRESS_REQUIRED) {
      next.secondaryProgressUnits[ratingId] = progress - SECONDARY_PROGRESS_REQUIRED;
      next = appendLedger(next, "TRAINING", ratingId, 1, `${group.label} · 副属性进度完成`);
    } else {
      next.secondaryProgressUnits[ratingId] = progress;
    }
  }

  assertRatings(next.ratings, "career-progression-training");
  return next;
}

function inactivityRate(dormancyWeeks: number) {
  if (dormancyWeeks <= 3) return 0;
  if (dormancyWeeks <= 7) return 20;
  if (dormancyWeeks <= 15) return 35;
  return 50;
}

function ratingDormancyWeeks(counters: Record<TrainingGroupId, number>, ratingId: RatingId) {
  const values = TRAINING_GROUPS.filter((group) => group.ratingIds.includes(ratingId)).map((group) => counters[group.id]);
  return values.length === 0 ? 0 : Math.min(...values);
}

export function completeTrainingWeek(
  state: CareerProgressionState,
  settlement: { weekId: string; expectedWeek: number },
): CareerProgressionState {
  const normalizedWeekId = settlement.weekId.trim();
  if (!normalizedWeekId) throw new Error("Week ID is required");
  if (state.retired) return state;
  if (state.processedWeekIds.includes(normalizedWeekId)) return state;
  if (settlement.expectedWeek !== state.week) throw new Error("Training week is stale");
  const trained = new Set(state.trainedGroupsThisWeek);
  const groupDormancyWeeks = Object.fromEntries(TRAINING_GROUP_IDS.map((groupId) => [
    groupId,
    trained.has(groupId) ? 0 : state.groupDormancyWeeks[groupId] + 1,
  ])) as Record<TrainingGroupId, number>;

  let next: CareerProgressionState = {
    ...state,
    week: state.week + 1,
    sessionsUsedThisWeek: 0,
    trainedGroupsThisWeek: [],
    groupDormancyWeeks,
    inactivityProgressUnits: { ...state.inactivityProgressUnits },
    seasonInactivityLosses: { ...state.seasonInactivityLosses },
    processedWeekIds: [...state.processedWeekIds, normalizedWeekId],
  };

  for (const ratingId of RATING_IDS) {
    const rate = inactivityRate(ratingDormancyWeeks(groupDormancyWeeks, ratingId));
    if (rate <= 0) continue;
    const accumulated = (next.inactivityProgressUnits[ratingId] ?? 0) + rate;
    const losses = next.seasonInactivityLosses[ratingId] ?? 0;
    const floor = state.age < 32 ? Math.max(25, state.rookieBaseline[ratingId] - 8) : 25;
    if (accumulated >= INACTIVITY_PROGRESS_REQUIRED && losses < 6 && next.ratings[ratingId] > floor) {
      next.inactivityProgressUnits[ratingId] = accumulated - INACTIVITY_PROGRESS_REQUIRED;
      next = appendLedger(next, "INACTIVITY", ratingId, -1, `连续${ratingDormancyWeeks(groupDormancyWeeks, ratingId)}周未维持相关训练`);
      next.seasonInactivityLosses[ratingId] = losses + 1;
    } else {
      next.inactivityProgressUnits[ratingId] = Math.min(accumulated, INACTIVITY_PROGRESS_REQUIRED - 1);
    }
  }

  assertRatings(next.ratings, "career-progression-week");
  return next;
}

export function calculatePlayedMatchReward(difficulty: DifficultyId, gameMinutes: 8 | 12 | 24 = 8) {
  return Math.floor(
    300
      * DIFFICULTY_PROGRESSION_POLICY[difficulty].rewardMultiplier
      * GAME_LENGTH_REWARD_MULTIPLIER[gameMinutes],
  );
}

export function calculateCareerGameReward(request: Omit<CareerGameRewardRequest, "rewardId">) {
  if (!request.completed || request.mode !== "PLAYED") return 0;
  return calculatePlayedMatchReward(request.difficulty, request.gameMinutes);
}

export function settleCareerGameReward(
  state: CareerProgressionState,
  request: CareerGameRewardRequest,
): CareerProgressionState {
  const normalizedRewardId = request.rewardId.trim();
  if (!normalizedRewardId) throw new Error("Reward ID is required");
  if (state.retired) return state;
  if (!request.completed) return state;
  if (state.processedRewardIds.includes(normalizedRewardId)) return state;
  return {
    ...state,
    coins: state.coins + calculateCareerGameReward(request),
    processedRewardIds: [...state.processedRewardIds, normalizedRewardId],
  };
}

export function awardPlayedMatch(
  state: CareerProgressionState,
  rewardId: string,
  difficulty: DifficultyId,
  gameMinutes: 8 | 12 | 24 = 8,
): CareerProgressionState {
  return settleCareerGameReward(state, {
    rewardId,
    difficulty,
    gameMinutes,
    mode: "PLAYED",
    completed: true,
  });
}

export function attributePointCost(currentRating: number): number | null {
  if (!Number.isInteger(currentRating) || currentRating < 25 || currentRating > 99) throw new Error("Rating must be an integer from 25 to 99");
  if (currentRating >= 99) return null;
  if (currentRating <= 79) return BASE_ATTRIBUTE_POINT_COST;
  if (currentRating <= 84) return 120;
  if (currentRating <= 89) return 160;
  if (currentRating <= 94) return 220;
  return 300;
}

export function purchaseAttributePoint(
  state: CareerProgressionState,
  transactionId: string,
  ratingId: RatingId,
): CareerProgressionState {
  const normalizedTransactionId = transactionId.trim();
  if (!normalizedTransactionId) throw new Error("Transaction ID is required");
  if (state.processedPurchaseIds.includes(normalizedTransactionId)) return state;
  if (state.retired) throw new Error("Retired players cannot purchase attributes");
  const cost = attributePointCost(state.ratings[ratingId]);
  if (cost === null) throw new Error("Rating is already at 99");
  if (state.coins < cost) throw new Error("Not enough coins");
  let next = { ...state, coins: state.coins - cost };
  next = appendLedger(next, "PURCHASE", ratingId, 1, `消耗${cost}成长金币`);
  next = { ...next, processedPurchaseIds: [...next.processedPurchaseIds, normalizedTransactionId] };
  assertRatings(next.ratings, "career-progression-purchase");
  return next;
}

export function chemistryRatingBonus(chemistryPercent: number) {
  return Math.min(5, Math.floor(clampInteger(chemistryPercent, 0, 100) / 10));
}

export interface ChemistryCoordinationModifiers {
  routeSettleTimeMultiplier: number;
  misreadRiskMultiplier: number;
  switchCommunicationBonus: number;
}

export function chemistryCoordinationModifiers(chemistryPercent: number): ChemistryCoordinationModifiers {
  const normalized = clampInteger(chemistryPercent, 0, 100);
  const excessRatio = Math.max(0, normalized - 50) / 50;
  return {
    routeSettleTimeMultiplier: 1 - excessRatio * 0.1,
    misreadRiskMultiplier: 1 - excessRatio * 0.2,
    switchCommunicationBonus: excessRatio * 0.05,
  };
}

export function applyChemistryEvent(
  state: CareerProgressionState,
  eventId: string,
  event: ChemistryEvent,
): CareerProgressionState {
  const normalizedEventId = eventId.trim();
  if (!normalizedEventId) throw new Error("Chemistry event ID is required");
  if (state.retired) return state;
  if (state.processedChemistryEventIds.includes(normalizedEventId)) return state;
  return {
    ...state,
    chemistryPercent: clampInteger(state.chemistryPercent + chemistryEventDelta[event], 0, 100),
    processedChemistryEventIds: [...state.processedChemistryEventIds, normalizedEventId],
  };
}

export function effectiveRatings(
  ratings: Ratings,
  chemistryPercent: number,
  temporaryModifiers: Partial<Record<RatingId, number>> = {},
): Ratings {
  const chemistry = chemistryRatingBonus(chemistryPercent);
  return Object.fromEntries(RATING_IDS.map((id) => [
    id,
    clampInteger(ratings[id] + chemistry + (temporaryModifiers[id] ?? 0), 25, 99),
  ])) as unknown as Ratings;
}

export function ageDeclineBudget(age: number): AgeDeclineBudget {
  if (age < 32 || age >= 40) return { athletic: 0, execution: 0, skill: 0 };
  if (age <= 34) return { athletic: 1, execution: age === 32 ? 0 : 1, skill: 0 };
  if (age <= 36) return { athletic: 2, execution: 1, skill: age === 36 ? 1 : 0 };
  if (age === 37) return { athletic: 3, execution: 1, skill: 1 };
  if (age === 38) return { athletic: 3, execution: 2, skill: 1 };
  return { athletic: 4, execution: 2, skill: 2 };
}

function declineGroup(
  state: CareerProgressionState,
  groupId: AgingGroupId,
  budget: number,
  protectedRatingIds: ReadonlySet<RatingId>,
): CareerProgressionState {
  if (budget <= 0) return state;
  const candidates = agingGroups[groupId]
    .filter((id) => !protectedRatingIds.has(id) && state.ratings[id] > 25)
    .sort((first, second) => state.ratings[second] - state.ratings[first] || first.localeCompare(second));
  if (candidates.length === 0) return state;
  const rotation = (state.season + state.age + Object.keys(agingGroups).indexOf(groupId)) % candidates.length;
  let next = state;
  for (let index = 0; index < Math.min(budget, candidates.length); index += 1) {
    const ratingId = candidates[(rotation + index) % candidates.length];
    next = appendLedger(next, "AGE", ratingId, -1, `${state.age}岁赛季年龄衰退 · ${groupId}`);
  }
  return next;
}

export function completeCareerSeason(
  state: CareerProgressionState,
  seasonId: string,
  protectedRatingIds: readonly RatingId[] = [],
): CareerProgressionState {
  const normalizedSeasonId = seasonId.trim();
  if (!normalizedSeasonId) throw new Error("Season ID is required");
  if (state.processedSeasonIds.includes(normalizedSeasonId)) return state;
  if (state.retired) return state;
  const nextAge = state.age + 1;
  if (nextAge >= 40) {
    return {
      ...state,
      age: 40,
      retired: true,
      // There is no playable age-40 season. The completed season remains the
      // final career season while the age changes for the retirement notice.
      season: state.season,
      week: 1,
      sessionsUsedThisWeek: 0,
      trainedGroupsThisWeek: [],
      groupDormancyWeeks: emptyGroupCounters(),
      inactivityProgressUnits: {},
      seasonInactivityLosses: {},
      processedSeasonIds: [...state.processedSeasonIds, normalizedSeasonId],
    };
  }

  const budget = ageDeclineBudget(nextAge);
  // Experience can preserve at most one skill rating. Athletic and execution
  // decline remain mandatory after age 32 unless every candidate is at 25.
  const protectedSet = new Set<RatingId>(
    protectedRatingIds.filter((id) => agingGroups.SKILL.some((skillId) => skillId === id)).slice(0, 1),
  );
  let next: CareerProgressionState = {
    ...state,
    age: nextAge,
    season: state.season + 1,
    week: 1,
    sessionsUsedThisWeek: 0,
    trainedGroupsThisWeek: [],
    groupDormancyWeeks: emptyGroupCounters(),
    inactivityProgressUnits: {},
    seasonInactivityLosses: {},
    processedSeasonIds: [...state.processedSeasonIds, normalizedSeasonId],
  };
  next = declineGroup(next, "ATHLETIC", budget.athletic, protectedSet);
  next = declineGroup(next, "EXECUTION", budget.execution, protectedSet);
  next = declineGroup(next, "SKILL", budget.skill, protectedSet);
  assertRatings(next.ratings, "career-progression-season");
  return next;
}
