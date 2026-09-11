export type TutorialTaskId =
  | "GUIDE"
  | "CONNECT"
  | "ATTACK"
  | "SCREEN"
  | "DEFEND"
  | "FASTBREAK_DOUBLE";

export type TutorialFeedbackKind = "INFO" | "SUCCESS" | "RECOVER";

export interface TutorialTaskDefinition {
  id: TutorialTaskId;
  shortLabel: string;
  title: string;
  hint: string;
}

export const TUTORIAL_TASKS: readonly TutorialTaskDefinition[] = [
  {
    id: "GUIDE",
    shortLabel: "说明",
    title: "查看暂停与玩法",
    hint: "点右上角“暂停”，再打开“玩法说明”后返回。",
  },
  {
    id: "CONNECT",
    shortLabel: "配合",
    title: "完成一次传接配合",
    hint: "持球时传球；无球时可要球、空切或外弹。",
  },
  {
    id: "ATTACK",
    shortLabel: "进攻",
    title: "完成一次攻筐选择",
    hint: "持球时选择投篮或突破；投失也算完成正确出手。",
  },
  {
    id: "SCREEN",
    shortLabel: "挡拆",
    title: "发起一次有效挡拆",
    hint: "有球时呼叫队友掩护，无球时为持球队友设掩护。",
  },
  {
    id: "DEFEND",
    shortLabel: "防守",
    title: "提交一次有效防守",
    hint: "对方进攻时，按威胁选择盯防、封盖、换防、联防或抢断。",
  },
  {
    id: "FASTBREAK_DOUBLE",
    shortLabel: "快攻",
    title: "在快攻中完成双击",
    hint: "出现红色“快攻”标识时，双击传球尝试空接，或双击投篮尝试扣篮。",
  },
] as const;

export interface TutorialProgress {
  completed: readonly TutorialTaskId[];
  seenPause: boolean;
  seenHelp: boolean;
  feedback: string;
  feedbackKind: TutorialFeedbackKind;
}

export interface TutorialActionObservation {
  actionId: string;
  doubleTap: boolean;
  phase: string;
  possession: "home" | "away";
  eventKind: string;
  eventAdvanced: boolean;
}

export interface TutorialSuggestionContext {
  phase: string;
  possession: "home" | "away";
  onBall: boolean;
}

export interface TutorialPerformanceLine {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  attempts: number;
  made: number;
}

export interface TutorialEvaluationDimension {
  id: "DECISION" | "OFFENSE" | "DEFENSE" | "TRANSITION" | "TEAM";
  label: string;
  score: number;
  max: number;
  detail: string;
}

export interface TutorialEvaluation {
  total: number;
  completedCount: number;
  dimensions: readonly TutorialEvaluationDimension[];
}

const taskIds = new Set<TutorialTaskId>(TUTORIAL_TASKS.map((task) => task.id));

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.round(Math.min(maximum, Math.max(minimum, value)));
}

function withFeedback(progress: TutorialProgress, feedback: string, feedbackKind: TutorialFeedbackKind): TutorialProgress {
  return { ...progress, feedback, feedbackKind };
}

function complete(progress: TutorialProgress, ids: readonly TutorialTaskId[], feedback: string): TutorialProgress {
  const completed = new Set(progress.completed);
  for (const id of ids) {
    if (taskIds.has(id)) completed.add(id);
  }
  return {
    ...progress,
    completed: TUTORIAL_TASKS.map((task) => task.id).filter((id) => completed.has(id)),
    feedback,
    feedbackKind: "SUCCESS",
  };
}

export function createTutorialProgress(): TutorialProgress {
  return {
    completed: [],
    seenPause: false,
    seenHelp: false,
    feedback: "先熟悉暂停与玩法；任务不会暂停或限制你的比赛选择。",
    feedbackKind: "INFO",
  };
}

export function recordTutorialUi(progress: TutorialProgress, event: "PAUSE_OPENED" | "HELP_OPENED"): TutorialProgress {
  const seenPause = progress.seenPause || event === "PAUSE_OPENED";
  const seenHelp = progress.seenHelp || event === "HELP_OPENED";
  const next = { ...progress, seenPause, seenHelp };
  if (seenPause && seenHelp) return complete(next, ["GUIDE"], "玩法已查看 · 回到比赛后可按场上情境自由完成其余任务。");
  return withFeedback(
    next,
    seenPause ? "暂停菜单已打开 · 再点“玩法说明”即可完成本步。" : "玩法说明已查看 · 本场再打开一次暂停菜单即可完成本步。",
    "INFO",
  );
}

const connectSuccessKinds = new Set(["PASS_RELEASE", "SPACING", "FASTBREAK_SPOT", "SHOT_RELEASE"]);
const attackSuccessKinds = new Set(["SHOT_RELEASE", "DRIVE_START", "DRIVE_START_OPEN_RIM", "DRIVE_CONTINUE", "DRIVE_CONTINUE_OPEN_RIM"]);
const screenSuccessKinds = new Set(["SCREEN", "OFF_BALL_SCREEN"]);
const defenseSuccessKinds = new Set(["CONTAIN", "CONTEST_CLOSEOUT", "CONTEST_READY", "SWITCH", "ZONE_SET", "STEAL", "STEAL_CLOSE_GAP"]);

/**
 * Records only tutorial feedback. The authoritative MatchState has already
 * resolved the action; this function never changes possession, clocks,
 * ratings, probabilities or officiating.
 */
export function recordTutorialAction(progress: TutorialProgress, observation: TutorialActionObservation): TutorialProgress {
  const { actionId, doubleTap, phase, possession, eventKind, eventAdvanced } = observation;
  if (!eventAdvanced) {
    return withFeedback(progress, "这个动作已错过当前判定窗口 · 等棋子落位、右侧按键恢复后继续即可。", "RECOVER");
  }

  const completed: TutorialTaskId[] = [];
  let successText = "";
  let recoveryText = "";

  const isConnectAction = ["pass", "request", "cut", "spot"].includes(actionId);
  if (isConnectAction) {
    if (connectSuccessKinds.has(eventKind)) {
      completed.push("CONNECT");
      successText = "传接阅读有效";
    } else {
      recoveryText = "这次传接路线没有形成 · 不扣分，重新落位或等球权回来后再试。";
    }
  }

  const isAttackAction = actionId === "shoot" || actionId === "drive";
  if (isAttackAction) {
    if (attackSuccessKinds.has(eventKind)) {
      completed.push("ATTACK");
      successText = successText ? `${successText}，攻筐选择也已完成` : "攻筐选择已完成";
    } else {
      recoveryText = eventKind === "DUNK_UNAVAILABLE"
        ? "当前离篮筐太远，扣篮没有启动 · 下次单击投篮，或先突破接近篮筐。"
        : "这次进攻没有进入有效出手 · 保持间距，下一次持球再选择投篮或突破。";
    }
  }

  if (actionId === "screen") {
    if (screenSuccessKinds.has(eventKind)) {
      completed.push("SCREEN");
      successText = "挡拆已经形成 · 继续阅读换防、顺下或外弹。";
    } else {
      recoveryText = "掩护没有合法形成 · 无需重开，下一次落位后再按挡拆。";
    }
  }

  if (possession === "away" && ["contain", "steal", "contest", "switch", "zone"].includes(actionId)) {
    if (defenseSuccessKinds.has(eventKind)) {
      completed.push("DEFEND");
      successText = "防守指令已提交 · 结果仍由位置、属性与对手选择共同决定。";
    } else {
      recoveryText = eventKind === "STEAL_MISS"
        ? "这次上抢落空 · 下一防守回合可先盯防或封盖，比赛会继续。"
        : "本次防守没有形成有效响应 · 等下一个进攻节点再选择。";
    }
  }

  const isFastbreakDouble = phase === "FASTBREAK" && possession === "home" && doubleTap && (actionId === "pass" || actionId === "shoot");
  if (isFastbreakDouble) {
    if (eventKind === "SHOT_RELEASE") {
      completed.push("FASTBREAK_DOUBLE");
      successText = `${actionId === "pass" ? "空接" : "快攻扣篮"}已正确发起 · 命中与否仍按真实对位结算。`;
    } else {
      recoveryText = "快攻双击已识别，但路线被防守破坏 · 不扣分，下一次快攻仍可再试。";
    }
  } else if (doubleTap && (actionId === "pass" || actionId === "shoot") && !attackSuccessKinds.has(eventKind) && !connectSuccessKinds.has(eventKind)) {
    recoveryText = "双击动作已识别，但当前不是合适的快攻路线 · 等“快攻”标识出现后再试。";
  }

  if (completed.length > 0) return complete(progress, completed, successText || "任务完成 · 继续比赛。");
  if (recoveryText) return withFeedback(progress, recoveryText, "RECOVER");
  return progress;
}

export function suggestedTutorialTask(progress: TutorialProgress, context: TutorialSuggestionContext): TutorialTaskDefinition | undefined {
  const remaining = new Set(TUTORIAL_TASKS.map((task) => task.id).filter((id) => !progress.completed.includes(id)));
  if (remaining.size === 0) return undefined;
  const preferred: TutorialTaskId[] = !progress.completed.includes("GUIDE")
    ? ["GUIDE"]
    : context.phase === "FASTBREAK" && context.possession === "home"
      ? ["FASTBREAK_DOUBLE", "ATTACK", "CONNECT", "SCREEN"]
      : context.possession === "away"
        ? ["DEFEND"]
        : context.onBall
          ? ["CONNECT", "ATTACK", "SCREEN"]
          : ["CONNECT", "SCREEN"];
  const id = preferred.find((candidate) => remaining.has(candidate))
    ?? TUTORIAL_TASKS.find((task) => remaining.has(task.id))?.id;
  return TUTORIAL_TASKS.find((task) => task.id === id);
}

export function evaluateTutorialPerformance(progress: TutorialProgress, line: TutorialPerformanceLine): TutorialEvaluation {
  const done = new Set(progress.completed);
  const shootingPercent = line.attempts > 0 ? line.made / line.attempts : 0;
  const dimensions: TutorialEvaluationDimension[] = [
    {
      id: "DECISION",
      label: "决策阅读",
      score: clampInteger(10 + (done.has("GUIDE") ? 5 : 0) + (done.has("CONNECT") ? 5 : 0) + (done.has("SCREEN") ? 5 : 0), 10, 25),
      max: 25,
      detail: `玩法、传接、挡拆完成 ${["GUIDE", "CONNECT", "SCREEN"].filter((id) => done.has(id as TutorialTaskId)).length}/3`,
    },
    {
      id: "OFFENSE",
      label: "进攻执行",
      score: clampInteger(12 + (done.has("ATTACK") ? 8 : 0) + Math.min(3, line.points) + Math.min(2, shootingPercent * 2), 12, 25),
      max: 25,
      detail: `${line.points}分 · 投篮${line.made}/${line.attempts}`,
    },
    {
      id: "DEFENSE",
      label: "防守投入",
      score: clampInteger(8 + (done.has("DEFEND") ? 8 : 0) + Math.min(4, line.steals * 2 + line.blocks * 2), 8, 20),
      max: 20,
      detail: `防守任务${done.has("DEFEND") ? "完成" : "待完成"} · 断${line.steals}帽${line.blocks}`,
    },
    {
      id: "TRANSITION",
      label: "转换意识",
      score: clampInteger(5 + (done.has("FASTBREAK_DOUBLE") ? 8 : 0) + Math.min(2, line.steals), 5, 15),
      max: 15,
      detail: `快攻双击${done.has("FASTBREAK_DOUBLE") ? "完成" : "待完成"}`,
    },
    {
      id: "TEAM",
      label: "团队纪律",
      score: clampInteger(10 + Math.min(5, line.assists * 2 + line.rebounds) - Math.min(3, line.turnovers), 7, 15),
      max: 15,
      detail: `${line.assists}助攻 ${line.rebounds}篮板 ${line.turnovers}失误`,
    },
  ];
  return {
    total: Math.min(98, dimensions.reduce((sum, dimension) => sum + dimension.score, 0)),
    completedCount: progress.completed.length,
    dimensions,
  };
}
