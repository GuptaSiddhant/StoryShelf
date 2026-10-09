/** Pure budget arithmetic (thresholds, UTC day windows, weighted counting). */
import type { AiBudget } from "../ai.ts";

/** Alert thresholds as percentages of the daily cap. */
export const BUDGET_THRESHOLDS = [50, 75, 90, 100] as const;

/** UTC day key (`YYYY-MM-DD`). */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Start of the UTC day containing `date`, as an ISO string. */
export function utcDayStart(date: Date): string {
  return `${utcDay(date)}T00:00:00.000Z`;
}

/** Tokens counted toward the budget for one call (vision weighting applies). */
export function countedTokens(
  usage: { inputTokens: number; outputTokens: number },
  images: number,
  budget: Pick<AiBudget, "visionWeight">,
): number {
  const raw = usage.inputTokens + usage.outputTokens;
  return images > 0 ? Math.ceil(raw * budget.visionWeight) : raw;
}

/** Thresholds crossed when moving from `before` to `after` tokens of `cap`. */
export function crossedThresholds(before: number, after: number, cap: number): number[] {
  if (cap <= 0) {
    return [];
  }
  return BUDGET_THRESHOLDS.filter((t) => before < (cap * t) / 100 && after >= (cap * t) / 100);
}
