/** DB-counted budget: pre-flight limits, usage rows and threshold alerts. */
import { countedTokens, crossedThresholds, utcDay, utcDayStart } from "@storyshelf/core/insights";
import { AiBudgetAlertModel, AiUsageModel } from "@storyshelf/core/models";
import type { AiUsageInput } from "@storyshelf/core/models";
import { notifySystemWith } from "../notify.ts";
import type { InsightDeps } from "./deps.ts";
import { failWith } from "./errors.ts";

const HOUR_MS = 3_600_000;

/** Tokens counted so far today (UTC), summed across all instances from rows. */
export async function dayTokens(deps: InsightDeps, now = new Date()): Promise<number> {
  const rows = await new AiUsageModel(deps.db).listSince(utcDayStart(now));
  const { visionWeight } = deps.ai.budget();
  return rows.reduce((sum, row) => sum + countedTokens(row, row.images, { visionWeight }), 0);
}

/** Reject (429 + Retry-After) when the daily cap or the project's hourly limit is hit. */
export async function assertWithinBudget(
  deps: InsightDeps,
  projectId: string,
  now = new Date(),
): Promise<void> {
  const budget = deps.ai.budget();
  const calls = await new AiUsageModel(deps.db).countCalls(
    projectId,
    new Date(now.getTime() - HOUR_MS).toISOString(),
  );
  if (calls >= budget.perProjectCallsPerHour) {
    failWith(429, "ai-hourly-limit", 600);
  }
  if (budget.dailyTokens !== undefined && (await dayTokens(deps, now)) >= budget.dailyTokens) {
    const midnight = new Date(`${utcDay(now)}T00:00:00.000Z`).getTime() + 86_400_000;
    failWith(429, "ai-daily-budget", Math.max(1, Math.ceil((midnight - now.getTime()) / 1000)));
  }
}

async function fireAlerts(
  deps: InsightDeps,
  thresholds: number[],
  day: string,
  usedTokens: number,
  dailyTokens: number,
): Promise<void> {
  const alerts = new AiBudgetAlertModel(deps.db);
  for (const threshold of thresholds) {
    // eslint-disable-next-line no-await-in-loop -- claims must be sequential per threshold
    if (await alerts.claim(day, threshold)) {
      // eslint-disable-next-line no-await-in-loop -- ordered notifications
      await notifySystemWith(deps.notify, "sys:ai-budget", {
        threshold,
        day,
        usedTokens,
        dailyTokens,
      });
    }
  }
}

/** Record one call's usage and fire `sys:ai-budget` for each newly crossed threshold. */
export async function recordUsage(deps: InsightDeps, input: AiUsageInput): Promise<void> {
  const { dailyTokens, visionWeight } = deps.ai.budget();
  const now = new Date();
  const before = dailyTokens === undefined ? 0 : await dayTokens(deps, now);
  await new AiUsageModel(deps.db).record(input);
  if (dailyTokens !== undefined) {
    const after = before + countedTokens(input, input.images, { visionWeight });
    await fireAlerts(
      deps,
      crossedThresholds(before, after, dailyTokens),
      utcDay(now),
      after,
      dailyTokens,
    );
  }
}
