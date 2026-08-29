import type { Logger } from "pino";

import type { CaptureJob, CaptureQueue, QueueEntry } from "../adapters/capture-queue.ts";

export interface InMemoryCaptureQueueOptions {
  /** Maximum number of capture jobs that may run concurrently. */
  concurrency: number;
  /** Executes a single capture job. In-process on a long-lived host. */
  runJob: (job: CaptureJob) => Promise<void>;
  /** Optional logger for queue state transitions. */
  logger?: Logger;
}

/**
 * The default, in-process `CaptureQueue`.
 *
 * Runs capture jobs in the same process on a long-lived host (Node). `enqueue`
 * resolves once the job is tracked; the job itself runs asynchronously, bounded
 * by `concurrency`. Failed jobs are recorded on their queue entry and logged
 * rather than thrown, because `enqueue` has already returned to the caller.
 *
 * Serverless deployments substitute a remote `CaptureQueue` (e.g. SQS, Workers
 * Queues, Azure Storage Queues) whose `enqueue` pushes to the external queue;
 * a separately-assembled worker then runs `executeCaptureJob`.
 */
export class InMemoryCaptureQueue implements CaptureQueue {
  private readonly entries = new Map<string, QueueEntry>();
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly options: InMemoryCaptureQueueOptions) {}

  async enqueue(job: CaptureJob): Promise<void> {
    const entry = this.track(job.buildId);
    this.log(job)?.info("capture queued");
    this.inFlight.set(job.buildId, this.process(job, entry));
    await Promise.resolve();
  }

  status(buildId: string): QueueEntry | null {
    return this.entries.get(buildId) ?? null;
  }

  active(): QueueEntry[] {
    return [...this.entries.values()]
      .filter((entry) => entry.status === "queued" || entry.status === "running")
      .toSorted((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  recent(limit: number): QueueEntry[] {
    return [...this.entries.values()].toSorted((a, b) => b.queuedAt.localeCompare(a.queuedAt)).slice(0, limit);
  }

  private async process(job: CaptureJob, entry: QueueEntry): Promise<void> {
    const log = this.log(job);
    await this.acquire();
    entry.status = "running";
    entry.startedAt = new Date().toISOString();
    log?.info("capture started");
    try {
      await this.options.runJob(job);
    } catch (error) {
      entry.status = "failed";
      entry.finishedAt = new Date().toISOString();
      entry.error = error instanceof Error ? error.message : "Capture failed";
      log?.error({ err: error }, "capture failed");
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
      if (entry.status !== "failed") {
        entry.status = "completed";
        entry.finishedAt = new Date().toISOString();
        log?.info("capture completed");
      }
    }
  }

  private log(job: CaptureJob): Logger | undefined {
    return this.options.logger?.child({ buildId: job.buildId, reqId: job.reqId });
  }

  private track(buildId: string): QueueEntry {
    const existing = this.entries.get(buildId);
    if (existing) {
      existing.status = "queued";
      existing.queuedAt = new Date().toISOString();
      existing.startedAt = undefined;
      existing.finishedAt = undefined;
      existing.error = undefined;
      return existing;
    }
    const entry: QueueEntry = { buildId, status: "queued", queuedAt: new Date().toISOString() };
    this.entries.set(buildId, entry);
    return entry;
  }

  private async acquire(): Promise<void> {
    if (this.running < this.options.concurrency) {
      this.running += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
    await this.acquire();
  }
}
