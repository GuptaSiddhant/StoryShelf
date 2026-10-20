/** Progress reporting for a running capture job, kept apart from its logging. */
import type { JobLease } from "./job-lease.ts";

/**
 * Called by a capture as it moves: a screenshot taken, a snapshot persisted, a stage done. Cheap
 * and synchronous, so the hot loops of render and persist can call it on every item.
 */
export type CaptureProgress = () => void;

/** Shortest gap between two lease touches: a forked child sends one IPC message per touch. */
export const PROGRESS_THROTTLE_MS = 1000;

/**
 * The progress callback for a job: touches its lease, at most once per `everyMs`. The first call
 * always goes through. Undefined without a lease, so callers skip the work entirely.
 *
 * Liveness comes from the job reporting work done rather than from a timer, so a hung render or
 * diff still lets the lease expire (see {@link JobLease}).
 */
export function leaseProgress(
  lease?: JobLease,
  everyMs: number = PROGRESS_THROTTLE_MS,
  now: () => number = Date.now,
): CaptureProgress | undefined {
  if (!lease) {
    return undefined;
  }
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    if (at - last >= everyMs) {
      last = at;
      lease.touch();
    }
  };
}
