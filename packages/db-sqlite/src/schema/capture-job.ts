import type {
  CaptureAttemptStatus,
  CaptureJobEntry,
  CaptureJobKind,
  CaptureJobStatus,
} from "@storyshelf/core/schema";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Narrow `capture_jobs` table definition: the database queue's job rows and per-attempt claim rows.
 * No foreign keys: notify jobs may have no build, and finished rows are purged by retention.
 */
export const captureJobs = sqliteTable(
  "capture_jobs",
  {
    id: text("id").primaryKey(),
    entry: text("entry").$type<CaptureJobEntry>().notNull(),
    jobId: text("job_id").notNull(),
    kind: text("kind").$type<CaptureJobKind>().notNull(),
    buildId: text("build_id"),
    shardId: text("shard_id"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    status: text("status").$type<CaptureJobStatus | CaptureAttemptStatus>().notNull(),
    visibleAt: text("visible_at"),
    owner: text("owner"),
    payload: text("payload"),
    cancelRequestedAt: text("cancel_requested_at"),
    error: text("error"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("capture_jobs_poll_idx").on(table.kind, table.visibleAt, table.status),
    index("capture_jobs_job_id_idx").on(table.jobId),
    index("capture_jobs_build_id_idx").on(table.buildId),
    index("capture_jobs_entry_created_idx").on(table.entry, table.createdAt),
  ],
);
