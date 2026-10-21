/** `poll` / `ack` / `nack` of the database queue: claim, finish and retry-with-backoff of attempts. */
import type { PollableJob } from "../../adapters/capture-queue.ts";
import { isTerminalJob, parseAttemptRowId } from "../../models/capture-job.ts";
import type { CaptureJobRow } from "../../schema/capture-job.ts";
import { claimNext } from "./claim.ts";
import { isoAt } from "./clock.ts";
import type { DatabaseJob, QueueRuntime } from "./types.ts";

/** Longest a nack may delay a retry; larger delays are clamped. */
export const MAX_NACK_DELAY_MS = 60 * 60_000;

/** Options of `nack`, as `PollableCaptureQueue` defines them. */
export interface NackOptions {
  requeue?: boolean;
  delayMs?: number;
  error?: string;
}

/**
 * Claim one job. Probes once; with `waitMs`, an empty probe waits for a local enqueue (or the
 * timeout) and probes once more only when woken, so an idle wait costs a single probe.
 */
export async function pollJob(
  rt: QueueRuntime,
  options?: { waitMs?: number },
): Promise<DatabaseJob | null> {
  const since = rt.wake.version();
  rt.pollVersion = since;
  const job = await claimNext(rt);
  const waitMs = options?.waitMs ?? 0;
  if (job !== null || waitMs <= 0) {
    return job;
  }
  return (await rt.wake.wait(waitMs, since)) ? await claimNext(rt) : null;
}

/** The attempt succeeded: its row and the job row become `done` (a cancelled job stays cancelled). */
export async function ackJob(rt: QueueRuntime, job: PollableJob): Promise<void> {
  const ref = attemptRef(job);
  const now = isoAt(rt);
  await rt.model.finishAttempt(ref.receipt, "done", now);
  if ((await rt.model.get(ref.jobId))?.status !== "cancelled") {
    await rt.model.finishJob(ref.jobId, "done", now);
  }
}

/**
 * The attempt failed. Only the current holder settles the job: a holder whose attempt was taken
 * over (its row is no longer `running`, or the job moved on to a later attempt) writes nothing, so a
 * stale holder can never requeue or fail a job another instance is running.
 */
export async function nackJob(
  rt: QueueRuntime,
  job: PollableJob,
  options: NackOptions = {},
): Promise<void> {
  const ref = attemptRef(job);
  if ((await rt.model.get(ref.receipt))?.status !== "running") {
    return;
  }
  await rt.model.finishAttempt(ref.receipt, "failed", isoAt(rt), options.error ?? null);
  const row = await rt.model.get(ref.jobId);
  if (row === null || isTerminalJob(row) || row.attempt !== ref.attempt) {
    return;
  }
  await settleFailure(rt, row, options);
}

/** Cancelled, final, or retried after `delayMs` (clamped to `[0, MAX_NACK_DELAY_MS]`). */
async function settleFailure(
  rt: QueueRuntime,
  row: CaptureJobRow,
  options: NackOptions,
): Promise<void> {
  const now = isoAt(rt);
  const error = options.error ?? null;
  if (row.cancelRequestedAt !== null) {
    await rt.model.finishJob(row.jobId, "cancelled", now, error);
    return;
  }
  if (options.requeue === false || row.attempt >= row.maxAttempts) {
    await rt.model.finishJob(row.jobId, "failed", now, error ?? "failed");
    return;
  }
  const delayMs = Math.min(Math.max(options.delayMs ?? 0, 0), MAX_NACK_DELAY_MS);
  await rt.model.requeue(row.jobId, isoAt(rt, delayMs), error, now);
}

/** The attempt a polled job refers to, from its receipt (`<jobId>:<attempt>`). */
export function attemptRef(job: PollableJob): { receipt: string; jobId: string; attempt: number } {
  const parsed = job.receipt === undefined ? null : parseAttemptRowId(job.receipt);
  if (parsed === null || job.receipt === undefined) {
    throw new Error("not a database queue job: missing or malformed receipt");
  }
  return { receipt: job.receipt, ...parsed };
}
