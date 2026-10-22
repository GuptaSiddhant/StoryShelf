import type {
  CaptureAttemptStatus,
  CaptureJobEntry,
  CaptureJobKind,
  CaptureJobStatus,
} from "@storyshelf/core/schema";
import { datetime, index, int, mysqlTable, text } from "drizzle-orm/mysql-core";

/**
 * Narrow `capture_jobs` table definition: the database queue's job rows and per-attempt claim rows.
 * No foreign keys: notify jobs may have no build, and finished rows are purged by retention.
 */
export const captureJobs = mysqlTable(
  "capture_jobs",
  {
    id: text("id").primaryKey(),
    entry: text("entry").$type<CaptureJobEntry>().notNull(),
    jobId: text("job_id").notNull(),
    kind: text("kind").$type<CaptureJobKind>().notNull(),
    buildId: text("build_id"),
    shardId: text("shard_id"),
    attempt: int("attempt").notNull().default(0),
    maxAttempts: int("max_attempts").notNull().default(3),
    status: text("status").$type<CaptureJobStatus | CaptureAttemptStatus>().notNull(),
    visibleAt: datetime("visible_at", { mode: "string", fsp: 3 }),
    owner: text("owner"),
    payload: text("payload"),
    cancelRequestedAt: datetime("cancel_requested_at", { mode: "string", fsp: 3 }),
    error: text("error"),
    startedAt: datetime("started_at", { mode: "string", fsp: 3 }),
    finishedAt: datetime("finished_at", { mode: "string", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
  },
  (table) => [
    index("capture_jobs_poll_idx").on(table.kind, table.visibleAt, table.status),
    index("capture_jobs_job_id_idx").on(table.jobId),
    index("capture_jobs_build_id_idx").on(table.buildId),
    index("capture_jobs_entry_created_idx").on(table.entry, table.createdAt),
  ],
);
