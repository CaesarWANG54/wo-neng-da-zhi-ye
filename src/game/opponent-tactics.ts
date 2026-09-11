import type {
  CourtPoint,
  OpponentIntent,
  OpponentPlayId,
  OpponentShotType,
  OpponentStage,
  Position,
} from "./types";

export interface OpponentShotOption {
  shooter: Position;
  shotType: OpponentShotType;
  quality: number;
  label: string;
}

export interface OpponentTacticStage {
  key: OpponentStage;
  label: string;
  duration: number;
  intent: OpponentIntent;
  handler: Position;
  targets: Record<Position, CourtPoint>;
  via?: Partial<Record<Position, CourtPoint[]>>;
  options?: OpponentShotOption[];
  contactPairs?: ReadonlyArray<readonly [Position, Position]>;
}

export interface OpponentTacticDefinition {
  id: OpponentPlayId;
  name: string;
  alignment: string;
  trigger: string;
  reads: [string, string];
  fallback: string;
  counterTags: string[];
  phaseTags: Array<"HALF_COURT" | "TRANSITION" | "ZONE">;
  stages: OpponentTacticStage[];
}

const spots = (
  PG: [number, number],
  SG: [number, number],
  SF: [number, number],
  PF: [number, number],
  C: [number, number],
): Record<Position, CourtPoint> => ({
  PG: { x: PG[0], y: PG[1] },
  SG: { x: SG[0], y: SG[1] },
  SF: { x: SF[0], y: SF[1] },
  PF: { x: PF[0], y: PF[1] },
  C: { x: C[0], y: C[1] },
});

export const opponentTactics: OpponentTacticDefinition[] = [
  {
    id: "OPEN_41",
    name: "四外动态",
    alignment: "四名外线保持传切补位，一名内线占弱侧低位",
    trigger: "翼侧入球后传球人切篮，相邻球员补空位",
    reads: ["篮下切入或低位封人", "弱侧手递手后突破分球"],
    fallback: "完整反转后进入高位球掩护",
    counterTags: ["DENY_BACKDOOR", "SWITCH_POST", "HELP_KICKOUT"],
    phaseTags: ["HALF_COURT"],
    stages: [
      { key: "SETUP", label: "四外一内落位", duration: 1.05, intent: "SETUP", handler: "PG", targets: spots([43, 50], [34, 19], [34, 81], [23, 31], [18, 67]) },
      { key: "ENTRY", label: "翼侧入球", duration: 0.95, intent: "PASS", handler: "SG", targets: spots([36, 58], [31, 22], [36, 82], [22, 38], [17, 66]), via: { PG: [{ x: 37, y: 42 }] } },
      { key: "TRIGGER", label: "传切补位", duration: 1.15, intent: "CUT", handler: "SG", targets: spots([18, 47], [28, 25], [39, 78], [31, 48], [18, 68]), via: { PG: [{ x: 28, y: 38 }], PF: [{ x: 25, y: 43 }] } },
      { key: "READ", label: "切入与外弹二选一", duration: 0.75, intent: "PASS", handler: "PF", targets: spots([21, 50], [30, 19], [31, 82], [27, 47], [15, 66]), options: [
        { shooter: "PG", shotType: "CUT", quality: 0.68, label: "反跑切入" },
        { shooter: "SG", shotType: "KICK_THREE", quality: 0.59, label: "强侧回传三分" },
        { shooter: "C", shotType: "POST", quality: 0.55, label: "低位封人" },
      ] },
    ],
  },
  {
    id: "PRIN_CHIN",
    name: "高位策应",
    alignment: "双后卫、双翼与高位策应中锋",
    trigger: "球转到侧翼，弱侧后卫借高位背掩护下切",
    reads: ["后门直切篮下", "高位接球后手递手或分弱侧"],
    fallback: "策应点换肘，镜像重新发起",
    counterTags: ["DENY_BACKDOOR", "SWITCH_SEAL", "SAG_MIDRANGE"],
    phaseTags: ["HALF_COURT"],
    stages: [
      { key: "SETUP", label: "高位五点落位", duration: 1.05, intent: "SETUP", handler: "PG", targets: spots([43, 42], [43, 62], [31, 18], [31, 82], [28, 50]) },
      { key: "ENTRY", label: "连续转移到翼侧", duration: 1.0, intent: "PASS", handler: "SF", targets: spots([39, 45], [39, 61], [29, 20], [30, 81], [27, 50]) },
      { key: "TRIGGER", label: "高位背掩护下切", duration: 1.25, intent: "CUT", handler: "SF", targets: spots([18, 47], [36, 67], [27, 22], [30, 81], [25, 51]), via: { PG: [{ x: 30, y: 43 }, { x: 23, y: 47 }], C: [{ x: 27, y: 48 }] } },
      { key: "READ", label: "后门与策应阅读", duration: 0.75, intent: "PASS", handler: "C", targets: spots([14, 48], [34, 71], [29, 21], [28, 82], [25, 50]), options: [
        { shooter: "PG", shotType: "CUT", quality: 0.72, label: "Chin后门" },
        { shooter: "C", shotType: "MID_RANGE", quality: 0.57, label: "高位空位" },
        { shooter: "SG", shotType: "KICK_THREE", quality: 0.58, label: "弱侧外弹" },
      ] },
    ],
  },
  {
    id: "BLOCKER_MOVER",
    name: "双掩护跑位",
    alignment: "两名掩护人固定通道，三名移动者持续阅读",
    trigger: "射手选择下掩护的直出、卷切或反跑",
    reads: ["射手接球出手或卷切", "掩护人顺下封住换防小个"],
    fallback: "球反转后从另一侧继续",
    counterTags: ["CHASE_CURL", "TOPLOCK_BACKDOOR", "SWITCH_SEAL"],
    phaseTags: ["HALF_COURT"],
    stages: [
      { key: "SETUP", label: "两掩护人三移动点", duration: 1.1, intent: "SETUP", handler: "PG", targets: spots([42, 50], [30, 16], [34, 84], [23, 38], [20, 67]) },
      { key: "ENTRY", label: "侧翼入球", duration: 0.9, intent: "PASS", handler: "SF", targets: spots([37, 52], [29, 17], [30, 81], [24, 40], [20, 65]) },
      { key: "TRIGGER", label: "连续下掩护", duration: 1.35, intent: "CUT", handler: "SF", targets: spots([35, 58], [29, 37], [27, 81], [21, 45], [18, 63]), via: { SG: [{ x: 20, y: 26 }, { x: 24, y: 34 }], PF: [{ x: 23, y: 35 }] } },
      { key: "READ", label: "直出、卷切或顺下", duration: 0.75, intent: "PASS", handler: "PG", targets: spots([35, 55], [27, 36], [29, 82], [16, 45], [18, 66]), options: [
        { shooter: "SG", shotType: "THREE", quality: 0.66, label: "掩护后接球" },
        { shooter: "SG", shotType: "CUT", quality: 0.63, label: "卷切篮下" },
        { shooter: "PF", shotType: "ROLL", quality: 0.55, label: "掩护人顺下" },
      ] },
    ],
  },
  {
    id: "HORNS_STS",
    name: "双肘分切",
    alignment: "双内线站肘区，双侧翼沉底角",
    trigger: "一侧球掩护与弱侧掩护掩护者同时发生",
    reads: ["持球突破或顺下", "弱侧射手借下掩护接球"],
    fallback: "高低位配合后转入另一侧挡拆",
    counterTags: ["DROP_PULLUP", "BLITZ_SHORTROLL", "SWITCH_SEAL"],
    phaseTags: ["HALF_COURT"],
    stages: [
      { key: "SETUP", label: "双肘双底角落位", duration: 1.0, intent: "SETUP", handler: "PG", targets: spots([43, 50], [22, 15], [22, 85], [30, 38], [30, 62]) },
      { key: "ENTRY", label: "选择强侧肘区", duration: 0.85, intent: "PASS", handler: "PF", targets: spots([38, 48], [21, 15], [22, 85], [28, 39], [29, 62]) },
      { key: "TRIGGER", label: "球掩护与弱侧下掩护", duration: 1.25, intent: "BALL_SCREEN", handler: "PG", targets: spots([28, 37], [18, 17], [29, 70], [18, 47], [27, 63]), via: { PG: [{ x: 34, y: 44 }], SF: [{ x: 20, y: 76 }], C: [{ x: 27, y: 68 }] }, contactPairs: [["SF", "C"]] },
      { key: "READ", label: "突破、顺下、弱侧三选一", duration: 0.72, intent: "PASS", handler: "PG", targets: spots([24, 35], [18, 17], [28, 78], [15, 48], [25, 65]), options: [
        { shooter: "PG", shotType: "PULL_UP", quality: 0.62, label: "挡拆急停" },
        { shooter: "PF", shotType: "ROLL", quality: 0.69, label: "强侧顺下" },
        { shooter: "SF", shotType: "KICK_THREE", quality: 0.59, label: "弱侧掩护接球" },
      ] },
    ],
  },
  {
    id: "FLEX_CONT",
    name: "底线连续",
    alignment: "双槽位、双底角与一名低位掩护人",
    trigger: "球反转后底线背掩护，再掩护掩护者",
    reads: ["Flex切入篮下", "掩护人上提肘区接球"],
    fallback: "人员补位后从反侧重复",
    counterTags: ["CHASE_RIM", "DENY_COUNTERCUT", "SWITCH_DUCKIN"],
    phaseTags: ["HALF_COURT"],
    stages: [
      { key: "SETUP", label: "Flex基础落位", duration: 1.05, intent: "SETUP", handler: "PG", targets: spots([42, 38], [42, 62], [20, 20], [20, 80], [19, 50]) },
      { key: "ENTRY", label: "槽位反转", duration: 0.9, intent: "PASS", handler: "SG", targets: spots([38, 40], [37, 61], [20, 20], [20, 80], [20, 51]) },
      { key: "TRIGGER", label: "底线背掩护", duration: 1.3, intent: "CUT", handler: "SG", targets: spots([31, 43], [36, 61], [16, 52], [22, 81], [25, 55]), via: { SF: [{ x: 16, y: 31 }, { x: 16, y: 44 }], PG: [{ x: 28, y: 48 }], C: [{ x: 20, y: 48 }] } },
      { key: "READ", label: "篮下与肘区阅读", duration: 0.72, intent: "PASS", handler: "SG", targets: spots([29, 43], [34, 62], [14, 53], [22, 81], [27, 55]), options: [
        { shooter: "SF", shotType: "CUT", quality: 0.68, label: "Flex篮下切入" },
        { shooter: "C", shotType: "MID_RANGE", quality: 0.54, label: "掩护人上提" },
        { shooter: "PF", shotType: "THREE", quality: 0.51, label: "反侧补位三分" },
      ] },
    ],
  },
  {
    id: "HIGH_LOW",
    name: "高低位",
    alignment: "一名内线高位策应，另一名内线低位封人",
    trigger: "球进入肘区后低位内线卡住身前防守",
    reads: ["高吊低位单打", "协防收缩后分底角"],
    fallback: "高位手递手后重新建立内外线角度",
    counterTags: ["FRONT_LOB", "DIG_KICKOUT", "DOUBLE_REVERSE"],
    phaseTags: ["HALF_COURT", "ZONE"],
    stages: [
      { key: "SETUP", label: "高低位三角", duration: 1.0, intent: "SETUP", handler: "PG", targets: spots([43, 50], [27, 18], [27, 82], [28, 48], [16, 63]) },
      { key: "ENTRY", label: "肘区入球", duration: 0.95, intent: "PASS", handler: "PF", targets: spots([37, 54], [26, 18], [27, 82], [27, 47], [16, 61]) },
      { key: "TRIGGER", label: "低位封人与弱侧沉底", duration: 1.1, intent: "POST", handler: "PF", targets: spots([35, 57], [23, 15], [23, 84], [26, 47], [14, 59]), via: { C: [{ x: 16, y: 65 }] } },
      { key: "READ", label: "高吊与底角分球", duration: 0.75, intent: "PASS", handler: "C", targets: spots([34, 58], [22, 15], [22, 85], [25, 47], [14, 57]), options: [
        { shooter: "C", shotType: "POST", quality: 0.7, label: "低位深封" },
        { shooter: "SG", shotType: "KICK_THREE", quality: 0.57, label: "强侧底角" },
        { shooter: "PF", shotType: "MID_RANGE", quality: 0.54, label: "高位策应投篮" },
      ] },
    ],
  },
  {
    id: "DRIBBLE_DRIVE",
    name: "突分体系",
    alignment: "四外拉开，中锋贴弱侧篮筐",
    trigger: "持球人攻击外线防守肩侧，弱侧随协防层级移动",
    reads: ["直接攻筐或短急停", "协防收缩后分底角与45度"],
    fallback: "突破受阻后回传，下一名外线立即二次突破",
    counterTags: ["GAP_FINISH", "HELP_KICKOUT", "SWITCH_REATTACK"],
    phaseTags: ["HALF_COURT"],
    stages: [
      { key: "SETUP", label: "四外拉开", duration: 0.95, intent: "SETUP", handler: "PG", targets: spots([43, 50], [30, 16], [30, 84], [24, 31], [15, 67]) },
      { key: "ENTRY", label: "清空强侧", duration: 0.82, intent: "PASS", handler: "SG", targets: spots([36, 61], [34, 24], [29, 84], [23, 35], [15, 68]) },
      { key: "TRIGGER", label: "攻击缝隙", duration: 1.05, intent: "DRIVE", handler: "SG", targets: spots([31, 65], [23, 34], [26, 85], [22, 60], [14, 69]), via: { SG: [{ x: 29, y: 29 }], PF: [{ x: 24, y: 49 }] } },
      { key: "READ", label: "终结与突分阅读", duration: 0.68, intent: "PASS", handler: "SG", targets: spots([29, 66], [18, 39], [24, 85], [20, 64], [13, 68]), options: [
        { shooter: "SG", shotType: "RIM", quality: 0.66, label: "突破终结" },
        { shooter: "PF", shotType: "KICK_THREE", quality: 0.61, label: "45度外弹" },
        { shooter: "SF", shotType: "KICK_THREE", quality: 0.58, label: "弱侧底角" },
      ] },
    ],
  },
  {
    id: "ZONE_OVERLOAD",
    name: "联防高位闪切",
    alignment: "弧顶双翼、罚球线策应与底线短角",
    trigger: "翼侧入球后高位闪切，底线球员跟随球侧移动",
    reads: ["罚球线接球投篮或分短角", "快速跳传弱侧射手"],
    fallback: "球跨过中线反转后再次攻击防守缝隙",
    counterTags: ["ZONE_HIGH_POST", "SHORT_CORNER", "SKIP_PASS"],
    phaseTags: ["HALF_COURT", "ZONE"],
    stages: [
      { key: "SETUP", label: "1-3-1破联防落位", duration: 1.0, intent: "SETUP", handler: "PG", targets: spots([43, 50], [29, 18], [29, 82], [17, 72], [27, 50]) },
      { key: "ENTRY", label: "翼侧触球", duration: 0.88, intent: "PASS", handler: "SG", targets: spots([37, 55], [28, 20], [29, 82], [16, 70], [25, 48]) },
      { key: "TRIGGER", label: "高位闪切与短角占位", duration: 1.15, intent: "CUT", handler: "C", targets: spots([35, 58], [25, 20], [25, 84], [14, 68], [23, 48]), via: { C: [{ x: 29, y: 51 }], PF: [{ x: 15, y: 74 }] } },
      { key: "READ", label: "高位、短角与跳传", duration: 0.72, intent: "PASS", handler: "C", targets: spots([34, 59], [24, 19], [24, 85], [13, 67], [22, 48]), options: [
        { shooter: "C", shotType: "MID_RANGE", quality: 0.64, label: "罚球线空位" },
        { shooter: "PF", shotType: "CUT", quality: 0.68, label: "短角终结" },
        { shooter: "SF", shotType: "KICK_THREE", quality: 0.62, label: "弱侧跳传三分" },
      ] },
    ],
  },
  {
    id: "EARLY_DHO",
    name: "转换手递手",
    alignment: "中锋冲篮、两翼分道、四号位拖后、控卫推进",
    trigger: "侧翼手递手接拖后球掩护，弱侧保持提前传球路线",
    reads: ["转弯攻筐或顺下", "拖车外弹与弱侧三分"],
    fallback: "防守落位后无缝转入四外动态",
    counterTags: ["RIM_RUN", "BLITZ_SHORTROLL", "RETREAT_TRAILER"],
    phaseTags: ["TRANSITION"],
    stages: [
      { key: "SETUP", label: "转换分道推进", duration: 0.72, intent: "SETUP", handler: "PG", targets: spots([35, 50], [27, 17], [27, 83], [39, 70], [15, 48]) },
      { key: "ENTRY", label: "侧翼手递手", duration: 0.78, intent: "HANDOFF", handler: "SF", targets: spots([31, 54], [24, 17], [30, 72], [39, 65], [14, 48]), via: { SF: [{ x: 33, y: 64 }] }, contactPairs: [["SF", "PF"]] },
      { key: "TRIGGER", label: "追尾挡拆", duration: 0.92, intent: "BALL_SCREEN", handler: "SF", targets: spots([33, 49], [20, 17], [20, 60], [26, 70], [13, 46]), via: { PF: [{ x: 28, y: 62 }], C: [{ x: 14, y: 53 }] }, contactPairs: [["SF", "PF"]] },
      { key: "READ", label: "冲筐、顺下与拖车", duration: 0.55, intent: "PASS", handler: "SF", targets: spots([33, 47], [19, 17], [16, 62], [25, 75], [12, 46]), options: [
        { shooter: "SF", shotType: "RIM", quality: 0.71, label: "转换攻筐" },
        { shooter: "C", shotType: "ROLL", quality: 0.72, label: "冲篮顺下" },
        { shooter: "PF", shotType: "KICK_THREE", quality: 0.58, label: "拖车外弹" },
      ] },
    ],
  },
];

export const opponentTacticById = new Map(opponentTactics.map((tactic) => [tactic.id, tactic]));

export function getOpponentTactic(playId: OpponentPlayId) {
  const tactic = opponentTacticById.get(playId);
  if (!tactic) throw new Error(`Unknown opponent tactic: ${playId}`);
  return tactic;
}
