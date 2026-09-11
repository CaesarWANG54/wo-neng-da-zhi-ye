import { playerById } from "./data";
import {
  assessDriveLane,
  calculateStealChance,
  clamp,
  resolveDriveKickPass,
  nextRandom,
  resolveDrive,
  resolvePass,
  resolvePickAndRoll,
  resolveShot,
} from "./core";
import { resolveShootingContact } from "./officiating";
import { accumulateStealAttempt } from "./input";
import {
  canAcceptGameAction,
  canCallNaturalFoul,
  callPersonalFoul,
  commitGameEvent,
  declareOutOfBounds,
  releasePass,
  startResolvedShot,
  startFastbreak,
} from "./flow";
import { applyActionMotion, applyTacticMotion, courtVisualDistance, type ActionMotionId } from "./movement";
import { createHomeTacticExecution, getHomeTactic } from "./player-tactics";
import { applyPlayerStatsEvent } from "./player-stats";
import type { BallFlightKindForPass, DefenseResponseAction, MatchState, ShotFlightType } from "./types";

export { completeInbound } from "./flow";

export type GameActionId =
  | "pass"
  | "drive"
  | "shoot"
  | "screen"
  | "tactic"
  | "request"
  | "cut"
  | "spot"
  | "contain"
  | "steal"
  | "contest"
  | "switch"
  | "zone";

export type TacticId = NonNullable<MatchState["activeTactic"]>;

function addEvent(
  state: MatchState,
  kind: string,
  text: string,
  patch: Partial<MatchState> = {},
  _legacyActionSeconds?: number,
): MatchState {
  return commitGameEvent(state, kind, text, patch);
}

function afterHomeAttempt(
  state: MatchState,
  made: boolean,
  points: number,
  seed: number,
  explanation: string,
  shotType: ShotFlightType,
  shooterId = state.ballHandlerId,
  defenderId?: string,
  explicitAssistPlayerId?: string,
): MatchState {
  const shooter = playerById.get(shooterId);
  const defender = playerById.get(defenderId ?? state.currentMatchups[shooterId]);
  const rimAttempt = shotType === "RIM" || shotType === "DUNK" || shotType === "ALLEY_OOP";
  const contact = shooter && defender
    ? resolveShootingContact(shooter.ratings, defender.ratings, seed, rimAttempt, state.advantage !== "MISMATCH")
    : { foul: false, seed, probability: 0 };
  const naturalShootingFoul = contact.foul && canCallNaturalFoul(state, points === 3);
  const assistPlayerId = explicitAssistPlayerId
    ?? (state.potentialAssistReceiverId === shooterId ? state.potentialAssistPlayerId : undefined);
  return startResolvedShot(state, {
    attackingTeam: "home",
    shooterId,
    points: points as 2 | 3,
    made,
    shotType,
    explanation,
    seed: contact.seed,
    shootingFoul: naturalShootingFoul,
    foulerId: naturalShootingFoul ? defender?.id : undefined,
    foulSource: "NATURAL",
    assistPlayerId: assistPlayerId === shooterId ? undefined : assistPlayerId,
  });
}

function resolveOnBall(state: MatchState, actionId: GameActionId, doubleTap: boolean) {
  if (actionId === "screen") {
    const resolution = resolvePickAndRoll(state);
    let screenSeed = resolution.seed;
    if (resolution.value.result === "MISSED_CONTACT") {
      const whistleRoll = nextRandom(resolution.seed);
      screenSeed = whistleRoll.seed;
      if (whistleRoll.value < 0.04 && canCallNaturalFoul(state)) {
        return callPersonalFoul({ ...state, seed: whistleRoll.seed }, {
          offenderId: resolution.value.screenerId,
          offendedPlayerId: resolution.value.screenerDefenderBefore,
          kind: "ILLEGAL_SCREEN",
          seed: whistleRoll.seed,
          source: "NATURAL",
        });
      }
    }
    return addEvent(
      state,
      "SCREEN",
      "已呼叫挡拆 · 掩护人正在建立合法位置",
      {
        seed: screenSeed,
        phase: "SCREEN_APPROACH",
        screen: resolution.value,
        transitionClock: 1.35,
        fastbreakClock: null,
        advantage: undefined,
        pendingDrive: undefined,
      },
      4,
    );
  }

  if (actionId === "pass") {
    const driveKick = state.advantage === "DRIVE_LANE"
      && state.pendingDrive?.handlerId === state.ballHandlerId
      && state.motion.intents[state.ballHandlerId] === "DRIVE";
    const result = driveKick ? resolveDriveKickPass(state) : resolvePass(state, doubleTap);
    if (!result) {
      return addEvent(state, "DRIVE_KICK_UNAVAILABLE", "外围没有合法接应点 · 自动扣篮已取消，可继续终结或急停", {
        pendingDrive: undefined,
        transitionClock: null,
      });
    }
    if (!driveKick && doubleTap && state.phase !== "FASTBREAK" && (!state.screen || state.screen.route === "POP")) {
      return addEvent(state, "LOB_UNAVAILABLE", "当前没有通往篮筐的空接路线", { seed: result.seed }, 0);
    }
    if (!result.completed) {
      const boundaryRoll = nextRandom(result.seed);
      const scoredLaneRisk = "laneRisk" in result && typeof result.laneRisk === "number"
        ? result.laneRisk
        : undefined;
      const ordinaryDeflection = !driveKick && !doubleTap && scoredLaneRisk !== undefined;
      const outOfBoundsChance = ordinaryDeflection
        ? clamp(0.4 - scoredLaneRisk * 0.24, 0.14, 0.38)
        : 0.24;
      if (boundaryRoll.value < outOfBoundsChance) {
        return declareOutOfBounds(
          { ...state, seed: boundaryRoll.seed, pendingDrive: undefined, transitionClock: null },
          { lastTouchedBy: ordinaryDeflection ? "away" : "home", spot: "SIDELINE", zone: "FRONTCOURT" },
        );
      }
      const interceptorId = state.currentMatchups[result.targetId] ?? "a7";
      const playerBoxScores = applyPlayerStatsEvent(state.playerBoxScores, {
        type: "TURNOVER",
        playerId: state.ballHandlerId,
        stolenByPlayerId: interceptorId,
      });
      return startFastbreak(state, "away", "TURNOVER", `${driveKick ? "突分失误" : result.explanation} · 对方抢断进入快攻`, {
        seed: boundaryRoll.seed,
        playerStats: { ...state.playerStats, turnovers: state.playerStats.turnovers + 1 },
        playerBoxScores,
        ballHandlerId: interceptorId,
      });
    }
    if (!driveKick && doubleTap) {
      const finish = resolveDrive({ ...state, seed: result.seed, ballHandlerId: result.targetId }, "DUNK");
      return afterHomeAttempt(state, finish.made, 2, finish.seed, `空接传给${playerById.get(result.targetId)?.number}号`, "ALLEY_OOP", result.targetId, finish.helperId ?? finish.defenderId, state.ballHandlerId);
    }
    // Migrated pass-arrival path: the completed pass is RELEASED now. The
    // receiver does not become the ball handler until the flight reaches
    // the fixed catch point (completePassArrival in the engine loop).
    const passerId = state.ballHandlerId;
    const targetId = result.targetId;
    const targetNumber = playerById.get(targetId)?.number;
    const passKind: BallFlightKindForPass = state.screen?.screenerId === targetId && (
      state.screen.route === "ROLL"
      || state.screen.route === "SHORT_ROLL"
      || state.screen.route === "SLIP"
    )
      ? "BOUNCE"
      : "PASS";
    return releasePass(state, passerId, targetId, passKind, {
      text: result.explanation,
      arrivalText: driveKick
        ? `${targetNumber ?? "队友"}号接到突分球 · 获得外线二次决策`
        : `${targetNumber ?? "队友"}号接球 · 进入二次决策`,
      seed: result.seed,
      continuation: "PLAYER_SETTLE",
      releasePatch: {
        potentialAssistPlayerId: passerId,
        potentialAssistReceiverId: targetId,
        pendingDrive: undefined,
        transitionClock: null,
        advantage: undefined,
      },
      arrivalPatch: {
        phase: "SECOND_DECISION",
        fastbreakClock: null,
        advantage: driveKick ? "KICK_OUT" : undefined,
        screen: !driveKick && state.screen?.screenerId === targetId ? state.screen : undefined,
      },
    });
  }

  if (actionId === "shoot") {
    const handler = playerById.get(state.ballHandlerId);
    const handlerPoint = state.motion.positions[state.ballHandlerId];
    const rimPoint = handler ? { x: handler.team === "home" ? 11 : 89, y: 50 } : undefined;
    const nearRim = Boolean(handlerPoint && rimPoint && courtVisualDistance(handlerPoint, rimPoint) <= 20);
    const canDunk =
      state.phase === "FASTBREAK" ||
      state.advantage === "DRIVE_LANE" ||
      nearRim ||
      Boolean(state.screen && state.screen.screenerId === state.ballHandlerId && state.screen.route !== "POP");
    if (doubleTap && !canDunk) {
      return addEvent(state, "DUNK_UNAVAILABLE", "距离篮筐过远，当前不能发起扣篮", {}, 0);
    }
    if (state.advantage === "SECOND_CHANCE" && nearRim) {
      const finish = resolveDrive(state, doubleTap ? "DUNK" : "LAYUP");
      return afterHomeAttempt(
        state,
        finish.made,
        2,
        finish.seed,
        `${doubleTap ? "前场篮板补扣" : "前场篮板补篮"} · ${finish.explanation}`,
        doubleTap ? "DUNK" : "RIM",
        state.ballHandlerId,
        finish.helperId ?? finish.defenderId,
      );
    }
    if (doubleTap) {
      const finish = resolveDrive(state, "DUNK");
      return afterHomeAttempt(state, finish.made, 2, finish.seed, `扣篮尝试 · ${finish.explanation}`, "DUNK", state.ballHandlerId, finish.helperId ?? finish.defenderId);
    }
    const isThree = state.advantage !== "DRIVE_LANE" && !nearRim;
    const shot = resolveShot(state, isThree);
    return afterHomeAttempt(state, shot.made, isThree ? 3 : 2, shot.seed, `${isThree ? "三分出手" : "急停中投"} · ${shot.explanation}`, isThree ? "THREE" : "MID_RANGE", state.ballHandlerId, shot.defenderId);
  }

  if (actionId === "drive") {
    if (state.advantage !== "DRIVE_LANE") {
      const attacker = playerById.get(state.ballHandlerId);
      const defender = playerById.get(state.currentMatchups[state.ballHandlerId]);
      const lane = assessDriveLane(state);
      const edge = attacker && defender
        ? attacker.ratings.ballHandle + attacker.ratings.acceleration - defender.ratings.perimeterDefense - defender.ratings.lateralQuickness
        : 0;
      const eventKind = lane.openRim ? "DRIVE_START_OPEN_RIM" : "DRIVE_START";
      const eventText = lane.openRim
        ? "突破路线完全打开 · 正在冲向篮筐，抵达近筐后自动扣篮"
        : edge >= 0
          ? "突破压住外线防守 · 可终结、急停或突分"
          : "突破进入身体对抗 · 内线协防正在收缩";
      return addEvent(state, eventKind, eventText, {
        phase: "SECOND_DECISION",
        fastbreakClock: null,
        advantage: "DRIVE_LANE",
        transitionClock: null,
        pendingDrive: {
          id: `drive-${state.eventSequence + 1}-${state.seed}`,
          handlerId: state.ballHandlerId,
          startedAtShotClock: state.shotClock,
          laneOpenAtStart: lane.openRim,
          rimProtectorId: lane.rimProtectorId,
          pathBlockerIds: lane.pathBlockerIds,
        },
      });
    }
    if (state.pendingDrive?.handlerId === state.ballHandlerId) {
      return addEvent(
        state,
        state.pendingDrive.laneOpenAtStart ? "DRIVE_CONTINUE_OPEN_RIM" : "DRIVE_CONTINUE",
        state.pendingDrive.laneOpenAtStart
          ? "空篮路线仍然打开 · 继续冲筐，抵达近筐后自动扣篮"
          : "阵地突破仍在进行 · 抵达近筐后按上篮与护筐能力自动结算",
        {
          transitionClock: null,
        },
      );
    }
    const drive = resolveDrive(state, "LAYUP");
    return afterHomeAttempt(state, drive.made, 2, drive.seed, drive.explanation, "RIM", state.ballHandlerId, drive.helperId ?? drive.defenderId);
  }

  return state;
}

function resolveOffBall(state: MatchState, actionId: GameActionId) {
  if (actionId === "screen") {
    const resolution = resolvePickAndRoll(state);
    return addEvent(
      state,
      "OFF_BALL_SCREEN",
      `你正在为${playerById.get(state.ballHandlerId)?.number}号建立掩护位置`,
      {
        seed: resolution.seed,
        phase: "SCREEN_APPROACH",
        screen: resolution.value,
        transitionClock: 1.35,
        advantage: undefined,
      },
      4,
    );
  }

  const handler = playerById.get(state.ballHandlerId);
  if (!handler) return state;
  const roll = nextRandom(state.seed);
  const readChance = clamp(
    (handler.ratings.passVision * 0.4 + handler.ratings.basketballIQ * 0.35 + handler.ratings.decisionSpeed * 0.25) / 100,
    0.25,
    0.9,
  );

  if (actionId === "request") {
    if (roll.value < readChance) {
      const controlledNumber = playerById.get(state.controlledPlayerId)?.number;
      const handlerId = state.ballHandlerId;
      const controlledId = state.controlledPlayerId;
      return releasePass(state, handlerId, controlledId, "PASS", {
        text: controlledNumber == null ? "队友读到你的要球信号 · 球回到你手中" : `队友读到你的要球信号 · 球回到${controlledNumber}号手中`,
        arrivalText: controlledNumber == null ? "你接到队友回传" : `${controlledNumber}号接到队友回传`,
        seed: roll.seed,
        continuation: "PLAYER_SETTLE",
        releasePatch: {
          potentialAssistPlayerId: handlerId,
          potentialAssistReceiverId: controlledId,
        },
        arrivalPatch: {},
      });
    }
    return addEvent(state, "REQUEST_DENIED", "传球路线被封锁 · 队友继续组织", { seed: roll.seed }, 1);
  }

  if (actionId === "cut") {
    const cutter = playerById.get(state.controlledPlayerId);
    const movementBonus = cutter ? (cutter.ratings.offBallMovement - 70) / 180 : 0;
    if (roll.value < readChance + 0.08 + movementBonus) {
      const fastbreak = state.phase === "FASTBREAK";
      const handlerId = state.ballHandlerId;
      const controlledId = state.controlledPlayerId;
      return releasePass(state, handlerId, controlledId, "PASS", {
        text: fastbreak ? "顺下时机正确 · 队友把球送到篮筐路线" : "反跑摆脱成功 · 队友把球送到切入路线",
        arrivalText: fastbreak ? "你在顺下路线接球" : "你在空切路线接球",
        seed: roll.seed,
        continuation: "PLAYER_SETTLE",
        releasePatch: {
          potentialAssistPlayerId: handlerId,
          potentialAssistReceiverId: controlledId,
        },
        arrivalPatch: {
          phase: "SECOND_DECISION",
          fastbreakClock: null,
        },
      });
    }
    return addEvent(
      state,
      state.phase === "FASTBREAK" ? "FASTBREAK_ROLL_MISSED" : "CUT_MISSED",
      state.phase === "FASTBREAK" ? "顺下窗口被封住 · 回到外线保持间距" : "空切时机没有被队友识别 · 回到弱侧",
      { seed: roll.seed },
      3,
    );
  }

  if (actionId === "spot") {
    if (roll.value < readChance * 0.42) {
      const fastbreak = state.phase === "FASTBREAK";
      const handlerId = state.ballHandlerId;
      const controlledId = state.controlledPlayerId;
      return releasePass(state, handlerId, controlledId, "PASS", {
        text: fastbreak ? "你落到拖车三分点 · 队友及时回传" : "你外弹拉开防守 · 队友把球回传到三分点",
        arrivalText: fastbreak ? "你在拖车三分点接球" : "你在外弹三分点接球",
        seed: roll.seed,
        continuation: "PLAYER_SETTLE",
        releasePatch: {
          potentialAssistPlayerId: handlerId,
          potentialAssistReceiverId: controlledId,
        },
        arrivalPatch: {
          phase: "SECOND_DECISION",
          fastbreakClock: null,
        },
      });
    }
    return addEvent(
      state,
      state.phase === "FASTBREAK" ? "FASTBREAK_SPOT" : "SPACING",
      state.phase === "FASTBREAK" ? "你在三分线外站定 · 为持球人拉开快攻空间" : "你外弹到三分线外 · 清空中路突破空间",
      { seed: roll.seed },
      2,
    );
  }

  return state;
}

function resolveDefense(state: MatchState, actionId: GameActionId) {
  const defender = playerById.get(state.controlledPlayerId);
  const handler = playerById.get(state.ballHandlerId);
  if (!defender || !handler) return state;
  const defenderPoint = state.motion.positions[defender.id];
  const handlerPoint = state.motion.positions[handler.id];
  const distance = defenderPoint && handlerPoint ? courtVisualDistance(defenderPoint, handlerPoint) : Number.POSITIVE_INFINITY;
  const shotThreat = Boolean(state.opponentOffense?.pendingAttempt || state.opponentOffense?.visibleIntent === "SHOOT");
  const driveThreat = state.opponentOffense?.visibleIntent === "DRIVE" || state.opponentOffense?.visibleIntent === "BALL_SCREEN";
  const responseLabels: Record<DefenseResponseAction, string> = {
    CONTAIN: driveThreat ? "盯防压制已提交" : "保持对位已提交",
    CONTEST: shotThreat ? "封盖干扰已提交" : "提前上抢已提交",
    STEAL_PRESSURE: "抢断施压已提交",
    GAMBLE: "抢断冒险已提交",
    SWITCH: "换防已提交",
    ZONE: "联防已提交",
  };
  const responsePatch = (action: DefenseResponseAction): Partial<MatchState> => {
    const token = state.opponentOffense?.decisionToken;
    if (!token) return {};
    return {
      pendingDefenseResponse: { decisionToken: token, action },
      lastDefenseResponse: {
        decisionToken: token,
        action,
        label: responseLabels[action],
        eventSequence: state.eventSequence + 1,
      },
    };
  };
  const responseLocked = Boolean(
    state.opponentOffense && state.pendingDefenseResponse?.decisionToken === state.opponentOffense.decisionToken,
  );

  if (actionId === "contain") {
    return addEvent(
      state,
      "CONTAIN",
      distance <= 10 ? "保持在球与篮筐之间 · 压缩对方突破路线" : "向持球人收近 · 队友同步保护弱侧",
      responsePatch("CONTAIN"),
    );
  }

  if (actionId === "steal") {
    const accumulated = accumulateStealAttempt(
      state.stealAttemptAccumulator,
      defender.id,
      state.offensivePossessionSerial,
    );
    const attemptPatch: Partial<MatchState> = { stealAttemptAccumulator: accumulated.value };
    if (accumulated.commitsFoul) {
      return callPersonalFoul({ ...state, ...attemptPatch }, {
        offenderId: defender.id,
        offendedPlayerId: handler.id,
        kind: "NON_SHOOTING",
        seed: state.seed,
        source: "FORCED",
        callText: `${defender.number}号连续第${accumulated.value.count}次上抢打手 · 防守犯规`,
      });
    }
    if (responseLocked) {
      return addEvent(
        state,
        "DEFENSE_RESPONSE_LOCKED",
        `连续上抢累计${accumulated.value.count}/5 · 本次阅读已提交，不能重掷抢断结果`,
        attemptPatch,
      );
    }
    const roll = nextRandom(state.seed);
    if (distance > 13) {
      return addEvent(state, "STEAL_CLOSE_GAP", "距离不足以直接抢断 · 先封住传球线并靠近持球人", { seed: roll.seed, ...attemptPatch, ...responsePatch("STEAL_PRESSURE") });
    }
    const stealChance = calculateStealChance(defender, handler);
    if (roll.value < stealChance) {
      const playerBoxScores = applyPlayerStatsEvent(state.playerBoxScores, {
        type: "TURNOVER",
        playerId: handler.id,
        stolenByPlayerId: defender.id,
      });
      return startFastbreak(
        state,
        "home",
        "STEAL",
        "预判传球路线完成抢断 · 形成快攻",
        {
          seed: roll.seed,
          playerStats: { ...state.playerStats, steals: state.playerStats.steals + 1 },
          opponentStats: { ...state.opponentStats, turnovers: state.opponentStats.turnovers + 1 },
          playerBoxScores,
          ballHandlerId: defender.id,
          stealAttemptAccumulator: undefined,
        },
      );
    }
    if (roll.value < stealChance + 0.14) {
      return declareOutOfBounds(
        { ...state, seed: roll.seed },
        { lastTouchedBy: "home", spot: "SIDELINE", zone: "FRONTCOURT" },
      );
    }
    if (roll.value < stealChance + 0.18 && canCallNaturalFoul(state)) {
      return callPersonalFoul({ ...state, ...attemptPatch, seed: roll.seed }, {
        offenderId: defender.id,
        offendedPlayerId: handler.id,
        kind: "NON_SHOOTING",
        seed: roll.seed,
        source: "NATURAL",
      });
    }
    return addEvent(state, "STEAL_MISS", "抢断落空 · 对方获得短暂进攻空间", { seed: roll.seed, ...attemptPatch, ...responsePatch("GAMBLE") }, 2);
  }

  if (actionId === "contest") {
    return addEvent(
      state,
      distance > 18 ? "CONTEST_CLOSEOUT" : "CONTEST_READY",
      distance > 18 ? "从弱侧扑向出手点 · 干扰将在对方真正出手时结算" : "保持垂直并准备干扰 · 不替对方提前决定出手",
      responsePatch("CONTEST"),
    );
  }

  if (actionId === "switch") {
    const currentOpponent = state.currentMatchups[state.controlledPlayerId];
    const awayOrder = ["a7", "a8", "a9", "a11", "a23"];
    const targetOpponent = currentOpponent === state.ballHandlerId
      ? awayOrder[(awayOrder.indexOf(currentOpponent) + 1) % awayOrder.length]
      : state.ballHandlerId;
    const teammateEntry = Object.entries(state.currentMatchups).find(([, awayId]) => awayId === targetOpponent);
    if (!teammateEntry) return addEvent(state, "SWITCH_REJECTED", "当前没有合法的换防对象 · 继续保持对位");
    const [teammateId] = teammateEntry;
    const currentMatchups = {
      ...state.currentMatchups,
      [state.controlledPlayerId]: targetOpponent,
      [teammateId]: currentOpponent,
    };
    return addEvent(state, "SWITCH", `完成换防 · 你改为盯防${playerById.get(targetOpponent)?.number ?? "对方"}号`, {
      currentMatchups,
      defenseScheme: "MAN",
      ...responsePatch("SWITCH"),
    });
  }

  if (actionId === "zone") {
    const defenseScheme = state.defenseScheme === "ZONE_2_3" ? "MAN" : "ZONE_2_3";
    return addEvent(
      state,
      "ZONE_SET",
      defenseScheme === "ZONE_2_3" ? "切换2-3联防 · 双上线延阻，三人收缩禁区" : "退出联防 · 全队恢复人盯人",
      { defenseScheme, ...responsePatch("ZONE") },
    );
  }

  return state;
}

export function resolveGameAction(state: MatchState, actionId: GameActionId, doubleTap = false): MatchState {
  if (!canAcceptGameAction(state)) return state;
  const actionState = state.possession === "away" && actionId !== "steal" && state.stealAttemptAccumulator
    ? { ...state, stealAttemptAccumulator: undefined }
    : state;
  const resolved = actionState.possession === "away"
    ? resolveDefense(actionState, actionId)
    : actionState.controlledPlayerId === actionState.ballHandlerId
      ? resolveOnBall(actionState, actionId, doubleTap)
      : resolveOffBall(actionState, actionId);
  return actionId === "tactic" ? resolved : applyActionMotion(state, resolved, actionId as ActionMotionId);
}

export function selectTactic(state: MatchState, tactic: TacticId) {
  if (!canAcceptGameAction(state)) return state;
  const { execution, seed } = createHomeTacticExecution(state, tactic);
  const definition = getHomeTactic(tactic);
  const sideLabel = execution.side === "UPPER" ? "上侧" : "下侧";
  const next = addEvent(state, "TACTIC", `${definition.name} · ${sideLabel}${execution.entryLabel} · ${execution.counterLabel}`, {
    seed,
    activeTactic: tactic,
    homeTacticExecution: execution,
    lastHomeTacticSignature: execution.signature,
    homeTacticSignatureHistory: [...state.homeTacticSignatureHistory, execution.signature].slice(-6),
    homeTacticHistory: [...state.homeTacticHistory, tactic].slice(-5),
    phase: state.phase === "FASTBREAK" ? "SET_OFFENSE" : state.phase,
    fastbreakClock: state.phase === "FASTBREAK" ? null : state.fastbreakClock,
    transitionClock: null,
    pendingDrive: undefined,
    advantage: undefined,
  }, 1);
  return applyTacticMotion(next, tactic);
}

export function resetMatch(state: MatchState, initial: MatchState) {
  const restored: MatchState = {
    ...initial,
    version: state.version,
    decisionEpoch: state.decisionEpoch,
    eventSequence: state.eventSequence,
    phaseToken: `reset-${state.eventSequence}`,
    eventLog: [],
  };
  return commitGameEvent(restored, "RESET", "已恢复到第4节3:00的教学检查点");
}
