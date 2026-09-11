import type { StealAttemptAccumulator } from "./types";

export const DOUBLE_TAP_WINDOW_MS = 260;
export const MAX_CONSECUTIVE_STEAL_ATTEMPTS = 4;

export interface PendingTap {
  actionId: string;
  at: number;
  decisionEpoch: number;
}

export type TapClassification =
  | { kind: "PENDING_SINGLE"; pending: PendingTap }
  | { kind: "DOUBLE"; pending: null }
  | { kind: "REPLACE_PENDING"; pending: PendingTap };

export function classifyTap(
  current: PendingTap | null,
  actionId: string,
  at: number,
  decisionEpoch: number,
  windowMs = DOUBLE_TAP_WINDOW_MS,
): TapClassification {
  const next = { actionId, at, decisionEpoch };
  if (!current) return { kind: "PENDING_SINGLE", pending: next };
  const sameContext = current.decisionEpoch === decisionEpoch;
  const withinWindow = at - current.at >= 0 && at - current.at <= windowMs;
  if (sameContext && withinWindow && current.actionId === actionId) {
    return { kind: "DOUBLE", pending: null };
  }
  return { kind: "REPLACE_PENDING", pending: next };
}

export function isPendingTapStillValid(pending: PendingTap, decisionEpoch: number) {
  return pending.decisionEpoch === decisionEpoch;
}

export function accumulateStealAttempt(
  current: StealAttemptAccumulator | undefined,
  defenderId: string,
  possessionSerial: number,
) {
  const sameSequence = current?.defenderId === defenderId
    && current.possessionSerial === possessionSerial;
  const next: StealAttemptAccumulator = {
    defenderId,
    possessionSerial,
    count: sameSequence ? current.count + 1 : 1,
  };
  return {
    value: next,
    commitsFoul: next.count > MAX_CONSECUTIVE_STEAL_ATTEMPTS,
  };
}
