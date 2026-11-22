import type { JobStatus } from "@storyshelf/core/adapter/capture-queue";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { builds } from "./build.ts";
import { projects } from "./project.ts";

/** Narrow `capture_attempts` table definition: one row per build capture run. */
export const captureAttempts = sqliteTable(
  "capture_attempts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    buildId: text("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    attemptNo: integer("attempt_no").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    error: text("error"),
    reqId: text("req_id"),
    storyCount: integer("story_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    queuedAt: text("queued_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("capture_attempts_build_no_idx").on(t.buildId, t.attemptNo),
    index("capture_attempts_build_id_idx").on(t.buildId),
  ],
);

/** Narrow `capture_logs` table definition: every log line of an attempt. */
export const captureLogs = sqliteTable(
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
    seq: integer("seq").notNull(),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    fields: text("fields"),
    createdAt: text("created_at").notNull(),
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
