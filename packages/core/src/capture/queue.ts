import type { Logger } from "pino";
import type { CaptureJob, CaptureQueue, QueueEntry } from "../adapters/capture-queue.ts";
import { ProgressLease, type JobLease } from "./job-lease.ts";

declare const __PKG_VERSION__: string | undefined;

/** Options for the in-process capture queue. */
export interface InMemoryCaptureQueueOptions {
  concurrency: number;
  /** Runs one job; call `lease.touch()` as it makes progress. */
  runJob: (job: CaptureJob, lease: JobLease) => Promise<void>;
  logger?: Logger;
  /**
   * Longest a running job may go without touching its lease before it is declared stalled
   * (0 or unset disables). The in-process counterpart of a remote queue's visibility timeout.
   */
  leaseMs?: number;
  /**
   * Called once when a job's lease expires, before its slot is released. `settled` resolves when the
   * stuck run finally ends (never, if it is truly hung). The queue ignores the run's late result.
   */
  onStalled?: (job: CaptureJob, run: { settled: Promise<void> }) => Promise<void>;
}
/** In-process capture queue with bounded concurrency. */
export class InMemoryCaptureQueue implements CaptureQueue {
  readonly metadata = {
    name: "In-Memory Queue",
    version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
    description: "In-process capture queue",
    kind: "memory",
    category: "capture-queue",
  } as const;

  readonly #entries = new Map<string, QueueEntry>();
  #running = 0;
  readonly #waiting: (() => void)[] = [];
  readonly #inFlight = new Map<string, Promise<void>>();

  readonly #options: InMemoryCaptureQueueOptions;

  constructor(options: InMemoryCaptureQueueOptions) {
    this.#options = options;
  }

  async enqueue(job: CaptureJob): Promise<void> {
    const entry = this.#track(job.buildId);
    this.#log(job)?.info("capture queued");
    this.#inFlight.set(job.buildId, this.#process(job, entry));
    await Promise.resolve();
  }

  async status(buildId: string): Promise<QueueEntry | null> {
    return await Promise.resolve(this.#entries.get(buildId) ?? null);
  }

  async active(): Promise<QueueEntry[]> {
    return await Promise.resolve(
      [...this.#entries.values()]
        .filter((entry) => entry.status === "queued" || entry.status === "running")
        .toSorted((a, b) => a.queuedAt.localeCompare(b.queuedAt)),
    );
  }

  async recent(limit: number): Promise<QueueEntry[]> {
    return await Promise.resolve(
      [...this.#entries.values()]
        .toSorted((a, b) => b.queuedAt.localeCompare(a.queuedAt))
        .slice(0, limit),
    );
  }

  async #process(job: CaptureJob, entry: QueueEntry): Promise<void> {
    const log = this.#log(job);
    await this.#acquire();
    entry.status = "running";
    entry.startedAt = new Date().toISOString();
    log?.info("capture started");
    let stalled = false;
    try {
      stalled = await this.#runLeased(job, entry);
    } catch (error) {
      entry.status = "failed";
      entry.finishedAt = new Date().toISOString();
      entry.error = error instanceof Error ? error.message : "Capture failed";
      log?.error({ err: error }, "capture failed");
    } finally {
      this.#running -= 1;
      this.#waiting.shift()?.();
      // A stalled job's entry already belongs to its recovery (it may have been requeued).
      if (!stalled && entry.status !== "failed") {
        entry.status = "completed";
        entry.finishedAt = new Date().toISOString();
        log?.info("capture completed");
      }
    }
  }

  /** Run the job under its progress lease; resolves true when the lease expired instead. */
  async #runLeased(job: CaptureJob, entry: QueueEntry): Promise<boolean> {
    const lease = new ProgressLease(this.#options.leaseMs ?? 0);
    const run = this.#options.runJob(job, lease);
    try {
      const outcome = await Promise.race([
        run.then(() => "done" as const),
        lease.expired.then(() => "expired" as const),
      ]);
      if (outcome === "done") {
        return false;
      }
    } finally {
      lease.stop();
    }
    await this.#handleStall(job, entry, run);
    return true;
  }

  async #handleStall(job: CaptureJob, entry: QueueEntry, run: Promise<void>): Promise<void> {
    const leaseMs = this.#options.leaseMs ?? 0;
    this.#log(job)?.error({ leaseMs }, "capture stalled: no progress, lease expired");
    entry.status = "failed";
    entry.finishedAt = new Date().toISOString();
    entry.error = `Capture stalled: no progress for ${Math.round(leaseMs / 1000)}s`;
    const settled = run.then(
      () => {},
      () => {},
    );
    try {
      await this.#options.onStalled?.(job, { settled });
    } catch (error) {
      this.#log(job)?.error({ err: error }, "stalled-capture recovery failed");
    }
  }

  #log(job: CaptureJob): Logger | undefined {
    return this.#options.logger?.child({ buildId: job.buildId, reqId: job.reqId });
  }

  #track(buildId: string): QueueEntry {
    const existing = this.#entries.get(buildId);
    if (existing) {
      existing.status = "queued";
      existing.queuedAt = new Date().toISOString();
      existing.startedAt = undefined;
      existing.finishedAt = undefined;
      existing.error = undefined;
      return existing;
    }
    const entry: QueueEntry = { buildId, status: "queued", queuedAt: new Date().toISOString() };
    this.#entries.set(buildId, entry);
    return entry;
  }

  async #acquire(): Promise<void> {
    if (this.#running < this.#options.concurrency) {
      this.#running += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.#waiting.push(resolve);
    });
    await this.#acquire();
  }
}
