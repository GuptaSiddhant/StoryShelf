/**
 * The capture tables, as neutral tables: the database queue (`capture_jobs`), and each build's
 * capture attempts, their log lines and the stages of a sharded capture.
 */
import type { JobStatus } from "../../adapters/capture-queue.ts";
import type {
  CaptureAttemptStatus,
  CaptureJobEntry,
  CaptureJobKind,
  CaptureJobStatus,
} from "../../schema/capture-job.ts";
import type { CaptureShardKind, CaptureShardStatus } from "../../schema/capture-shard.ts";
import { id, int, key, text, timestamp, type NeutralColumn } from "../columns.ts";
import { defineTable, index, uniqueIndex } from "../define-table.ts";

/**
 * The queue's job rows and per-attempt claim rows (ADR 0040). No foreign keys: notify jobs may have
 * no build, and retention purges finished rows.
 */
export const captureJobs = defineTable(
  "capture_jobs",
  {
    id: id("id").primaryKey(),
    entry: key("entry", 64).$type<CaptureJobEntry>().notNull(),
    jobId: id("job_id").notNull(),
    kind: key("kind", 32).$type<CaptureJobKind>().notNull(),
    buildId: id("build_id"),
    shardId: id("shard_id"),
    attempt: int("attempt").notNull().default(0),
    maxAttempts: int("max_attempts").notNull().default(3),
    status: key("status", 32).$type<CaptureJobStatus | CaptureAttemptStatus>().notNull(),
    visibleAt: timestamp("visible_at"),
    owner: text("owner"),
    payload: text("payload"),
    cancelRequestedAt: timestamp("cancel_requested_at"),
    /** Single-flight kinds: at most one non-terminal job per key; NULLs never collide. */
    activeKey: key("active_key", 191),
    rerunRequestedAt: timestamp("rerun_requested_at"),
    error: text("error"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  {
    indexes: [
      index("capture_jobs_poll_idx", ["kind", "visibleAt", "status"]),
      index("capture_jobs_job_id_idx", ["jobId"]),
      index("capture_jobs_build_id_idx", ["buildId"]),
      index("capture_jobs_entry_created_idx", ["entry", "createdAt"]),
      uniqueIndex("capture_jobs_active_key_idx", ["activeKey"]),
    ],
  },
);

const projectId = (): NeutralColumn<string, true> =>
  id("project_id").notNull().references("projects", "id", "cascade");
const buildId = (): NeutralColumn<string, true> =>
  id("build_id").notNull().references("builds", "id", "cascade");

/** One row per capture run of a build. */
export const captureAttempts = defineTable(
  "capture_attempts",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    buildId: buildId(),
    attemptNo: int("attempt_no").notNull(),
    status: key("status", 32).$type<JobStatus>().notNull().default("queued"),
    error: text("error"),
    reqId: text("req_id"),
    storyCount: int("story_count").notNull().default(0),
    failedCount: int("failed_count").notNull().default(0),
    queuedAt: timestamp("queued_at").notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  {
    indexes: [
      uniqueIndex("capture_attempts_build_no_idx", ["buildId", "attemptNo"]),
      index("capture_attempts_build_id_idx", ["buildId"]),
    ],
  },
);

/** Every log line of a capture attempt. */
export const captureLogs = defineTable(
  "capture_logs",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    buildId: buildId(),
    attemptId: id("attempt_id").notNull().references("capture_attempts", "id", "cascade"),
    seq: int("seq").notNull(),
    level: key("level", 16).notNull().default("info"),
    message: text("message").notNull(),
    fields: text("fields"),
    createdAt: timestamp("created_at").notNull(),
  },
  { indexes: [index("capture_logs_attempt_seq_idx", ["attemptId", "seq"])] },
);

/** The stages of a sharded capture and its finalize claim. */
export const captureShards = defineTable(
  "capture_shards",
  {
    id: id("id").primaryKey(),
    projectId: projectId(),
    buildId: buildId(),
    kind: key("kind", 32).$type<CaptureShardKind>().notNull(),
    ordinal: int("ordinal").notNull(),
    status: key("status", 32).$type<CaptureShardStatus>().notNull().default("pending"),
    attemptId: id("attempt_id"),
    payload: text("payload"),
    result: text("result"),
    error: text("error"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  {
    indexes: [
      uniqueIndex("capture_shards_build_kind_ordinal_idx", ["buildId", "kind", "ordinal"]),
      index("capture_shards_build_id_idx", ["buildId"]),
    ],
  },
);
