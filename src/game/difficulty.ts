import type { DifficultyId } from "./types";

export interface DifficultyProgressionPolicy {
  controlledPlayerContribution: number;
  rewardMultiplier: number;
}

/**
 * One source of truth for both match contribution and career reward tuning.
 * Match code consumes only `controlledPlayerContribution`; career settlement
 * consumes only `rewardMultiplier`.
 */
export const DIFFICULTY_PROGRESSION_POLICY: Readonly<Record<DifficultyId, DifficultyProgressionPolicy>> = {
  ROOKIE: { controlledPlayerContribution: 1.2, rewardMultiplier: 0.3 },
  PRO: { controlledPlayerContribution: 0.9, rewardMultiplier: 0.8 },
  STARTER: { controlledPlayerContribution: 0.8, rewardMultiplier: 1 },
  ALL_STAR: { controlledPlayerContribution: 0.75, rewardMultiplier: 1.1 },
  HALL_OF_FAME: { controlledPlayerContribution: 0.7, rewardMultiplier: 1.3 },
};

export function scaleControlledPositiveContribution(value: number, difficulty: DifficultyId) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Controlled contribution must be a finite non-negative number");
  }
  return value * DIFFICULTY_PROGRESSION_POLICY[difficulty].controlledPlayerContribution;
}

/**
 * Difficulty changes only the beneficial part of a created player's rating
 * contribution. A below-baseline rating remains an honest weakness instead
 * of becoming less harmful on a harder difficulty, and base probability,
 * spacing, defense and tactic bonuses are never multiplied here.
 */
export function scaleControlledAttributeContribution(value: number, difficulty: DifficultyId) {
  if (!Number.isFinite(value)) {
    throw new Error("Controlled attribute contribution must be finite");
  }
  return value > 0 ? scaleControlledPositiveContribution(value, difficulty) : value;
}
