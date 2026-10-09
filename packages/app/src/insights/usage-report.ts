/** Aggregates for the site-admin AI usage page (counted tokens per day and profile). */
import { countedTokens, utcDay } from "@storyshelf/core/insights";
import { AiUsageModel } from "@storyshelf/core/models";
import type { AiUsageRow } from "@storyshelf/core/schema";
import type { InsightDeps } from "./deps.ts";

/** One day's totals. */
export interface UsageDay {
  day: string;
  tokens: number;
  calls: number;
  failed: number;
}

/** One profile's totals over the window. */
export interface UsageProfile {
  profile: string;
  tokens: number;
  calls: number;
}

/** What the admin page shows. */
export interface UsageReport {
  days: UsageDay[];
  profiles: UsageProfile[];
  todayTokens: number;
  dailyTokens: number | null;
}

const DAY_MS = 86_400_000;

function addTo<K extends string, V extends { tokens: number; calls: number }>(
  map: Map<string, V>,
  key: K,
  make: (key: K) => V,
  tokens: number,
  failed: boolean,
): void {
  const current = map.get(key) ?? make(key);
  const next = { ...current, tokens: current.tokens + tokens, calls: current.calls + 1 };
  map.set(key, "failed" in next ? { ...next, failed: Number(next.failed) + Number(failed) } : next);
}

function aggregate(
  rows: AiUsageRow[],
  visionWeight: number,
): { days: UsageDay[]; profiles: UsageProfile[] } {
  const days = new Map<string, UsageDay>();
  const profiles = new Map<string, UsageProfile>();
  for (const row of rows) {
    const tokens = countedTokens(row, row.images, { visionWeight });
    const failed = row.status === "failed";
    addTo(
      days,
      row.createdAt.slice(0, 10),
      (day) => ({ day, tokens: 0, calls: 0, failed: 0 }),
      tokens,
      failed,
    );
    addTo(profiles, row.profile, (profile) => ({ profile, tokens: 0, calls: 0 }), tokens, failed);
  }
  return {
    days: [...days.values()].toSorted((a, b) => b.day.localeCompare(a.day)),
    profiles: [...profiles.values()].toSorted((a, b) => b.tokens - a.tokens),
  };
}

/** Summarize the last `windowDays` of usage (UTC days, newest first). */
export async function buildUsageReport(
  deps: InsightDeps,
  windowDays = 14,
  now = new Date(),
): Promise<UsageReport> {
  const since = new Date(now.getTime() - windowDays * DAY_MS).toISOString();
  const rows = await new AiUsageModel(deps.db).listSince(since);
  const { visionWeight, dailyTokens } = deps.ai.budget();
  const { days, profiles } = aggregate(rows, visionWeight);
  return {
    days,
    profiles,
    todayTokens: days.find((d) => d.day === utcDay(now))?.tokens ?? 0,
    dailyTokens: dailyTokens ?? null,
  };
}
