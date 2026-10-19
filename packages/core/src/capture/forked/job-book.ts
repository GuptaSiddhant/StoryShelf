/** Parent-side bookkeeping for the forked queue: what is waiting, what is out with the child, and each build's entry. */
import type { PollableJob, QueueEntry } from "../../adapters/capture-queue.ts";
import type { CaptureJob } from "../../adapters/capture-queue.ts";

/** Pending and in-flight jobs plus the observable {@link QueueEntry} per build. */
export class JobBook {
  readonly #entries = new Map<string, QueueEntry>();
  readonly #pending: PollableJob[] = [];
  readonly #inFlight = new Map<string, PollableJob>();
  #receipts = 0;

  /** Register a build as queued (re-enqueueing a known build resets its entry) and wait for delivery. */
  add(job: CaptureJob): void {
    this.#resetEntry(job.buildId);
    this.#pending.push({ ...job, attempts: 0 });
  }

  #resetEntry(buildId: string): void {
    const queuedAt = new Date().toISOString();
    const entry = this.#entries.get(buildId) ?? { buildId, status: "queued", queuedAt };
    Object.assign(entry, {
      status: "queued",
      queuedAt,
      startedAt: undefined,
      finishedAt: undefined,
      error: undefined,
    });
    this.#entries.set(buildId, entry);
  }

  /** Put a job back for redelivery (front for crash recovery so it is not starved by newer work). */
  requeue(job: PollableJob, options: { front: boolean }): void {
    const entry = this.#entries.get(job.buildId);
    if (entry) {
      entry.status = "queued";
      entry.startedAt = undefined;
    }
    const next = { ...job, receipt: undefined, attempts: (job.attempts ?? 0) + 1 };
    if (options.front) {
      this.#pending.unshift(next);
    } else {
      this.#pending.push(next);
    }
  }

  get hasPending(): boolean {
    return this.#pending.length > 0;
  }

  /** Hand the next pending job to the child: assigns a receipt and marks it running. */
  take(): PollableJob | undefined {
    const job = this.#pending.shift();
    if (!job) {
      return undefined;
    }
    this.#receipts += 1;
    const delivered = { ...job, receipt: `r${this.#receipts}` };
    this.#inFlight.set(delivered.receipt, delivered);
    this.#markRunning(job.buildId);
    return delivered;
  }

  #markRunning(buildId: string): void {
    const entry = this.#entries.get(buildId);
    if (entry) {
      entry.status = "running";
      entry.startedAt = new Date().toISOString();
    }
  }

  /** Remove and return an in-flight job by receipt; undefined for stale or unknown receipts. */
  release(receipt: string): PollableJob | undefined {
    const job = this.#inFlight.get(receipt);
    this.#inFlight.delete(receipt);
    return job;
  }

  /** Every in-flight job, removed from the in-flight set (the child that held them is gone). */
  releaseAll(): PollableJob[] {
    const jobs = [...this.#inFlight.values()];
    this.#inFlight.clear();
    return jobs;
  }

  /** Every job not yet finished (pending and in flight), removed from the book. */
  drain(): PollableJob[] {
    const jobs = [...this.#pending, ...this.releaseAll()];
    this.#pending.length = 0;
    return jobs;
  }

  finish(buildId: string, status: "completed" | "failed", error?: string): void {
    const entry = this.#entries.get(buildId);
    if (entry) {
      entry.status = status;
      entry.finishedAt = new Date().toISOString();
      entry.error = error;
    }
  }

  /** Record a build that never entered the book as failed (nothing could run it). */
  reject(job: CaptureJob, error: string): void {
    const now = new Date().toISOString();
    this.#entries.set(job.buildId, {
      buildId: job.buildId,
      status: "failed",
      queuedAt: now,
      finishedAt: now,
      error,
    });
  }

  forget(buildId: string): void {
    this.#entries.delete(buildId);
  }

  status(buildId: string): QueueEntry | null {
    return this.#entries.get(buildId) ?? null;
  }

  active(): QueueEntry[] {
    return [...this.#entries.values()].filter(
      (entry) => entry.status === "queued" || entry.status === "running",
    );
  }

  all(): QueueEntry[] {
    return [...this.#entries.values()];
  }
}
