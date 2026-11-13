/** Enqueue, cancel and the cross-instance views (`status`/`active`/`recent`) of the database queue. */
import type { CaptureJob, QueueEntry } from "../../adapters/capture-queue.ts";
import { attemptRowId, isTerminalJob } from "../../models/capture-job.ts";
import type { CaptureJobKind, CaptureJobRow } from "../../schema/capture-job.ts";
import { ulid } from "../../utils/ulid.ts";
import { isoAt } from "./clock.ts";
import { encodePayload, GENERATION_KEY, toQueueEntry } from "./codec.ts";
import { enqueueKeyed } from "./single-flight.ts";
import type { QueueJobInput, QueueRuntime } from "./types.ts";

/**
 * Insert a queued job row and wake this instance's poller; resolves to the job id. A job with an
 * `activeKey` goes through {@link enqueueKeyed}: it may be coalesced into the job that holds the key.
 */
export async function enqueueJob(rt: QueueRuntime, job: QueueJobInput): Promise<string> {
  if (job.activeKey !== undefined) {
    return await enqueueKeyed(rt, { ...job, activeKey: job.activeKey });
  }
  const id = job.id ?? ulid();
  const now = isoAt(rt);
  await rt.model.create(
    {
      id,
      kind: job.kind,
      buildId: job.buildId ?? null,
      shardId: job.shard ?? null,
      maxAttempts: job.maxAttempts ?? rt.maxAttempts,
      payload: encodePayload(job),
    },
    now,
  );
  rt.logger?.info({ jobId: id, kind: job.kind, buildId: job.buildId }, "job queued");
  rt.wake.notify();
  return id;
}

/** Kinds of many short delivery jobs, and the build-less reclaim job, which the queue's views leave out. */
const DELIVERY_KINDS: ReadonlySet<CaptureJobKind> = new Set([
  "notify",
  "review-request",
  "statics-reclaim",
]);

/**
 * The kinds the queue's views (`status`, `active`, `recent`, `cancel`) show: every polled kind but
 * the delivery kinds (`notify`, `review-request`; unless they are all it polls), whose many short
 * jobs would bury a build's capture and publish jobs.
 */
function viewKinds(rt: QueueRuntime): readonly CaptureJobKind[] {
  const shown = rt.kinds.filter((kind) => !DELIVERY_KINDS.has(kind));
  return shown.length > 0 ? shown : rt.kinds;
}

/**
 * `CaptureQueue.enqueue`: a capture job for a build or one of its shards. A build's own run claims
 * the build first, in one conditional write that records the job as its owner and advances the run
 * generation from the one read, and only then inserts the job, with that generation in its payload.
 * Of two enqueues that read the same generation one claims and the other inserts nothing, and an
 * enqueue overtaken by a retry cannot take the build back. The worker checks the payload's
 * generation against the build before it runs ({@link GENERATION_KEY}).
 */
export async function enqueueCapture(rt: QueueRuntime, job: CaptureJob): Promise<void> {
  if (job.shard !== undefined) {
    await enqueueJob(rt, { ...job, kind: "capture" });
    return;
  }
  const id = ulid();
  const claim = await claimBuild(rt, job.buildId, id);
  if (claim !== "superseded") {
    // A cancelled or missing build is left alone: its job is queued without a generation to check.
    const data = claim === null ? {} : { data: { [GENERATION_KEY]: claim } };
    await enqueueJob(rt, { ...job, id, kind: "capture", ...data });
  }
}

/**
 * Claim the build for job `id`: the generation the job runs at, null for a build left alone
 * (cancelled or missing), or `superseded` when a retry or another enqueue claimed it since it was read.
 */
async function claimBuild(
  rt: QueueRuntime,
  buildId: string,
  id: string,
): Promise<number | null | "superseded"> {
  const generation = (await rt.builds.get(buildId))?.captureGeneration ?? 0;
  const claim = await rt.builds.stampCaptureJob(buildId, id, generation);
  if (claim.result === "stale") {
    rt.logger?.warn({ buildId, generation }, "capture job superseded; not queued");
    return "superseded";
  }
  return claim.result === "stamped" ? claim.generation : null;
}

/** The build's own job most recently queued, as a queue entry. */
export async function statusOf(rt: QueueRuntime, buildId: string): Promise<QueueEntry | null> {
  const row = await rt.model.latestForBuild(buildId, viewKinds(rt));
  return row === null ? null : toQueueEntry(row);
}

/** Queued and running jobs of this queue's kinds on every instance, oldest first. */
export async function activeEntries(rt: QueueRuntime): Promise<QueueEntry[]> {
  return (await rt.model.listActive(viewKinds(rt))).map((row) => toQueueEntry(row));
}

/** The newest jobs of this queue's kinds, newest first. */
export async function recentEntries(rt: QueueRuntime, limit: number): Promise<QueueEntry[]> {
  return (await rt.model.listRecent(viewKinds(rt), limit)).map((row) => toQueueEntry(row));
}

/**
 * Cancel a job (by job id) or every unfinished job of a build (by build id), of every kind that
 * shares the table (capture, publish and notify), whichever kinds this queue polls. A queued job ends `cancelled` at once; a running one is flagged on its job row and on
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
  return await rt.model.listForBuild(id);
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
