/** Insight kinds: a build triage or a project-health digest. */
export type InsightKind = "triage" | "health";

/** Lifecycle of an insight run. */
export type InsightStatus = "pending" | "running" | "done" | "failed";

/** An insight row (result is an opaque, validated JSON string). */
export interface InsightRow {
  id: string;
  projectId: string;
  /** Null for project-health rows. */
  buildId: string | null;
  kind: InsightKind;
  /** Health window key (e.g. `30d`); null for triage rows. */
  windowKey: string | null;
  inputHash: string;
  status: InsightStatus;
  profile: string;
  model: string;
  promptVersion: string;
  verdict: string | null;
  summary: string | null;
  result: string | null;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** One provider call's usage; survives build purge so budgets stay accurate. */
export interface AiUsageRow {
  id: string;
  insightId: string | null;
  projectId: string;
  profile: string;
  task: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  images: number;
  status: "ok" | "failed";
  createdAt: string;
}

/** A budget-threshold alert claim (`id` is `${day}:${threshold}`). */
export interface AiBudgetAlertRow {
  id: string;
  day: string;
  threshold: number;
  createdAt: string;
}
