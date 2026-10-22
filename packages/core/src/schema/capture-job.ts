/**
 * Row types of `capture_jobs`, the database queue (ADR 0006, decision 4).
 *
 * One table holds two kinds of row, told apart by `entry`:
 *
 * - a **job** row (`id` = job id, `jobId` = its own id) carries delivery state: `status` is
 *   `queued | running | done | failed | cancelled`, `attempt` counts the attempts started so far,
 *   and `visibleAt` is when a queued job may next be claimed;
 * - an **attempt** row (`id` = `<jobId>:<attempt>`) is one claim of a job, created by a unique-key
 *   insert. It holds the `owner`, the lease expiry (in `visibleAt`) and, once over, its outcome:
 *   `status` is `running | done | failed | expired`.
 *
 * `visibleAt` is non-null only while a row is a poll candidate (a queued job row, a running attempt
 * row), so the poll is one indexed range query that reads at most one row.
 */

/** Which of the two row kinds of `capture_jobs` a row is. */
export type CaptureJobEntry = "job" | "attempt";

/** What a job does: render a build or shard, publish a zip, or deliver a notification. */
export type CaptureJobKind = "capture" | "publish" | "notify";

/** Lifecycle of a job row. */
export type CaptureJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** Lifecycle of an attempt row; `expired` is a lease another instance took over. */
export type CaptureAttemptStatus = "running" | "done" | "failed" | "expired";

/** One row of `capture_jobs`: a job, or one attempt at it. */
export interface CaptureJobRow {
  id: string;
  entry: CaptureJobEntry;
  /** The job this row belongs to (a job row's own id). */
  jobId: string;
  kind: CaptureJobKind;
  /** Build the job works on; notify jobs may have none. */
  buildId: string | null;
  /** `capture_shards` row a shard job renders; null for the build's own job. */
  shardId: string | null;
  /** Job row: attempts started so far. Attempt row: its number, from 1. */
  attempt: number;
  /** Attempts allowed in total (`testing.retries` + 1); copied onto attempt rows. */
  maxAttempts: number;
  status: CaptureJobStatus | CaptureAttemptStatus;
  /** Queued job: when it may be claimed. Running attempt: its lease expiry. Otherwise null. */
  visibleAt: string | null;
  /** Instance holding an attempt; null on job rows. */
  owner: string | null;
  /** JSON: request id, traceparent and kind-specific fields. */
  payload: string | null;
  /** Set once cancel was asked for; the holder turns it into `runner.cancel`. */
  cancelRequestedAt: string | null;
  /** Job row: the last attempt's error. Attempt row: its own. */
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
