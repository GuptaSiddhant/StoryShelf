/**
 * A run in flight when `builds.capture_job_id` was added owns the build it was started for. Run by
 * every SQLite migration after the columns exist and, unlike the `IDENTITY_STATEMENTS` of `ddl.ts`,
 * never ignored: a failure leaves in-flight builds unowned, so setup must stop. Internal: it is not
 * part of the published `@storyshelf/db-sqlite/ddl` surface.
 *
 * A build gets an owner only when exactly one eligible job (unfinished, non-cancelled, not a shard)
 * belongs to it. With several, "newest" cannot be told apart reliably (each instance writes
 * `created_at` from its own clock, and ULIDs made in one millisecond are not ordered), so the build
 * stays unowned and the exhausted-job hook never fails it.
 */
export const CAPTURE_JOB_BACKFILL =
  "UPDATE builds SET capture_job_id = (SELECT j.job_id FROM capture_jobs j WHERE j.entry = 'job' AND j.kind = 'capture' AND j.shard_id IS NULL AND j.cancel_requested_at IS NULL AND j.status IN ('queued', 'running') AND j.build_id = builds.id LIMIT 1) WHERE capture_job_id IS NULL AND status IN ('pending', 'capturing') AND (SELECT COUNT(*) FROM capture_jobs j WHERE j.entry = 'job' AND j.kind = 'capture' AND j.shard_id IS NULL AND j.cancel_requested_at IS NULL AND j.status IN ('queued', 'running') AND j.build_id = builds.id) = 1";
