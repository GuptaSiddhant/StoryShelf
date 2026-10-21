/** Enqueue, cancel and the cross-instance views (`status`/`active`/`recent`) of the database queue. */
import type { CaptureJob, QueueEntry } from "../../adapters/capture-queue.ts";
import { attemptRowId, isTerminalJob } from "../../models/capture-job.ts";
import type { CaptureJobRow } from "../../schema/capture-job.ts";
import { ulid } from "../../utils/ulid.ts";
import { isoAt } from "./clock.ts";
import { encodePayload, toQueueEntry } from "./codec.ts";
import type { QueueJobInput, QueueRuntime } from "./types.ts";

/** Insert a queued job row and wake this instance's poller; resolves to the job id. */
export async function enqueueJob(rt: QueueRuntime, job: QueueJobInput): Promise<string> {
  const id = ulid();
  const now = isoAt(rt);
  await rt.model.create(
    {
      id,
      kind: job.kind,
      buildId: job.buildId ?? null,
      shardId: job.shard ?? null,
      maxAttempts: rt.maxAttempts,
      payload: encodePayload(job),
    },
    now,
  );
  rt.logger?.info({ jobId: id, kind: job.kind, buildId: job.buildId }, "job queued");
  rt.wake.notify();
  return id;
}

/** `CaptureQueue.enqueue`: a capture job for a build or one of its shards. */
export async function enqueueCapture(rt: QueueRuntime, job: CaptureJob): Promise<void> {
  await enqueueJob(rt, { ...job, kind: "capture" });
}

/** The build's own job most recently queued, as a queue entry. */
export async function statusOf(rt: QueueRuntime, buildId: string): Promise<QueueEntry | null> {
  const row = await rt.model.latestForBuild(buildId, rt.kinds);
  return row === null ? null : toQueueEntry(row);
}

/** Queued and running jobs of this queue's kinds on every instance, oldest first. */
export async function activeEntries(rt: QueueRuntime): Promise<QueueEntry[]> {
  return (await rt.model.listActive(rt.kinds)).map((row) => toQueueEntry(row));
}

/** The newest jobs of this queue's kinds, newest first. */
export async function recentEntries(rt: QueueRuntime, limit: number): Promise<QueueEntry[]> {
  return (await rt.model.listRecent(rt.kinds, limit)).map((row) => toQueueEntry(row));
}

/**
 * Cancel a job (by job id, any kind) or every unfinished job of this queue's kinds for a build (by
 * build id). A queued job ends `cancelled` at once; a running one is flagged on its job row and on
 * its current attempt row, so the holder sees it on its next renewal or cancel check.
 */
export async function cancelJobs(rt: QueueRuntime, id: string): Promise<boolean> {
  const targets = (await targetsOf(rt, id)).filter((row) => !isTerminalJob(row));
  await Promise.all(
    targets.map(async (row) => {
      await cancelOne(rt, row);
    }),
  );
  if (targets.length > 0) {
    rt.logger?.info({ id, jobs: targets.length }, "cancel requested");
  }
  return targets.length > 0;
}

async function targetsOf(rt: QueueRuntime, id: string): Promise<CaptureJobRow[]> {
  const row = await rt.model.get(id);
  if (row?.entry === "job") {
    return [row];
  }
  return (await rt.model.listForBuild(id)).filter((job) => rt.kinds.includes(job.kind));
}

async function cancelOne(rt: QueueRuntime, row: CaptureJobRow): Promise<void> {
  const now = isoAt(rt);
  // The flag goes first: it is never cleared, so a claim racing this cancel still sees it.
  await rt.model.flagCancel(row.jobId, now);
  if (row.status === "queued") {
    await rt.model.finishJob(row.jobId, "cancelled", now);
    // A claimer may have inserted the next attempt between our read and the write above.
    await flagAttempt(rt, attemptRowId(row.jobId, row.attempt + 1), now);
    return;
  }
  await flagAttempt(rt, attemptRowId(row.jobId, row.attempt), now);
}

async function flagAttempt(rt: QueueRuntime, attemptId: string, now: string): Promise<void> {
  const attempt = await rt.model.get(attemptId);
  if (attempt?.status === "running") {
    await rt.model.flagCancel(attemptId, now);
  }
}
