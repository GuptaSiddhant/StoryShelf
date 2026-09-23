/** Server-side queue operations: enqueue plus remote no-ops. */
import type {
  CaptureJob,
  PollableCaptureQueue,
  QueueEntry,
} from "@storyshelf/core/adapter/capture-queue";
import type { QueueRuntime } from "./types.ts";

/** Build `enqueue` plus `status`/`active`/`recent` remote no-ops. */
export function buildCoreMethods(
  rt: QueueRuntime,
): Pick<PollableCaptureQueue, "enqueue" | "status" | "active" | "recent"> {
  return {
    /**
     * Submit a build for capture. Resolves once the message is pushed to Redis.
     *
     * The actual capture execution happens in a separate worker that
     * polls the queue and calls `executeCaptureJob`.
     */
    async enqueue(job: CaptureJob): Promise<void> {
      const payload = JSON.stringify({
        buildId: job.buildId,
        reqId: job.reqId,
        queuedAt: new Date().toISOString(),
        status: "queued",
        attempts: 0,
      });
      await rt.client.lpush(rt.key, payload);
    },

    /**
     * Return the current status entry for a build.
     *
     * For remote queues Redis has no peek; builds table is source of truth.
     * Returns null to signal caller should query the database.
     */
    async status(_buildId: string): Promise<QueueEntry | null> {
      await Promise.resolve();
      return null;
    },

    /**
     * Return queue entries that are queued or running.
     *
     * Remote queues don't track in-queue status server-side; returns empty.
     */
    async active(): Promise<QueueEntry[]> {
      await Promise.resolve();
      return [];
    },

    /**
     * Return the most recent queue entries.
     *
     * Remote queues don't track history server-side; returns empty.
     */
    async recent(_limit: number): Promise<QueueEntry[]> {
      await Promise.resolve();
      return [];
    },
  };
}
