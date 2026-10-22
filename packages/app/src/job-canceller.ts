/**
 * Cancelling a build's background jobs (ADR 0006): every job kind of the build shares the
 * `capture_jobs` table, so one cancel by build id on the database queue covers capture, publish and
 * notify jobs; a supplied `testing.queue` is a second transport and is asked too.
 */
import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";

/** Cancels the unfinished jobs of a build; resolves true when any job was affected. */
export type JobCanceller = (buildId: string) => Promise<boolean>;

/** Ask each queue that can cancel to cancel the build's jobs; a queue without `cancel` is skipped. */
export function createJobCanceller(
  queues: readonly (CaptureQueue | null | undefined)[],
): JobCanceller {
  return async (buildId) => {
    const outcomes = await Promise.all(
      queues.map(async (queue) => (await queue?.cancel?.(buildId)) ?? false),
    );
    return outcomes.some(Boolean);
  };
}
