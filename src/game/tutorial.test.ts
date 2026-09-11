import { describe, expect, it } from "vitest";
import {
  createTutorialProgress,
  evaluateTutorialPerformance,
  recordTutorialAction,
  recordTutorialUi,
  suggestedTutorialTask,
  TUTORIAL_TASKS,
} from "./tutorial";

describe("non-blocking tutorial progression", () => {
  it("requires both pause and help while accepting either visit order", () => {
    const initial = createTutorialProgress();
    const helpFirst = recordTutorialUi(initial, "HELP_OPENED");
    expect(helpFirst.completed).not.toContain("GUIDE");
    expect(helpFirst.feedback).toContain("暂停");

    const finished = recordTutorialUi(helpFirst, "PAUSE_OPENED");
    expect(finished.completed).toContain("GUIDE");
    expect(finished.feedbackKind).toBe("SUCCESS");
  });

  it("advances successful pass, attack, screen, defense and fastbreak actions without requiring order", () => {
    let progress = createTutorialProgress();
    progress = recordTutorialAction(progress, { actionId: "screen", doubleTap: false, phase: "SET_OFFENSE", possession: "home", eventKind: "SCREEN", eventAdvanced: true });
    progress = recordTutorialAction(progress, { actionId: "contain", doubleTap: false, phase: "SET_OFFENSE", possession: "away", eventKind: "CONTAIN", eventAdvanced: true });
    progress = recordTutorialAction(progress, { actionId: "pass", doubleTap: false, phase: "SET_OFFENSE", possession: "home", eventKind: "PASS_RELEASE", eventAdvanced: true });
    progress = recordTutorialAction(progress, { actionId: "drive", doubleTap: false, phase: "SECOND_DECISION", possession: "home", eventKind: "DRIVE_START", eventAdvanced: true });
    progress = recordTutorialAction(progress, { actionId: "shoot", doubleTap: true, phase: "FASTBREAK", possession: "home", eventKind: "SHOT_RELEASE", eventAdvanced: true });

    expect(progress.completed).toEqual(["CONNECT", "ATTACK", "SCREEN", "DEFEND", "FASTBREAK_DOUBLE"]);
    expect(progress.feedback).toContain("快攻扣篮");
  });

  it("keeps failed or mistimed actions recoverable and does not grant their task", () => {
    const failedLob = recordTutorialAction(createTutorialProgress(), {
      actionId: "pass",
      doubleTap: true,
      phase: "SET_OFFENSE",
      possession: "home",
      eventKind: "LOB_UNAVAILABLE",
      eventAdvanced: true,
    });
    expect(failedLob.completed).toEqual([]);
    expect(failedLob.feedbackKind).toBe("RECOVER");
    expect(failedLob.feedback).toContain("快攻");

    const recovered = recordTutorialAction(failedLob, {
      actionId: "pass",
      doubleTap: false,
      phase: "SET_OFFENSE",
      possession: "home",
      eventKind: "PASS_RELEASE",
      eventAdvanced: true,
    });
    expect(recovered.completed).toContain("CONNECT");
    expect(recovered.feedbackKind).toBe("SUCCESS");
  });

  it("suggests a context-reachable task but lets other tasks complete first", () => {
    let progress = recordTutorialUi(recordTutorialUi(createTutorialProgress(), "PAUSE_OPENED"), "HELP_OPENED");
    expect(suggestedTutorialTask(progress, { phase: "SET_OFFENSE", possession: "away", onBall: false })?.id).toBe("DEFEND");
    expect(suggestedTutorialTask(progress, { phase: "FASTBREAK", possession: "home", onBall: true })?.id).toBe("FASTBREAK_DOUBLE");
    progress = recordTutorialAction(progress, { actionId: "screen", doubleTap: false, phase: "SET_OFFENSE", possession: "home", eventKind: "SCREEN", eventAdvanced: true });
    expect(progress.completed).toContain("SCREEN");
  });
});

describe("tutorial evaluation breakdown", () => {
  it("exposes five explainable dimensions whose scores reconcile to the total", () => {
    let progress = createTutorialProgress();
    for (const event of ["PAUSE_OPENED", "HELP_OPENED"] as const) progress = recordTutorialUi(progress, event);
    for (const observation of [
      { actionId: "pass", doubleTap: false, phase: "SET_OFFENSE", possession: "home", eventKind: "PASS_RELEASE", eventAdvanced: true },
      { actionId: "shoot", doubleTap: false, phase: "SET_OFFENSE", possession: "home", eventKind: "SHOT_RELEASE", eventAdvanced: true },
      { actionId: "screen", doubleTap: false, phase: "SET_OFFENSE", possession: "home", eventKind: "SCREEN", eventAdvanced: true },
      { actionId: "contain", doubleTap: false, phase: "SET_OFFENSE", possession: "away", eventKind: "CONTAIN", eventAdvanced: true },
      { actionId: "shoot", doubleTap: true, phase: "FASTBREAK", possession: "home", eventKind: "SHOT_RELEASE", eventAdvanced: true },
    ] as const) progress = recordTutorialAction(progress, observation);

    const evaluation = evaluateTutorialPerformance(progress, {
      points: 3,
      rebounds: 2,
      assists: 2,
      steals: 1,
      blocks: 0,
      turnovers: 1,
      attempts: 2,
      made: 1,
    });
    expect(TUTORIAL_TASKS).toHaveLength(6);
    expect(evaluation.dimensions).toHaveLength(5);
    expect(evaluation.dimensions.map((item) => item.label)).toEqual(["决策阅读", "进攻执行", "防守投入", "转换意识", "团队纪律"]);
    expect(evaluation.total).toBe(Math.min(98, evaluation.dimensions.reduce((sum, item) => sum + item.score, 0)));
    expect(evaluation.completedCount).toBe(6);
  });

  it("keeps an unfinished first attempt playable instead of assigning a zero", () => {
    const evaluation = evaluateTutorialPerformance(createTutorialProgress(), {
      points: 0,
      rebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      attempts: 0,
      made: 0,
    });
    expect(evaluation.total).toBe(45);
    expect(evaluation.dimensions.every((item) => item.score > 0)).toBe(true);
  });
});
