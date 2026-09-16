import type { Adapter } from "./metadata.ts";

/** Lifecycle status of a queued capture job. */
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Observable state of a single capture queue entry. */
export interface QueueEntry {
  buildId: string;
  status: JobStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

/** A build submitted for capture. */
export interface CaptureJob {
  buildId: string;
  /** Request id used to correlate the background job with the request that queued it. */
  reqId?: string;
}

/** A job polled from a queue with transport metadata. */
export interface PollableJob extends CaptureJob {
  /** Transport receipt handle (SQS, Redis pop token, etc.). */
  receipt?: string;
  /** Number of delivery attempts already made (0 = first delivery). */
  attempts?: number;
  /** Raw transport message for debugging. */
  raw?: unknown;
}

/**
 * A capture job queue, decoupled from the runtime.
 *
 * `enqueue` submits a build for capture and returns quickly; the build is
 * tracked as "queued". The capture itself runs in a worker:
 *
 * - the in-memory implementation (`InMemoryCaptureQueue`, in
 *   `capture/capture-queue.ts`) runs the job in-process on a long-lived
 *   Node server;
 * - a remote implementation (e.g. SQS, Cloudflare Queues, Azure Storage
 *   Queues) pushes the job and leaves execution to a separately-assembled
 *   worker that polls the queue and runs `executeCaptureJob`.
 *
 * `status`/`active`/`recent` back the live queue view regardless of transport.
 */
export interface CaptureQueue extends Adapter<{ readonly category: "capture-queue" }> {
  /** Submit a build for capture. Resolves once the build is queued. */
  enqueue(job: CaptureJob): Promise<void>;
  /** Return the current status entry for a build, or null if untracked. */
  status(buildId: string): Promise<QueueEntry | null>;
  /** Queue entries that are queued or running. */
  active(): Promise<QueueEntry[]>;
  /** The most recent queue entries, newest first. */
  recent(limit: number): Promise<QueueEntry[]>;
}

/** Extension for queues that support worker-side polling. */
export interface PollableCaptureQueue extends CaptureQueue {
  /** Poll for a single job; returns null if none available within waitMs. */
  poll(options?: { waitMs?: number }): Promise<PollableJob | null>;
  /** Acknowledge successful processing of a polled job. */
  ack(job: PollableJob): Promise<void>;
  /** Negatively acknowledge; requeue with optional delay when possible. */
  nack(job: PollableJob, options?: { requeue?: boolean; delayMs?: number }): Promise<void>;
}
