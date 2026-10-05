import type { JobStatus } from "@storyshelf/core/adapter/capture-queue";
import { index, int, mysqlTable, text, datetime, uniqueIndex } from "drizzle-orm/mysql-core";
import { builds } from "./build.ts";
import { projects } from "./project.ts";

/** Narrow `capture_attempts` table definition: one row per build capture run. */
export const captureAttempts = mysqlTable(
  "capture_attempts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    attemptNo: int("attempt_no").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    error: text("error"),
    reqId: text("req_id"),
    storyCount: int("story_count").notNull().default(0),
    failedCount: int("failed_count").notNull().default(0),
    queuedAt: datetime("queued_at", { mode: "string", fsp: 3 }).notNull(),
    startedAt: datetime("started_at", { mode: "string", fsp: 3 }),
    finishedAt: datetime("finished_at", { mode: "string", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (t) => [
    uniqueIndex("capture_attempts_build_no_idx").on(t.buildId, t.attemptNo),
    index("capture_attempts_build_id_idx").on(t.buildId),
  ],
);

/** Narrow `capture_logs` table definition: every log line of an attempt. */
export const captureLogs = mysqlTable(
  "capture_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => captureAttempts.id, { onDelete: "cascade" }),
    seq: int("seq").notNull(),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    fields: text("fields"),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (t) => [index("capture_logs_attempt_seq_idx").on(t.attemptId, t.seq)],
);

/** A capture attempt row. */
export interface CaptureAttempt {
  id: string;
  projectId: string;
  buildId: string;
  attemptNo: number;
  status: JobStatus;
  error: string | null;
  reqId: string | null;
  storyCount: number;
  failedCount: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A capture log line row. */
export interface CaptureLog {
  id: string;
  projectId: string;
  buildId: string;
  attemptId: string;
  seq: number;
  level: string;
  message: string;
  fields: string | null;
  createdAt: string;
}
