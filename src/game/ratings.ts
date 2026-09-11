import type { Ratings } from "./types";

export const RATING_SCHEMA_VERSION = 1 as const;

export const RATING_IDS = [
  "closeShot",
  "layup",
  "drivingDunk",
  "standingDunk",
  "postFinish",
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
  "speed",
  "speedWithBall",
  "acceleration",
  "strength",
  "vertical",
  "stamina",
  "agility",
  "perimeterDefense",
  "interiorDefense",
  "steal",
  "block",
  "lateralQuickness",
  "screenNavigation",
  "helpDefenseIQ",
  "defenseConsistency",
  "offensiveRebound",
  "defensiveRebound",
  "basketballIQ",
  "hands",
] as const satisfies readonly (keyof Ratings)[];

export type RatingId = (typeof RATING_IDS)[number];

export const RATING_LABELS: Record<RatingId, string> = {
  closeShot: "近距离投篮",
  layup: "上篮",
  drivingDunk: "突破扣篮",
  standingDunk: "原地扣篮",
  postFinish: "低位终结",
  drawFoul: "造犯规",
  midRange: "中投",
  threePoint: "三分",
  freeThrow: "罚球",
  pullUpShot: "急停投篮",
  catchShoot: "接球投篮",
  shotConsistency: "投篮稳定",
  ballHandle: "控球",
  ballSecurity: "护球",
  passAccuracy: "传球准确",
  passVision: "传球视野",
  passSpeed: "传球速度",
  offBallMovement: "无球跑位",
  decisionSpeed: "决策速度",
  speed: "速度",
  speedWithBall: "持球速度",
  acceleration: "加速",
  strength: "力量",
  vertical: "弹跳",
  stamina: "体能",
  agility: "敏捷",
  perimeterDefense: "外线防守",
  interiorDefense: "内线防守",
  steal: "抢断",
  block: "盖帽",
  lateralQuickness: "横向移动",
  screenNavigation: "绕掩护",
  helpDefenseIQ: "协防意识",
  defenseConsistency: "防守稳定",
  offensiveRebound: "进攻篮板",
  defensiveRebound: "防守篮板",
  basketballIQ: "篮球智商",
  hands: "接球能力",
};

export const RATING_GROUPS: readonly { label: string; ids: readonly RatingId[] }[] = [
  { label: "终结", ids: ["closeShot", "layup", "drivingDunk", "standingDunk", "postFinish", "drawFoul"] },
  { label: "投篮", ids: ["midRange", "threePoint", "freeThrow", "pullUpShot", "catchShoot", "shotConsistency"] },
  { label: "组织", ids: ["ballHandle", "ballSecurity", "passAccuracy", "passVision", "passSpeed", "offBallMovement", "decisionSpeed", "basketballIQ", "hands"] },
  { label: "运动", ids: ["speed", "speedWithBall", "acceleration", "strength", "vertical", "stamina", "agility"] },
  { label: "防守", ids: ["perimeterDefense", "interiorDefense", "steal", "block", "lateralQuickness", "screenNavigation", "helpDefenseIQ", "defenseConsistency"] },
  { label: "篮板", ids: ["offensiveRebound", "defensiveRebound"] },
] as const;

export interface RatingsValidation {
  valid: boolean;
  errors: string[];
}

export function validateRatings(ratings: Ratings): RatingsValidation {
  const expected = new Set<string>(RATING_IDS);
  const actual = Object.keys(ratings);
  const errors: string[] = [];

  if (actual.length !== RATING_IDS.length) {
    errors.push(`expected ${RATING_IDS.length} fields, received ${actual.length}`);
  }
  for (const id of RATING_IDS) {
    const value = ratings[id];
    if (!Number.isInteger(value) || value < 25 || value > 99) {
      errors.push(`${id} must be an integer from 25 to 99`);
    }
  }
  for (const id of actual) {
    if (!expected.has(id)) errors.push(`unexpected rating field: ${id}`);
  }

  return { valid: errors.length === 0, errors };
}

export function assertRatings(ratings: Ratings, recordId: string) {
  const result = validateRatings(ratings);
  if (!result.valid) throw new Error(`Invalid ratings for ${recordId}: ${result.errors.join("; ")}`);
}

export function averageRating(ratings: Ratings) {
  return RATING_IDS.reduce((total, id) => total + ratings[id], 0) / RATING_IDS.length;
}
