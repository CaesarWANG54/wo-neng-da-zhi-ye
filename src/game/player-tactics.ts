import { nextRandom } from "./core";
import { players } from "./data";
import type {
  CourtPlayer,
  HomeTacticExecution,
  HomeTacticId,
  MatchState,
  MotionIntent,
  Position,
} from "./types";

interface HomeTacticDefinition {
  id: HomeTacticId;
  name: string;
  description: string;
  entries: readonly [string, string, string];
  counters: readonly [string, string, string];
  primaryPositions: readonly [Position, Position, Position];
}

export const homeTactics: readonly HomeTacticDefinition[] = [
  {
    id: "HORNS",
    name: "牛角落位",
    description: "肘区双高位，阅读顺下、外弹与弱侧反跑",
    entries: ["侧翼挡拆", "肘区分切", "假掩护顺下"],
    counters: ["追防→顺下", "沉退→外弹", "夹击→弱侧转移"],
    primaryPositions: ["PF", "SG", "C"],
  },
  {
    id: "FIVE_OUT",
    name: "五外拉开",
    description: "清空禁区，以传切、后门和突分保持空间",
    entries: ["45度空切", "幽灵掩护", "突分再落位"],
    counters: ["过度压迫→后门", "换防→点名", "协防收缩→底角转移"],
    primaryPositions: ["SG", "SF", "PF"],
  },
  {
    id: "HANDOFF",
    name: "手递手",
    description: "利用交接时差，衔接假递手与二次交接",
    entries: ["强侧手递手", "假递手突破", "二次手递手"],
    counters: ["追防→卷切", "抢过→拒绝交接", "换防→内切卡位"],
    primaryPositions: ["SG", "PG", "SF"],
  },
  {
    id: "STAGGER",
    name: "双重掩护",
    description: "连续两次无球掩护，读取直出、卷切与反跑",
    entries: ["直线绕出", "中路卷切", "拒绝掩护反跑"],
    counters: ["追防→绕出接球", "挤过→卷切", "封锁→后门"],
    primaryPositions: ["SG", "SF", "SG"],
  },
] as const;

export const homeTacticById = new Map(homeTactics.map((tactic) => [tactic.id, tactic]));

export function getHomeTactic(id: HomeTacticId) {
  const tactic = homeTacticById.get(id);
  if (!tactic) throw new Error(`Unknown home tactic: ${id}`);
  return tactic;
}

function executionScore(state: MatchState) {
  const lineup = players.filter((player) => player.team === "home");
  const teamAverage = lineup.reduce(
    (sum, player) =>
      sum +
      player.ratings.basketballIQ * 0.3 +
      player.ratings.offBallMovement * 0.22 +
      player.ratings.decisionSpeed * 0.2 +
      player.ratings.passVision * 0.14 +
      player.ratings.passAccuracy * 0.14,
    0,
  ) / lineup.length;
  const handler = lineup.find((player) => player.id === state.ballHandlerId) ?? lineup[0];
  const handlerRead = handler.ratings.basketballIQ * 0.45 + handler.ratings.passVision * 0.35 + handler.ratings.decisionSpeed * 0.2;
  return Math.max(55, Math.min(92, Math.round(teamAverage * 0.72 + handlerRead * 0.28)));
}

function primaryPlayerId(position: Position) {
  return players.find((player) => player.team === "home" && player.position === position)?.id ?? "h2";
}

export function createHomeTacticExecution(state: MatchState, tacticId: HomeTacticId) {
  const tactic = getHomeTactic(tacticId);
  const firstRoll = nextRandom(state.seed);
  const secondRoll = nextRandom(firstRoll.seed);
  const startOrdinal = (Math.floor(firstRoll.value * 6) + Math.floor(secondRoll.value * 6)) % 6;
  const recent = new Set(state.homeTacticSignatureHistory.slice(-3));
  let chosenOrdinal = startOrdinal;

  for (let offset = 0; offset < 6; offset += 1) {
    const ordinal = (startOrdinal + offset) % 6;
    const side = ordinal < 3 ? "UPPER" : "LOWER";
    const variant = (ordinal % 3) as 0 | 1 | 2;
    const primary = primaryPlayerId(tactic.primaryPositions[variant]);
    const signature = `${tacticId}-${side}-${variant}-${primary}`;
    if (signature !== state.lastHomeTacticSignature && !recent.has(signature)) {
      chosenOrdinal = ordinal;
      break;
    }
  }

  const side = chosenOrdinal < 3 ? "UPPER" : "LOWER";
  const variant = (chosenOrdinal % 3) as 0 | 1 | 2;
  const primary = primaryPlayerId(tactic.primaryPositions[variant]);
  const signature = `${tacticId}-${side}-${variant}-${primary}`;
  const execution: HomeTacticExecution = {
    id: `home-tactic-${state.eventSequence + 1}-${secondRoll.seed}`,
    tacticId,
    side,
    variant,
    signature,
    primaryPlayerId: primary,
    startedAtShotClock: state.shotClock,
    executionScore: executionScore(state),
    entryLabel: tactic.entries[variant],
    counterLabel: tactic.counters[variant],
  };
  return { execution, seed: secondRoll.seed };
}

export function homeTacticIntent(execution: HomeTacticExecution, player: CourtPlayer): MotionIntent {
  if (player.id === execution.primaryPlayerId) {
    if (execution.tacticId === "HORNS" && player.position === "PF") return "SCREEN";
    if (execution.tacticId === "HORNS" && player.position === "C") return "ROLL";
    if (execution.tacticId === "HANDOFF") return execution.variant === 1 ? "DRIVE" : "RECEIVE";
    return "CUT";
  }
  if (execution.tacticId === "HORNS" && (player.position === "PF" || player.position === "C")) {
    return execution.variant === 1 ? "POP" : "SCREEN";
  }
  if (execution.tacticId === "HANDOFF" && player.position === "C") return "SCREEN";
  if (execution.tacticId === "STAGGER" && (player.position === "PF" || player.position === "C")) return "SCREEN";
  return "SPACE";
}

export function isHomeTacticContactPair(
  execution: HomeTacticExecution | undefined,
  first: CourtPlayer,
  second: CourtPlayer,
) {
  if (!execution || first.team !== "home" || second.team !== "home") return false;
  const firstIntent = homeTacticIntent(execution, first);
  const secondIntent = homeTacticIntent(execution, second);
  const contactIntent = (intent: MotionIntent) => intent === "SCREEN" || intent === "ROLL";
  const movingRead = (player: CourtPlayer, intent: MotionIntent) => (
    player.id === execution.primaryPlayerId
    || player.position === "PG"
    || intent === "CUT"
    || intent === "DRIVE"
    || intent === "RECEIVE"
  );
  return (contactIntent(firstIntent) && movingRead(second, secondIntent))
    || (contactIntent(secondIntent) && movingRead(first, firstIntent));
}

export function tacticStageAt(state: MatchState) {
  const execution = state.homeTacticExecution;
  if (!execution) return { index: 0, key: "ALIGN" as const, label: "落位" };
  const elapsed = Math.max(0, execution.startedAtShotClock - state.shotClock);
  if (elapsed < 1.15) return { index: 0, key: "ALIGN" as const, label: "落位" };
  if (elapsed < 2.45) return { index: 1, key: "TRIGGER" as const, label: "发起" };
  if (elapsed < 4.1) return { index: 2, key: "READ" as const, label: "阅读" };
  return { index: 3, key: "COUNTER" as const, label: "反制" };
}
