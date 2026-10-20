/** Parent-side bookkeeping for the forked queue: what is waiting, what is out with the child, and each build's entry. */
import type { PollableJob, QueueEntry } from "../../adapters/capture-queue.ts";
import type { CaptureJob } from "../../adapters/capture-queue.ts";
import { entryKey } from "../queue.ts";

/** A job delivered to the child, always carrying its receipt. */
export type DeliveredJob = PollableJob & { receipt: string };

/** Pending and in-flight jobs plus the observable {@link QueueEntry} per build. */
export class JobBook {
  readonly #entries = new Map<string, QueueEntry>();
  readonly #pending: PollableJob[] = [];
  readonly #inFlight = new Map<string, DeliveredJob>();
  /** Jobs that shared a crashed child: each runs alone until it finishes, so a crash names its culprit. */
  readonly #solo = new Set<string>();
  #receipts = 0;

  /** Register a build as queued (re-enqueueing a known build resets its entry) and wait for delivery. */
  add(job: CaptureJob): void {
    this.#solo.delete(entryKey(job));
    this.#resetEntry(job);
    this.#pending.push({ ...job, attempts: 0 });
  }

  #resetEntry(job: CaptureJob): void {
    const queuedAt = new Date().toISOString();
    const key = entryKey(job);
    const entry = this.#entries.get(key) ?? {
      buildId: job.buildId,
      ...(job.shard ? { shard: job.shard } : {}),
      status: "queued" as const,
      queuedAt,
    };
    Object.assign(entry, {
      status: "queued",
      queuedAt,
      startedAt: undefined,
      finishedAt: undefined,
      error: undefined,
    });
    this.#entries.set(key, entry);
  }

  /**
   * Put a job back for redelivery (front for crash recovery so it is not starved by newer work).
   * `charge: false` keeps its attempt count (it was not at fault); `solo` makes it run alone next.
   */
  requeue(job: PollableJob, options: { front: boolean; charge?: boolean; solo?: boolean }): void {
    this.#markQueued(job);
    if (options.solo) {
      this.#solo.add(entryKey(job));
    }
    const charge = options.charge === false ? 0 : 1;
    const next = { ...job, receipt: undefined, attempts: (job.attempts ?? 0) + charge };
    if (options.front) {
      this.#pending.unshift(next);
    } else {
      this.#pending.push(next);
    }
  }

  #markQueued(job: CaptureJob): void {
    const entry = this.#entries.get(entryKey(job));
    if (entry) {
      entry.status = "queued";
      entry.startedAt = undefined;
    }
  }

  /** Whether `receipt` is currently out with the child. */
  isInFlight(receipt: string): boolean {
    return this.#inFlight.has(receipt);
  }

  get hasPending(): boolean {
    return this.#pending.length > 0;
  }

  /** Hand the next pending job to the child: assigns a receipt and marks it running. */
  take(): DeliveredJob | undefined {
    const index = this.#nextIndex();
    const [job] = index === -1 ? [] : this.#pending.splice(index, 1);
    if (!job) {
      return undefined;
    }
    this.#receipts += 1;
    const delivered = { ...job, receipt: `r${this.#receipts}` };
    this.#inFlight.set(delivered.receipt, delivered);
    this.#markRunning(job);
    return delivered;
  }

  /** The next deliverable pending job: a solo job waits for an empty child and then runs alone. */
  #nextIndex(): number {
    const busy = this.#inFlight.size > 0;
    if (busy && [...this.#inFlight.values()].some((job) => this.#solo.has(entryKey(job)))) {
      return -1;
    }
    return this.#pending.findIndex((job) => !busy || !this.#solo.has(entryKey(job)));
  }

  /** How many jobs are out with the child. */
  get inFlightCount(): number {
    return this.#inFlight.size;
  }

  #markRunning(job: CaptureJob): void {
    const entry = this.#entries.get(entryKey(job));
    if (entry) {
      entry.status = "running";
      entry.startedAt = new Date().toISOString();
    }
  }

  /** Remove and return an in-flight job by receipt; undefined for stale or unknown receipts. */
  release(receipt: string): DeliveredJob | undefined {
    const job = this.#inFlight.get(receipt);
    this.#inFlight.delete(receipt);
    return job;
  }

  /** Every in-flight job, removed from the in-flight set (the child that held them is gone). */
  releaseAll(): DeliveredJob[] {
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

  finish(job: CaptureJob, status: "completed" | "failed", error?: string): void {
    this.#solo.delete(entryKey(job));
    const entry = this.#entries.get(entryKey(job));
    if (entry) {
      entry.status = status;
      entry.finishedAt = new Date().toISOString();
      entry.error = error;
    }
  }

  /** Record a build that never entered the book as failed (nothing could run it). */
  reject(job: CaptureJob, error: string): void {
    const now = new Date().toISOString();
    this.#entries.set(entryKey(job), {
      buildId: job.buildId,
      ...(job.shard ? { shard: job.shard } : {}),
      status: "failed",
      queuedAt: now,
      finishedAt: now,
      error,
    });
  }

  forget(job: CaptureJob): void {
    this.#solo.delete(entryKey(job));
    this.#entries.delete(entryKey(job));
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
