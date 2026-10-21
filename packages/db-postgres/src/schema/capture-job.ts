import type {
  CaptureAttemptStatus,
  CaptureJobEntry,
  CaptureJobKind,
  CaptureJobStatus,
} from "@storyshelf/core/schema";
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Narrow `capture_jobs` table definition: the database queue's job rows and per-attempt claim rows.
 * No foreign keys: notify jobs may have no build, and finished rows are purged by retention.
 */
export const captureJobs = pgTable(
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
    visibleAt: timestamp("visible_at", { withTimezone: true, mode: "string" }),
    owner: text("owner"),
    payload: text("payload"),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true, mode: "string" }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("capture_jobs_poll_idx").on(table.kind, table.visibleAt, table.status),
    index("capture_jobs_job_id_idx").on(table.jobId),
    index("capture_jobs_build_id_idx").on(table.buildId),
    index("capture_jobs_entry_created_idx").on(table.entry, table.createdAt),
  ],
);
