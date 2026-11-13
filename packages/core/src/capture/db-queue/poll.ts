/** `poll` / `ack` / `nack` of the database queue: claim, finish and retry-with-backoff of attempts. */
import type { PollableJob } from "../../adapters/capture-queue.ts";
import { isTerminalJob, parseAttemptRowId } from "../../models/capture-job.ts";
import type { CaptureJobRow } from "../../schema/capture-job.ts";
import { claimNext } from "./claim.ts";
import { isoAt } from "./clock.ts";
import { finishJob } from "./single-flight.ts";
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
  const row = await rt.model.get(ref.jobId);
  if (row !== null && row.status !== "cancelled") {
    // The attempt ends with the job, in one commit: a failed end keeps the lease, so it is redelivered.
    await finishJob(rt, row, "done", null, { id: ref.receipt });
    return;
  }
  await rt.model.finishAttempt(ref.receipt, "done", isoAt(rt));
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
  const row = await rt.model.get(ref.jobId);
  const current = isCurrent(row, ref.attempt) ? row : null;
  if (current !== null && endsForGood(current, options)) {
    await failForGood(rt, current, ref.receipt, options);
    return;
  }
  await rt.model.finishAttempt(ref.receipt, "failed", isoAt(rt), options.error ?? null);
  if (current !== null) await settleFailure(rt, current, options);
}

/**
 * The holder hands the job back (shutdown): the job is queued again at once and the attempt is not
 * spent ({@link CaptureJobModel.release}). Like `nack`, only the current holder acts: a holder whose
 * attempt is no longer `running`, or whose job moved on, ended, or was asked to cancel, writes nothing.
 */
export async function releaseJob(rt: QueueRuntime, job: PollableJob): Promise<void> {
  const ref = attemptRef(job);
  if ((await rt.model.get(ref.receipt))?.status !== "running") {
    return;
  }
  const row = await rt.model.get(ref.jobId);
  if (!isCurrent(row, ref.attempt) || row.status !== "running" || row.cancelRequestedAt !== null) {
    return;
  }
  if (await rt.model.release(row, ref.attempt, isoAt(rt))) {
    rt.logger?.info({ jobId: ref.jobId, attempt: ref.attempt }, "job released");
    rt.wake.notify();
  }
}

/** Whether `row` is open and still on `attempt`. */
function isCurrent(row: CaptureJobRow | null, attempt: number): row is CaptureJobRow {
  return row !== null && !isTerminalJob(row) && row.attempt === attempt;
}

/** The job fails for good: its attempt ends in the same commit, so a failed end keeps the lease. */
async function failForGood(
  rt: QueueRuntime,
  row: CaptureJobRow,
  receipt: string,
  options: NackOptions,
): Promise<void> {
  await finishJob(rt, row, "failed", options.error ?? "failed", {
    id: receipt,
    error: options.error ?? null,
  });
}

/** Whether a nack ends the job as `failed` (no cancel asked, and no retry left or wanted). */
function endsForGood(row: CaptureJobRow, options: NackOptions): boolean {
  return (
    row.cancelRequestedAt === null && (options.requeue === false || row.attempt >= row.maxAttempts)
  );
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
    await finishJob(rt, row, "failed", error ?? "failed");
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
