/** DB-counted budget: pre-flight limits, usage rows and threshold alerts. */
import { countedTokens, crossedThresholds, utcDay, utcDayStart } from "@storyshelf/core/insights";
import { AiBudgetAlertModel, AiUsageModel } from "@storyshelf/core/models";
import type { AiUsageInput, AiUsageReservation } from "@storyshelf/core/models";
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

/** Today's tokens; when they cannot be read the reservation is given back, as nobody holds it yet. */
async function usedToday(
  deps: InsightDeps,
  usage: AiUsageModel,
  reservationId: string,
  now: Date,
): Promise<number> {
  return await dayTokens(deps, now).catch(async (error: unknown) => {
    await usage.release(reservationId).catch(() => null);
    throw error;
  });
}

/**
 * Reserve one of the project's calls before the model is called, or reject (429 + Retry-After)
 * when the hourly limit or the daily token cap is hit. The reservation is a `pending` usage row
 * counted as a call (see `AiUsageModel.reserve`), so concurrent requests cannot all pass a check
 * and overshoot `perProjectCallsPerHour`. Tokens are only known after the call, so the daily cap
 * can still be overshot by the output of the calls already running. Returns the reservation id.
 */
export async function reserveBudget(
  deps: InsightDeps,
  reservation: AiUsageReservation,
  now = new Date(),
): Promise<string> {
  const budget = deps.ai.budget();
  const usage = new AiUsageModel(deps.db);
  const row = await usage.reserve(reservation, {
    since: new Date(now.getTime() - HOUR_MS).toISOString(),
    max: budget.perProjectCallsPerHour,
  });
  if (row === null) {
    failWith(429, "ai-hourly-limit", 600);
  }
  if (
    budget.dailyTokens !== undefined &&
    (await usedToday(deps, usage, row.id, now)) >= budget.dailyTokens
  ) {
    await usage.release(row.id);
    const midnight = new Date(`${utcDay(now)}T00:00:00.000Z`).getTime() + 86_400_000;
    failWith(429, "ai-daily-budget", Math.max(1, Math.ceil((midnight - now.getTime()) / 1000)));
  }
  return row.id;
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

/**
 * Record one call's usage and fire `sys:ai-budget` for each newly crossed threshold. The insight's
 * reserved row is filled in when it has one; otherwise a row is added.
 */
export async function recordUsage(deps: InsightDeps, input: AiUsageInput): Promise<void> {
  const { dailyTokens, visionWeight } = deps.ai.budget();
  const now = new Date();
  const before = dailyTokens === undefined ? 0 : await dayTokens(deps, now);
  const usage = new AiUsageModel(deps.db);
  const filled = input.insightId !== null && (await usage.complete(input.insightId, input));
  if (!filled) {
    await usage.record(input);
  }
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
