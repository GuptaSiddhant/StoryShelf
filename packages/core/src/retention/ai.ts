/** Retention for AI data: old health digests, old usage rows and interrupted runs. */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Logger } from "../logger.ts";
import { AiUsageModel } from "../models/ai-usage.ts";
import { InsightModel } from "../models/insight.ts";

/** Health digests older than this are deleted (ADR 0026 §5). */
export const HEALTH_RETENTION_DAYS = 90;

/** Usage rows older than this are deleted (budgets only look at days/hours). */
export const USAGE_RETENTION_DAYS = 90;

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
): Promise<AiPurgeResult> {
  const insights = new InsightModel(db);
  const day = 86_400_000;
  const result: AiPurgeResult = {
    health: await insights.purgeHealthBefore(
      new Date(now.getTime() - HEALTH_RETENTION_DAYS * day).toISOString(),
    ),
    usage: await new AiUsageModel(db).purgeBefore(
      new Date(now.getTime() - USAGE_RETENTION_DAYS * day).toISOString(),
    ),
    interrupted: await insights.sweepStale(new Date(now.getTime() - STALE_RUN_MS).toISOString()),
  };
  if (result.health > 0 || result.usage > 0 || result.interrupted > 0) {
    logger?.info(result, "ai data retention pass complete");
  }
  return result;
}
