/**
 * SQS-backed capture queue adapter (AWS cloud deployments).
 *
 * Composition root: wires client resolution, lifecycle probes, enqueue,
 * and worker polling into a `PollableCaptureQueue`. Per-concern logic
 * lives in its own module.
 */
import type {
  CaptureJob,
  PollableCaptureQueue,
  PollableJob,
  QueueEntry,
} from "@storyshelf/core/adapter/capture-queue";
import type { Logger } from "@storyshelf/core/logger";
import { resolveSqsContext } from "./client.ts";
import { buildSqsLifecycle } from "./lifecycle.ts";
import { enqueueJob, queueActive, queueRecent, queueStatus } from "./operations.ts";
import { ackJob, nackJob, pollJob } from "./poll.ts";
import type { SqsCaptureQueueOptions } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create an SQS-backed `CaptureQueue` with worker polling.
 *
 * Server side uses `enqueue` only; `status`/`active`/`recent` are no-ops
 * that return empty results (the builds table is the source of truth for remote
 * queues). Workers poll via `poll`/`ack`/`nack` which use SQS long-poll,
 * visibility timeout, and retry counting via `ApproximateReceiveCount`.
 *
 * A separately-assembled worker polls the queue and calls
 * `executeCaptureJob` from `@storyshelf/core`.
 *
 * @param options - SQS queue URL and optional client configuration.
 * @returns A `PollableCaptureQueue` satisfying the core interface.
 */
export function createSqsCaptureQueue(options: SqsCaptureQueueOptions): PollableCaptureQueue {
  const { ctx, ownsClient } = resolveSqsContext(options);

  return {
    metadata: {
      name: "SQS Queue",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "SQS-backed capture queue",
      kind: "sqs",
      category: "capture-queue",
    },
    setLogger(bound: Logger): void {
      ctx.logger ??= bound;
    },
    lifecycle: buildSqsLifecycle(ctx, ownsClient),
    async enqueue(job: CaptureJob): Promise<void> {
      await enqueueJob(ctx, job);
    },
    async status(buildId: string): Promise<QueueEntry | null> {
      return await queueStatus(ctx, buildId);
    },
    async active(): Promise<QueueEntry[]> {
      return await queueActive(ctx);
    },
    async recent(limit: number): Promise<QueueEntry[]> {
      return await queueRecent(ctx, limit);
    },
    async poll(pollOptions?: { waitMs?: number }): Promise<PollableJob | null> {
      return await pollJob(ctx, pollOptions);
    },
    async ack(job: PollableJob): Promise<void> {
      await ackJob(ctx, job);
    },
    async nack(
      job: PollableJob,
      nackOptions?: { requeue?: boolean; delayMs?: number },
    ): Promise<void> {
      await nackJob(ctx, job, nackOptions);
    },
  };
}

export type { SqsCaptureQueueOptions } from "./types.ts";
