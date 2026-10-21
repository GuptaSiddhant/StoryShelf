/**
 * Lease operations of the database queue: `extend` renews the holder's own attempt row (and never
 * any other), `inspect` reads the job row for cancel and supersession without renewing anything.
 */
import type { LeaseRenewal, PollableJob } from "../../adapters/capture-queue.ts";
import { isTerminalJob } from "../../models/capture-job.ts";
import type { CaptureJobRow } from "../../schema/capture-job.ts";
import { isoAt } from "./clock.ts";
import { attemptRef } from "./poll.ts";
import type { QueueRuntime } from "./types.ts";

/**
 * Renew the lease by another `leaseMs`. The write touches only the holder's attempt row and returns
 * it: an attempt retired by another instance reads `expired` (lost), a flagged one `cancelled`.
 * When the attempt is still ours, the job row is read too, so a job finished by another attempt or
 * cancelled is noticed at this progress touch.
 */
export async function extendJob(rt: QueueRuntime, job: PollableJob): Promise<LeaseRenewal> {
  const ref = attemptRef(job);
  const row = await renewOwn(rt, ref.receipt);
  const own = attemptState(row);
  if (row !== null && row.status !== "running") {
    // A late renewal of a retired row put a lease back on it; take the row out of the poll's range.
    await rt.model.clearVisibility(row.id, isoAt(rt));
  }
  return own === "ok" ? await inspectJob(rt, job) : own;
}

/** The job's state for the holder of `job`, without renewing: the periodic cancel check. */
export async function inspectJob(rt: QueueRuntime, job: PollableJob): Promise<LeaseRenewal> {
  const ref = attemptRef(job);
  return jobState(await rt.model.get(ref.jobId), ref.attempt);
}

function attemptState(row: CaptureJobRow | null): LeaseRenewal {
  if (row?.status !== "running") {
    return "lost";
  }
  return row.cancelRequestedAt === null ? "ok" : "cancelled";
}

function jobState(row: CaptureJobRow | null, attempt: number): LeaseRenewal {
  if (row === null) {
    return "lost";
  }
  if (row.status === "cancelled" || (row.cancelRequestedAt !== null && !isTerminalJob(row))) {
    return "cancelled";
  }
  return isTerminalJob(row) || row.attempt !== attempt ? "lost" : "ok";
}

/** Renew an attempt row; a row that no longer exists is lost, any other failure is transient. */
async function renewOwn(rt: QueueRuntime, receipt: string): Promise<CaptureJobRow | null> {
  try {
    return await rt.model.renew(receipt, isoAt(rt, rt.leaseMs), isoAt(rt));
  } catch (error) {
    if ((await rt.model.get(receipt)) === null) {
      return null;
    }
    throw error;
  }
}
