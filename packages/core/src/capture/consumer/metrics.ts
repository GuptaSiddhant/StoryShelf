/**
 * Optional observation hooks of the consumer. Core owns no metrics library (the single OTEL owner is
 * `@storyshelf/observability`); the app adapts these two callbacks to its instruments.
 */
import type { PollableCaptureQueue } from "../../adapters/capture-queue.ts";
import type { Logger } from "../../logger.ts";
import type { CaptureJobKind } from "../../schema/capture-job.ts";
import { repeatEvery, type QueueTimers } from "../db-queue/timers.ts";

/** How a consumed job ended. */
export type JobOutcome =
  | "completed"
  | "retried"
  | "failed"
  | "cancelled"
  | "lost"
  | "dropped"
  | "unhandled";

/** A job the consumer finished with. */
export interface JobFinishedEvent {
  kind: CaptureJobKind;
  outcome: JobOutcome;
  /** Wall time from claim to settle. */
  durationMs: number;
  /** Delivery number from 1. */
  attempt: number;
}

/** A reading of the queue's backlog. */
export interface QueueSample {
  /** Jobs waiting to be claimed. */
  depth: number;
  /** Jobs running anywhere. */
  running: number;
  /** Age of the oldest waiting job; 0 when none waits. */
  oldestAgeMs: number;
}

/** Hooks the host may pass. Both are optional and must not throw. */
export interface ConsumerMetrics {
  jobFinished?(event: JobFinishedEvent): void;
  /** Called every `sampleEveryMs` with the queue's depth and oldest waiting job. Costs one read. */
  queueSample?(sample: QueueSample): void;
  /** Sampling interval (default {@link DEFAULT_SAMPLE_MS}); sampling is off without `queueSample`. */
  sampleEveryMs?: number;
}

/** Default interval between queue samples. */
export const DEFAULT_SAMPLE_MS = 30_000;

/** Read the backlog of `queue` from its `active()` view. */
export async function sampleQueue(queue: PollableCaptureQueue, now: number): Promise<QueueSample> {
  const entries = await queue.active();
  const waiting = entries.filter((entry) => entry.status === "queued");
  let oldest = Number.POSITIVE_INFINITY;
  for (const entry of waiting) {
    oldest = Math.min(oldest, Date.parse(entry.queuedAt));
  }
  return {
    depth: waiting.length,
    running: entries.length - waiting.length,
    oldestAgeMs: waiting.length === 0 ? 0 : Math.max(0, now - oldest),
  };
}

/** Start sampling when the host asked for it; returns the stop function. */
export function startQueueSampling(
  queue: PollableCaptureQueue,
  metrics: ConsumerMetrics | undefined,
  env: { now: () => number; timers: QueueTimers; logger: Logger },
): () => void {
  if (metrics?.queueSample === undefined) {
    return () => {};
  }
  return repeatEvery(env.timers, metrics.sampleEveryMs ?? DEFAULT_SAMPLE_MS, () => {
    sampleQueue(queue, env.now()).then(
      (sample) => metrics.queueSample?.(sample),
      (error: unknown) => {
        env.logger.warn({ err: error }, "queue sample failed");
      },
    );
  });
}

/** Tell the host a job ended; a throwing hook never reaches the consumer. */
export function reportFinished(
  metrics: ConsumerMetrics | undefined,
  event: JobFinishedEvent,
): void {
  try {
    metrics?.jobFinished?.(event);
  } catch {
    // A metrics hook must never break job handling.
  }
}
