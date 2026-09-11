import { nextRandom } from "./core";
import { draftPickTeamIds2026 } from "./draft-2026";
import { assertJerseyNumber, type JerseyNumber } from "./jersey-number";
import { assertRatings, averageRating, RATING_IDS, type RatingId } from "./ratings";
import type { Position, Ratings } from "./types";

export {
  assertJerseyNumber,
  isValidJerseyNumber,
  jerseyNumberFromOrdinal,
  jerseyNumberOrdinal,
  stepJerseyNumber,
} from "./jersey-number";

export type CreationTemplateId =
  | "PG_DEEP_RANGE"
  | "PG_MIDRANGE_CREATOR"
  | "PG_RIM_ATTACKER"
  | "PG_FLOOR_GENERAL"
  | "PG_BIG_CREATOR"
  | "PG_ISOLATION_MAESTRO"
  | "PG_PICK_ROLL_ENGINE"
  | "SG_SPEED_SCORER"
  | "SG_POWER_SHOOTER"
  | "SG_POWER_FINISHER"
  | "SG_ENGINE"
  | "SG_COMBO_GUARD"
  | "SG_MOVEMENT_SNIPER"
  | "SF_TWO_WAY_LOCK"
  | "SF_HIGH_RELEASE"
  | "SF_ALL_AROUND"
  | "SF_POINT_FORWARD"
  | "SF_POWER_SLASHER"
  | "PF_RIM_SWEEPER"
  | "PF_PLAYMAKING_DEFENDER"
  | "PF_STRETCH_BIG"
  | "PF_POWER_FINISHER"
  | "PF_TALL_SHOTMAKER"
  | "PF_TWO_WAY_PILLAR"
  | "C_HIGH_POST_HUB"
  | "C_LENGTH_RIM_PROTECTOR"
  | "C_STRETCH_RIM_PROTECTOR"
  | "C_MID_POST_SCORER"
  | "C_RIM_ANCHOR"
  | "C_PAINT_DOMINATOR";

export interface CreationTemplate {
  id: CreationTemplateId;
  position: Position;
  name: string;
  referenceName: string;
  description: string;
  coreRatings: readonly [RatingId, RatingId];
  boosts: Partial<Record<RatingId, number>>;
  weaknesses: Partial<Record<RatingId, number>>;
  tacticalRole: string;
}

const templateTacticalRoles: Record<CreationTemplateId, string> = {
  PG_DEEP_RANGE: "超远牵制 · 无球绕掩护",
  PG_MIDRANGE_CREATOR: "空侧挡拆 · 降速造杀伤",
  PG_RIM_ATTACKER: "转换提速 · 强侧冲筐",
  PG_FLOOR_GENERAL: "提前出球 · 弱侧快转移",
  PG_BIG_CREATOR: "换防点名 · 低位吸引夹击",
  PG_ISOLATION_MAESTRO: "清空侧翼 · 连续变向单打",
  PG_PICK_ROLL_ENGINE: "高位挡拆 · 后撤步或分球",
  SG_SPEED_SCORER: "转换推进 · 高位挡拆突破",
  SG_POWER_SHOOTER: "高位挡拆 · 爆发急停远投",
  SG_POWER_FINISHER: "空侧突破 · 底线切入",
  SG_ENGINE: "肘区接球 · 二次挡拆组织",
  SG_COMBO_GUARD: "肘区背打 · 关键回合主防",
  SG_MOVEMENT_SNIPER: "电梯门掩护 · 弱侧接球投",
  SF_TWO_WAY_LOCK: "肘区单打 · 主防持球核心",
  SF_HIGH_RELEASE: "侧翼挡拆 · 换防后急停干拔",
  SF_ALL_AROUND: "五外侧翼 · 弱侧换位",
  SF_POINT_FORWARD: "控球前锋 · 突破分球",
  SF_POWER_SLASHER: "弱侧空切 · 转换冲筐",
  PF_RIM_SWEEPER: "转换持球 · 短顺下",
  PF_PLAYMAKING_DEFENDER: "肘区面框 · 强弱侧策应",
  PF_STRETCH_BIG: "五外站位 · 挡拆后外弹",
  PF_POWER_FINISHER: "手递手顺下 · 低位卡位",
  PF_TALL_SHOTMAKER: "高位错位 · 中投拔起终结",
  PF_TWO_WAY_PILLAR: "低位轴心 · 沉退护筐",
  C_HIGH_POST_HUB: "高位策应 · 低位分球",
  C_LENGTH_RIM_PROTECTOR: "弱侧护筐 · 顺下终结",
  C_STRETCH_RIM_PROTECTOR: "挡拆外弹 · 弱侧协防",
  C_MID_POST_SCORER: "肘区单打 · 中距离终结",
  C_RIM_ANCHOR: "深位护筐 · 掩护顺下",
  C_PAINT_DOMINATOR: "深位要球 · 强攻前场篮板",
};

const templateReferenceNames: Record<CreationTemplateId, string> = {
  PG_DEEP_RANGE: "库里",
  PG_MIDRANGE_CREATOR: "亚历山大",
  PG_RIM_ATTACKER: "莫兰特",
  PG_FLOOR_GENERAL: "哈里伯顿",
  PG_BIG_CREATOR: "东契奇",
  PG_ISOLATION_MAESTRO: "欧文",
  PG_PICK_ROLL_ENGINE: "哈登",
  SG_SPEED_SCORER: "马克西",
  SG_POWER_SHOOTER: "米切尔",
  SG_POWER_FINISHER: "爱德华兹",
  SG_ENGINE: "布克",
  SG_COMBO_GUARD: "科比",
  SG_MOVEMENT_SNIPER: "汤普森",
  SF_TWO_WAY_LOCK: "伦纳德",
  SF_HIGH_RELEASE: "保罗乔治",
  SF_ALL_AROUND: "塔图姆",
  SF_POINT_FORWARD: "詹姆斯",
  SF_POWER_SLASHER: "布朗",
  PF_RIM_SWEEPER: "字母哥",
  PF_PLAYMAKING_DEFENDER: "班凯罗",
  PF_STRETCH_BIG: "唐斯",
  PF_POWER_FINISHER: "锡安",
  PF_TALL_SHOTMAKER: "杜兰特",
  PF_TWO_WAY_PILLAR: "邓肯",
  C_HIGH_POST_HUB: "约基奇",
  C_LENGTH_RIM_PROTECTOR: "文班亚马",
  C_STRETCH_RIM_PROTECTOR: "霍姆格伦",
  C_MID_POST_SCORER: "恩比德",
  C_RIM_ANCHOR: "戈贝尔",
  C_PAINT_DOMINATOR: "奥尼尔",
};

function template(
  id: CreationTemplateId,
  position: Position,
  name: string,
  description: string,
  coreRatings: readonly [RatingId, RatingId],
  boosts: Partial<Record<RatingId, number>>,
  weaknesses: Partial<Record<RatingId, number>>,
): CreationTemplate {
  return { id, position, name, referenceName: templateReferenceNames[id], description, coreRatings, boosts, weaknesses, tacticalRole: templateTacticalRoles[id] };
}

export function creationTemplateLabel(template: Pick<CreationTemplate, "name" | "referenceName">) {
  return `${template.name}（${template.referenceName}）`;
}

export const creationTemplates: readonly CreationTemplate[] = [
  template("PG_DEEP_RANGE", "PG", "超远无球核心", "借助连续掩护把防线拉到三分线外", ["threePoint", "catchShoot"], { offBallMovement: 7, pullUpShot: 6, ballHandle: 4, shotConsistency: 5 }, { strength: 58, interiorDefense: 56, standingDunk: 55 }),
  template("PG_MIDRANGE_CREATOR", "PG", "节奏造杀手", "用启停节奏进入中距离并主动制造身体接触", ["midRange", "drawFoul"], { pullUpShot: 7, ballSecurity: 6, layup: 5, decisionSpeed: 4 }, { threePoint: 63, standingDunk: 55, offensiveRebound: 57 }),
  template("PG_RIM_ATTACKER", "PG", "爆发冲框发动机", "依靠第一步、滞空和转换速度持续冲击篮筐", ["speed", "drivingDunk"], { acceleration: 7, vertical: 7, layup: 6, speedWithBall: 5 }, { threePoint: 61, shotConsistency: 60, interiorDefense: 57 }),
  template("PG_FLOOR_GENERAL", "PG", "快速分球指挥官", "在防守收缩前完成提前出球和跨场转移", ["passVision", "passSpeed"], { passAccuracy: 7, decisionSpeed: 7, basketballIQ: 6, ballHandle: 4 }, { strength: 59, postFinish: 57, standingDunk: 55 }),
  template("PG_BIG_CREATOR", "PG", "错位持球大核", "用体型、控球和阅读能力点名错位防守", ["ballHandle", "basketballIQ"], { passVision: 7, passAccuracy: 6, strength: 7, postFinish: 5 }, { speed: 63, lateralQuickness: 60, screenNavigation: 59 }),
  template("PG_ISOLATION_MAESTRO", "PG", "变向单打艺术家", "以细密运球和左右手终结破解单防", ["ballHandle", "layup"], { ballSecurity: 7, agility: 7, pullUpShot: 6, hands: 4 }, { interiorDefense: 55, defensiveRebound: 58, standingDunk: 54 }),
  template("PG_PICK_ROLL_ENGINE", "PG", "挡拆造犯规引擎", "高频发起挡拆并在后撤步、造犯规和分球间选择", ["passAccuracy", "drawFoul"], { ballHandle: 7, threePoint: 6, basketballIQ: 6, ballSecurity: 5, pullUpShot: 4 }, { offBallMovement: 60, lateralQuickness: 59, interiorDefense: 56 }),

  template("SG_SPEED_SCORER", "SG", "转换极速火力", "接到推进球后用持球速度制造早攻机会", ["speedWithBall", "acceleration"], { speed: 7, threePoint: 6, layup: 5, pullUpShot: 4 }, { interiorDefense: 57, postFinish: 58, standingDunk: 59 }),
  template("SG_POWER_SHOOTER", "SG", "爆发双能得分手", "利用爆发第一步和挡拆急停覆盖三个得分区域", ["threePoint", "pullUpShot"], { drivingDunk: 7, vertical: 6, ballHandle: 5, shotConsistency: 4 }, { interiorDefense: 58, offensiveRebound: 57, block: 55 }),
  template("SG_POWER_FINISHER", "SG", "对抗冲筐王牌", "通过力量、起跳高度和直线突破完成终结", ["drivingDunk", "strength"], { layup: 7, perimeterDefense: 6, acceleration: 5, vertical: 5 }, { passVision: 60, passAccuracy: 61, screenNavigation: 62 }),
  template("SG_ENGINE", "SG", "中距离进攻引擎", "从肘区和二次挡拆发起中投、突破与传球", ["midRange", "shotConsistency"], { pullUpShot: 7, ballHandle: 6, passAccuracy: 5, decisionSpeed: 5 }, { interiorDefense: 58, offensiveRebound: 57, standingDunk: 60 }),
  template("SG_COMBO_GUARD", "SG", "攻防背身终结者", "用脚步和背身技术取分，同时承担关键外线对位", ["postFinish", "defenseConsistency"], { midRange: 7, perimeterDefense: 7, pullUpShot: 5, ballSecurity: 4 }, { threePoint: 63, offensiveRebound: 58, block: 57 }),
  template("SG_MOVEMENT_SNIPER", "SG", "无球跑射专家", "依靠绕掩护、快速落位和接球出手惩罚协防", ["catchShoot", "perimeterDefense"], { threePoint: 7, offBallMovement: 7, shotConsistency: 6, screenNavigation: 5 }, { ballHandle: 61, passVision: 59, drivingDunk: 57 }),

  template("SF_TWO_WAY_LOCK", "SF", "双向中投锁翼", "以外线压迫切断持球点，再用稳定中投完成回合", ["perimeterDefense", "midRange"], { steal: 7, defenseConsistency: 7, strength: 6, lateralQuickness: 6, helpDefenseIQ: 4 }, { passSpeed: 62, speedWithBall: 61, standingDunk: 60 }),
  template("SF_HIGH_RELEASE", "SF", "双向持球侧翼", "用持球投射拉开空间，并靠横移覆盖多个外线位置", ["threePoint", "lateralQuickness"], { pullUpShot: 7, perimeterDefense: 7, ballHandle: 5, catchShoot: 4 }, { interiorDefense: 61, offensiveRebound: 58, standingDunk: 62 }),
  template("SF_ALL_AROUND", "SF", "空间全能锋线", "在五外体系中兼顾远投、篮板和换防", ["threePoint", "defensiveRebound"], { layup: 5, drivingDunk: 5, perimeterDefense: 6, strength: 4 }, { passVision: 63, passSpeed: 60, ballHandle: 63 }),
  template("SF_POINT_FORWARD", "SF", "推进组织前锋", "抢下篮板后直接推进，以力量突破吸引协防", ["passVision", "strength"], { passAccuracy: 7, decisionSpeed: 6, layup: 7, basketballIQ: 7, ballHandle: 5 }, { freeThrow: 60, catchShoot: 61, shotConsistency: 62 }),
  template("SF_POWER_SLASHER", "SF", "强硬突击侧翼", "从弱侧空切或面框强突，同时承担主要侧翼对位", ["drivingDunk", "perimeterDefense"], { strength: 7, layup: 6, acceleration: 5, defenseConsistency: 4 }, { ballSecurity: 62, passVision: 59, passAccuracy: 61 }),

  template("PF_RIM_SWEEPER", "PF", "全场冲击扫荡者", "从防守覆盖、转换推进到顺下终结连续影响回合", ["drivingDunk", "interiorDefense"], { layup: 7, helpDefenseIQ: 7, speed: 6, block: 5 }, { threePoint: 56, freeThrow: 60, pullUpShot: 57 }),
  template("PF_PLAYMAKING_DEFENDER", "PF", "强攻策应前锋", "在肘区面框强打并读取弱侧包夹后的传球窗口", ["postFinish", "passVision"], { layup: 7, ballHandle: 6, strength: 6, passAccuracy: 5 }, { threePoint: 61, block: 58, screenNavigation: 60 }),
  template("PF_STRETCH_BIG", "PF", "内外空间内线", "在外弹远投和低位错位之间切换，扩大进攻空间", ["threePoint", "closeShot"], { catchShoot: 7, postFinish: 6, offensiveRebound: 5, defensiveRebound: 4 }, { lateralQuickness: 58, perimeterDefense: 59, ballHandle: 57 }),
  template("PF_POWER_FINISHER", "PF", "重型爆发终结手", "凭力量和垂直爆发在近筐强势完成进攻", ["strength", "standingDunk"], { closeShot: 7, drivingDunk: 7, vertical: 6, layup: 5 }, { perimeterDefense: 59, stamina: 60, threePoint: 55 }),
  template("PF_TALL_SHOTMAKER", "PF", "高点无解得分手", "利用身高和出手点在错位防守前完成中远投", ["midRange", "pullUpShot"], { threePoint: 7, catchShoot: 6, shotConsistency: 6, ballHandle: 5 }, { strength: 59, offensiveRebound: 57, screenNavigation: 60 }),
  template("PF_TWO_WAY_PILLAR", "PF", "低位防守基石", "以低位脚步完成进攻，并用站位和篮板稳住禁区", ["interiorDefense", "defensiveRebound"], { postFinish: 7, closeShot: 7, helpDefenseIQ: 6, block: 5 }, { threePoint: 56, speedWithBall: 55, acceleration: 59 }),

  template("C_HIGH_POST_HUB", "C", "高位全能策应轴", "在高位读取切入、手递手与低位错位机会", ["basketballIQ", "passAccuracy"], { passVision: 7, closeShot: 7, postFinish: 6, hands: 6 }, { speed: 57, vertical: 59, lateralQuickness: 56 }),
  template("C_LENGTH_RIM_PROTECTOR", "C", "覆盖型持球护筐塔", "用覆盖面积保护篮筐，并在转换中保留持球威胁", ["block", "vertical"], { interiorDefense: 7, helpDefenseIQ: 7, ballHandle: 5, threePoint: 4 }, { strength: 58, ballSecurity: 59, screenNavigation: 60 }),
  template("C_STRETCH_RIM_PROTECTOR", "C", "轻型空间护筐手", "外弹拉开禁区后回到弱侧完成协防封盖", ["block", "threePoint"], { interiorDefense: 7, catchShoot: 6, helpDefenseIQ: 6, agility: 4 }, { strength: 58, offensiveRebound: 60, postFinish: 59 }),
  template("C_MID_POST_SCORER", "C", "肘区造杀中锋", "在肘区和低位用脚步、投篮与接触持续得分", ["postFinish", "drawFoul"], { closeShot: 7, midRange: 7, interiorDefense: 5, shotConsistency: 5 }, { stamina: 61, passAccuracy: 60, ballSecurity: 60 }),
  template("C_RIM_ANCHOR", "C", "禁区防守屏障", "专注沉退护筐、防守篮板和掩护顺下", ["interiorDefense", "block"], { defensiveRebound: 7, strength: 7, standingDunk: 6, helpDefenseIQ: 6 }, { ballHandle: 55, threePoint: 55, midRange: 58 }),
  template("C_PAINT_DOMINATOR", "C", "低位统治巨兽", "建立深位后用力量扣篮，并冲抢二次进攻机会", ["standingDunk", "strength"], { closeShot: 7, postFinish: 7, offensiveRebound: 7, drawFoul: 5 }, { threePoint: 52, freeThrow: 55, speedWithBall: 54 }),
] as const;

export const creationTemplateById = new Map(creationTemplates.map((item) => [item.id, item]));

const positionOffsets: Record<Position, Partial<Record<RatingId, number>>> = {
  PG: { ballHandle: 4, ballSecurity: 3, passAccuracy: 3, passVision: 3, speedWithBall: 3, speed: 2, acceleration: 2, standingDunk: -8, interiorDefense: -6, block: -9, offensiveRebound: -7, postFinish: -5, strength: -4 },
  SG: { threePoint: 2, pullUpShot: 2, catchShoot: 2, speed: 2, acceleration: 2, ballHandle: 2, perimeterDefense: 1, standingDunk: -5, interiorDefense: -4, block: -6, offensiveRebound: -5, postFinish: -3 },
  SF: { layup: 2, drivingDunk: 2, threePoint: 1, strength: 2, perimeterDefense: 2, defensiveRebound: 2, passVision: -1, ballHandle: -1, block: -1 },
  PF: { closeShot: 3, standingDunk: 4, strength: 4, interiorDefense: 3, helpDefenseIQ: 2, offensiveRebound: 3, defensiveRebound: 4, speedWithBall: -5, ballHandle: -4, passSpeed: -2, threePoint: -2, pullUpShot: -3 },
  C: { closeShot: 5, standingDunk: 6, postFinish: 4, strength: 5, interiorDefense: 5, block: 5, offensiveRebound: 5, defensiveRebound: 6, hands: 3, speed: -6, speedWithBall: -9, ballHandle: -8, lateralQuickness: -7, perimeterDefense: -5, threePoint: -5, pullUpShot: -5 },
};

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function baseRatings(position: Position): Ratings {
  const ratings = Object.fromEntries(RATING_IDS.map((id) => [id, 69])) as unknown as Ratings;
  for (const [id, offset] of Object.entries(positionOffsets[position]) as Array<[RatingId, number]>) {
    ratings[id] = clampInteger(ratings[id] + offset, 55, 76);
  }
  return ratings;
}

function balanceToRookieAverage(ratings: Ratings, protectedIds: Set<RatingId>) {
  const targetTotal = 70 * RATING_IDS.length;
  const adjustable = RATING_IDS.filter((id) => !protectedIds.has(id));
  let difference = targetTotal - RATING_IDS.reduce((sum, id) => sum + ratings[id], 0);
  let guard = 0;
  while (difference !== 0 && guard < 10_000) {
    guard += 1;
    let changed = false;
    for (const id of adjustable) {
      if (difference > 0 && ratings[id] < 76) {
        ratings[id] += 1;
        difference -= 1;
        changed = true;
      } else if (difference < 0 && ratings[id] > 62) {
        ratings[id] -= 1;
        difference += 1;
        changed = true;
      }
      if (difference === 0) break;
    }
    if (!changed) throw new Error("Unable to balance rookie ratings");
  }
  if (difference !== 0) throw new Error("Rookie rating balance did not converge");
}

export function generateRookieRatings(position: Position, templateId: CreationTemplateId): Ratings {
  const selected = creationTemplateById.get(templateId);
  if (!selected) throw new Error(`Unknown creation template: ${templateId}`);
  if (selected.position !== position) throw new Error(`${templateId} is not available for ${position}`);

  const ratings = baseRatings(position);
  for (const [id, boost] of Object.entries(selected.boosts) as Array<[RatingId, number]>) {
    ratings[id] = clampInteger(ratings[id] + boost, 25, 77);
  }
  for (const [id, value] of Object.entries(selected.weaknesses) as Array<[RatingId, number]>) {
    ratings[id] = clampInteger(value, 55, 64);
  }
  ratings[selected.coreRatings[0]] = 80;
  ratings[selected.coreRatings[1]] = 79;

  const protectedIds = new Set<RatingId>([
    ...selected.coreRatings,
    ...(Object.keys(selected.boosts) as RatingId[]),
    ...(Object.keys(selected.weaknesses) as RatingId[]),
  ]);
  balanceToRookieAverage(ratings, protectedIds);
  assertRatings(ratings, `created-${templateId}`);
  return ratings;
}

export function generateTutorialRatings(position: Position, templateId: CreationTemplateId): Ratings {
  const rookie = generateRookieRatings(position, templateId);
  const selected = creationTemplateById.get(templateId)!;
  const ratings = { ...rookie };
  for (const id of RATING_IDS) ratings[id] = clampInteger(ratings[id] + 10, 68, 90);
  ratings[selected.coreRatings[0]] = 94;
  ratings[selected.coreRatings[1]] = 92;
  assertRatings(ratings, `tutorial-${templateId}`);
  return ratings;
}

export interface CreatePlayerRequest {
  displayName: string;
  position: Position;
  templateId: CreationTemplateId;
  jerseyNumber: JerseyNumber;
}

export interface CreatedPlayerProfile {
  displayName: string;
  age: 20;
  position: Position;
  templateId: CreationTemplateId;
  templateName: string;
  templateReferenceName: string;
  templateLabel: string;
  jerseyNumber: JerseyNumber;
  ratings: Ratings;
  simpleAverage: number;
}

export function createPlayerProfile(request: CreatePlayerRequest): CreatedPlayerProfile {
  const displayName = request.displayName.trim();
  if (!displayName) throw new Error("Player display name is required");
  const selected = creationTemplateById.get(request.templateId);
  if (!selected || selected.position !== request.position) throw new Error("Template does not match the selected position");
  const ratings = generateRookieRatings(request.position, request.templateId);
  return {
    displayName,
    age: 20,
    position: request.position,
    templateId: request.templateId,
    templateName: selected.name,
    templateReferenceName: selected.referenceName,
    templateLabel: creationTemplateLabel(selected),
    jerseyNumber: assertJerseyNumber(request.jerseyNumber),
    ratings,
    simpleAverage: averageRating(ratings),
  };
}

export type Conference = "EAST" | "WEST";

export interface LeagueTeamIdentity {
  id: string;
  shortName: string;
  conference: Conference;
  homeColor: `#${string}`;
  contentStatus: "REVIEW_REQUIRED";
}

const team = (id: string, shortName: string, conference: Conference, homeColor: `#${string}`): LeagueTeamIdentity => ({
  id,
  shortName,
  conference,
  homeColor,
  contentStatus: "REVIEW_REQUIRED",
});

export const leagueTeams: readonly LeagueTeamIdentity[] = [
  team("CELTICS", "凯尔特人", "EAST", "#007A54"),
  team("NETS", "篮网", "EAST", "#1D1D1D"),
  team("KNICKS", "尼克斯", "EAST", "#F15A24"),
  team("SIXERS", "76人", "EAST", "#1D428A"),
  team("RAPTORS", "猛龙", "EAST", "#CE1141"),
  team("BULLS", "公牛", "EAST", "#CE1141"),
  team("CAVALIERS", "骑士", "EAST", "#6F263D"),
  team("PISTONS", "活塞", "EAST", "#C8102E"),
  team("PACERS", "步行者", "EAST", "#FDBB30"),
  team("BUCKS", "雄鹿", "EAST", "#00471B"),
  team("HAWKS", "老鹰", "EAST", "#E03A3E"),
  team("HORNETS", "黄蜂", "EAST", "#1D1160"),
  team("HEAT", "热火", "EAST", "#98002E"),
  team("MAGIC", "魔术", "EAST", "#0077C0"),
  team("WIZARDS", "奇才", "EAST", "#002B5C"),
  team("NUGGETS", "掘金", "WEST", "#0E2240"),
  team("TIMBERWOLVES", "森林狼", "WEST", "#0C2340"),
  team("THUNDER", "雷霆", "WEST", "#007AC1"),
  team("TRAIL_BLAZERS", "开拓者", "WEST", "#E03A3E"),
  team("JAZZ", "爵士", "WEST", "#2F7B3B"),
  team("WARRIORS", "勇士", "WEST", "#1D428A"),
  team("CLIPPERS", "快船", "WEST", "#C8102E"),
  team("LAKERS", "湖人", "WEST", "#552583"),
  team("SUNS", "太阳", "WEST", "#1D1160"),
  team("KINGS", "国王", "WEST", "#5A2D81"),
  team("MAVERICKS", "独行侠", "WEST", "#00538C"),
  team("ROCKETS", "火箭", "WEST", "#CE1141"),
  team("GRIZZLIES", "灰熊", "WEST", "#5D76A9"),
  team("PELICANS", "鹈鹕", "WEST", "#0C2340"),
  team("SPURS", "马刺", "WEST", "#4A4A4A"),
] as const;

export interface CareerDestinationRequest {
  position: Position;
  evaluationScore: number;
  seed: number;
  forceDirectSigning?: boolean;
}

export interface CareerDestination {
  route: "DRAFT" | "DIRECT_SIGNING";
  team: LeagueTeamIdentity;
  draftPick?: number;
  seed: number;
  explanation: string;
}

function positionIndex(position: Position) {
  return (["PG", "SG", "SF", "PF", "C"] as Position[]).indexOf(position);
}

function syntheticNeed(teamIndex: number, position: Position) {
  return (Math.imul(teamIndex + 3, 17) + Math.imul(positionIndex(position) + 5, 23)) % 31;
}

export function resolveCareerDestination(request: CareerDestinationRequest): CareerDestination {
  if (!Number.isFinite(request.evaluationScore) || request.evaluationScore < 0 || request.evaluationScore > 100) {
    throw new Error("Evaluation score must be from 0 to 100");
  }
  const roll = nextRandom(request.seed);
  const entersDraft = !request.forceDirectSigning && request.evaluationScore >= 50;

  if (entersDraft) {
    const basePick = Math.round(30 - request.evaluationScore * 0.29);
    const jitter = Math.floor(roll.value * 5) - 2;
    const draftPick = clampInteger(basePick + jitter, 1, 30);
    const draftingTeam = leagueTeams.find((candidate) => candidate.id === draftPickTeamIds2026[draftPick - 1]);
    if (!draftingTeam) throw new Error(`Draft slot ${draftPick} has an unknown team`);
    return {
      route: "DRAFT",
      team: draftingTeam,
      draftPick,
      seed: roll.seed,
      explanation: `首轮第${draftPick}顺位被选中`,
    };
  }

  const ranked = leagueTeams
    .map((candidate, index) => ({ candidate, need: syntheticNeed(index, request.position) }))
    .sort((first, second) => second.need - first.need || first.candidate.id.localeCompare(second.candidate.id));
  const destination = ranked[Math.min(4, Math.floor(roll.value * 5))].candidate;
  return {
    route: "DIRECT_SIGNING",
    team: destination,
    seed: roll.seed,
    explanation: "未进入首轮，与提供发展机会的球队直接签约",
  };
}
