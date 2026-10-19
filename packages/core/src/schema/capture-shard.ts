/** What a row of `capture_shards` is: a stage of a sharded capture, or the claim that finalizes it. */
export type CaptureShardKind = "plan" | "render" | "finalize";

/** Lifecycle of one shard row. */
export type CaptureShardStatus = "pending" | "running" | "done" | "failed";

/**
 * One row per stage of a sharded capture: the `plan` (ordinal 0) records the build-level plan, each
 * `render` shard (ordinal 1..n) is a slice of stories, and a `finalize` row (ordinal 0) is the
 * claim that makes exactly one worker finish the build. `(buildId, kind, ordinal)` is unique, so
 * inserting a row is an atomic claim on every database.
 */
export interface CaptureShard {
  id: string;
  projectId: string;
  buildId: string;
  kind: CaptureShardKind;
  ordinal: number;
  status: CaptureShardStatus;
  /** Attempt row the build's log history and result belong to (plan row only). */
  attemptId: string | null;
  /** JSON: the stories and engines of a render shard, or the plan's settings. */
  payload: string | null;
  /** JSON outcome once the stage ended (failed, flaky and a11y story ids, counts, duration). */
  result: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
