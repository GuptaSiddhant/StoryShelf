/**
 * A run in flight when `builds.capture_job_id` was added owns the build it was started for. Run by
 * every SQLite migration after the columns exist and, unlike the `IDENTITY_STATEMENTS` of `ddl.ts`,
 * never ignored: a failure leaves in-flight builds unowned, so setup must stop. Internal: it is not
 * part of the published `@storyshelf/db-sqlite/ddl` surface.
 *
 * A build gets the newest unfinished, non-cancelled capture job of its own only when exactly one
 * job has that newest `created_at`; on a tie it stays unowned, because ULIDs made in one
 * millisecond do not keep creation order.
 */
export const CAPTURE_JOB_BACKFILL =
  "UPDATE builds SET capture_job_id = (SELECT j.job_id FROM capture_jobs j WHERE j.entry = 'job' AND j.kind = 'capture' AND j.shard_id IS NULL AND j.cancel_requested_at IS NULL AND j.status IN ('queued', 'running') AND j.build_id = builds.id ORDER BY j.created_at DESC LIMIT 1) WHERE capture_job_id IS NULL AND status IN ('pending', 'capturing') AND (SELECT COUNT(*) FROM capture_jobs j WHERE j.entry = 'job' AND j.kind = 'capture' AND j.shard_id IS NULL AND j.cancel_requested_at IS NULL AND j.status IN ('queued', 'running') AND j.build_id = builds.id AND j.created_at = (SELECT MAX(k.created_at) FROM capture_jobs k WHERE k.entry = 'job' AND k.kind = 'capture' AND k.shard_id IS NULL AND k.cancel_requested_at IS NULL AND k.status IN ('queued', 'running') AND k.build_id = builds.id)) <= 1";
