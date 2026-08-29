/** Lifecycle status of a capture job, tracked by the capture queue. */
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** A snapshot of a capture job's status, for the queue/status UI. */
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
export interface CaptureQueue {
  /** Submit a build for capture. Resolves once the build is queued. */
  enqueue(job: CaptureJob): Promise<void>;
  /** Return the current status entry for a build, or null if untracked. */
  status(buildId: string): QueueEntry | null;
  /** Queue entries that are queued or running. */
  active(): QueueEntry[];
  /** The most recent queue entries, newest first. */
  recent(limit: number): QueueEntry[];
}
