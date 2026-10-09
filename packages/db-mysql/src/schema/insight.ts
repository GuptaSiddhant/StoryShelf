import { boolean, datetime, int, mysqlTable, text } from "drizzle-orm/mysql-core";
import { builds } from "./build.ts";
import { projects } from "./project.ts";

/** Narrow `insights` table definition (build triage and project health results). */
export const insights = mysqlTable("insights", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  buildId: text("build_id").references(() => builds.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  windowKey: text("window_key"),
  inputHash: text("input_hash").notNull(),
  status: text("status").notNull(),
  profile: text("profile").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  verdict: text("verdict"),
  summary: text("summary"),
  result: text("result"),
  errorCode: text("error_code"),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
  startedAt: datetime("started_at", { mode: "string", fsp: 3 }),
  finishedAt: datetime("finished_at", { mode: "string", fsp: 3 }),
});

/** Narrow `ai_usage` table definition (provider-reported usage; survives build purge). */
export const aiUsage = mysqlTable("ai_usage", {
  id: text("id").primaryKey(),
  insightId: text("insight_id"),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  profile: text("profile").notNull(),
  task: text("task").notNull(),
  model: text("model").notNull(),
  inputTokens: int("input_tokens").notNull().default(0),
  outputTokens: int("output_tokens").notNull().default(0),
  estimated: boolean("estimated").notNull().default(false),
  images: int("images").notNull().default(0),
  status: text("status").notNull(),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
});

/** Narrow `ai_budget_alerts` table definition (primary key `${day}:${threshold}` is the claim). */
export const aiBudgetAlerts = mysqlTable("ai_budget_alerts", {
  id: text("id").primaryKey(),
  day: text("day").notNull(),
  threshold: int("threshold").notNull(),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
});

/** An insight row. */
export interface Insight {
  id: string;
  projectId: string;
  buildId: string | null;
  kind: string;
  windowKey: string | null;
  inputHash: string;
  status: string;
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

/** An AI usage row. */
export interface AiUsage {
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
  status: string;
  createdAt: string;
}

/** A budget-threshold alert claim row. */
export interface AiBudgetAlert {
  id: string;
  day: string;
  threshold: number;
  createdAt: string;
}
