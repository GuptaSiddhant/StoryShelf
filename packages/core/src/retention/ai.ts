/** Retention for AI data: old insight rows, old usage rows and interrupted runs. */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Logger } from "../logger.ts";
import { AiUsageModel } from "../models/ai-usage.ts";
import { InsightModel } from "../models/insight.ts";

/** Insight rows (every kind) older than this are deleted unless the config says otherwise. */
export const INSIGHT_RETENTION_DAYS = 180;

/** Usage rows older than this are deleted: it must cover the longest per-project limit window. */
export const USAGE_RETENTION_DAYS = 400;

/** Per-table retention windows in days; `null` keeps the table's rows forever. */
export interface AiRetention {
  insightDays?: number | null;
  usageDays?: number | null;
}

/** Pending/running rows older than this are marked `interrupted`. */
export const STALE_RUN_MS = 30 * 60_000;

/** What one AI retention pass removed. */
export interface AiPurgeResult {
  health: number;
  usage: number;
  interrupted: number;
}

/** Run one AI retention pass (safe to call from any instance, any time). */
export async function purgeAiData(
  db: DatabaseAdapter,
  now: Date = new Date(),
  logger?: Logger,
  retention: AiRetention = {},
): Promise<AiPurgeResult> {
  const insights = new InsightModel(db);
  const before = (days: number | null | undefined, fallback: number): string | null => {
    const window = days === undefined ? fallback : days;
    return window === null ? null : new Date(now.getTime() - window * 86_400_000).toISOString();
  };
  const insightCut = before(retention.insightDays, INSIGHT_RETENTION_DAYS);
  const usageCut = before(retention.usageDays, USAGE_RETENTION_DAYS);
  const result: AiPurgeResult = {
    health: insightCut === null ? 0 : await insights.purgeBefore(insightCut),
    usage: usageCut === null ? 0 : await new AiUsageModel(db).purgeBefore(usageCut),
    interrupted: await insights.sweepStale(new Date(now.getTime() - STALE_RUN_MS).toISOString()),
  };
  if (result.health > 0 || result.usage > 0 || result.interrupted > 0) {
    logger?.info(result, "ai data retention pass complete");
  }
  return result;
}
