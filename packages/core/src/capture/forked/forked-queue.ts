/** Parent-side queue for a forked capture child (ADR 0031 phase 3). */
import type {
  CaptureJob,
  CaptureQueue,
  PollableJob,
  QueueEntry,
} from "../../adapters/capture-queue.ts";
import type { Logger } from "../../logger.ts";
import { entryKey } from "../queue.ts";
import type { ChildProcessHandle } from "./channel.ts";
import { CrashTracker } from "./crash-tracker.ts";
import { JobBook, type DeliveredJob } from "./job-book.ts";
import { LeaseBook } from "./lease-book.ts";
import { isChildMessage, type ChildMessage } from "./protocol.ts";

declare const __PKG_VERSION__: string | undefined;

/** How a job ended, reported to `onSettled` so the parent can notify; the child only reports outcomes. */
export interface ForkedJobOutcome {
  status: "completed" | "failed";
  error?: string;
  /**
   * The job was failed by the parent because the child kept dying on it. The child never got to
   * record that, so the settle hook must write the build (or shard) failure itself.
   */
  crashed?: true;
}

/** Options for {@link ForkedCaptureQueue}. */
export interface ForkedCaptureQueueOptions {
  /** Start the capture child. Throwing counts as "fork failed" and trips the fallback. */
  spawn: () => ChildProcessHandle;
  /** Queue that takes over when forking stops being viable (in-process queue); without it, jobs fail. */
  fallback?: CaptureQueue;
  /** Redeliveries after child crashes before a job is failed (default 2). */
  maxCrashRetries?: number;
  /** Non-zero exits within `crashWindowMs` that trip the fallback (default 3). */
  crashLimit?: number;
  crashWindowMs?: number;
  /**
   * Longest a delivered job may go without a `progress` message before the child is declared hung,
   * killed, and treated as crashed (0 or unset disables). Needs a child that reports progress.
   */
  leaseMs?: number;
  /** Delay before restarting a crashed child (default 250 ms). */
  restartDelayMs?: number;
  /** Called when a job finishes for good, in the parent, so notifications stay out of the child. */
  onSettled?: (job: PollableJob, outcome: ForkedJobOutcome) => Promise<void>;
  logger?: Logger;
}

interface Waiter {
  id: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Keeps the queue state (`status`/`active`/`recent`) in the parent and runs jobs in a child that
 * pulls them over IPC. A crashed child's in-flight jobs are redelivered with `attempts` bumped and
 * failed past `maxCrashRetries`; a crash loop or a failed spawn hands everything to `fallback`.
 */
export class ForkedCaptureQueue implements CaptureQueue {
  readonly metadata = {
    name: "Forked Queue",
    version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
    description: "Parent side of a forked capture child",
    kind: "forked",
    category: "capture-queue",
  } as const;

  readonly lifecycle = {
    setup: async (): Promise<void> => {
      await Promise.resolve();
    },
    teardown: async (): Promise<void> => {
      this.#close();
      await Promise.resolve();
    },
    health: async (): Promise<{ ok: boolean; detail?: string }> =>
      await Promise.resolve(
        this.#tripped
          ? { ok: true, detail: "running in-process (forked child unavailable)" }
          : { ok: true },
      ),
  };

  readonly #options: ForkedCaptureQueueOptions;
  readonly #book = new JobBook();
  readonly #crashes: CrashTracker;
  readonly #leases: LeaseBook;
  readonly #routed = new Set<string>();
  #waiters: Waiter[] = [];
  #child: ChildProcessHandle | null = null;
  /** The receipt whose lease ran out, while its child is being killed; that job alone is at fault. */
  #hung: string | null = null;
  #restart: ReturnType<typeof setTimeout> | undefined;
  #tripped = false;
  #closed = false;

  constructor(options: ForkedCaptureQueueOptions) {
    this.#options = options;
    this.#crashes = new CrashTracker(options.crashLimit ?? 3, options.crashWindowMs ?? 300_000);
    this.#leases = new LeaseBook(options.leaseMs ?? 0, (receipt) => {
      this.#onHung(receipt);
    });
  }

  async enqueue(job: CaptureJob): Promise<void> {
    if (this.#tripped) {
      await this.#divert(job);
      return;
    }
    this.#routed.delete(entryKey(job));
    this.#book.add(job);
    this.#options.logger?.child({ buildId: job.buildId }).info("capture queued");
    this.#ensureChild();
    this.#deliver();
    await Promise.resolve();
  }

  async status(buildId: string): Promise<QueueEntry | null> {
    if (this.#routed.has(buildId)) {
      return (await this.#options.fallback?.status(buildId)) ?? null;
    }
    return this.#book.status(buildId);
  }

  async active(): Promise<QueueEntry[]> {
    const own = this.#book.active();
    const diverted = this.#tripped ? ((await this.#options.fallback?.active()) ?? []) : [];
    return [...own, ...diverted].toSorted((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  async recent(limit: number): Promise<QueueEntry[]> {
    const diverted = this.#tripped ? ((await this.#options.fallback?.recent(limit)) ?? []) : [];
    return [...this.#book.all(), ...diverted]
      .toSorted((a, b) => b.queuedAt.localeCompare(a.queuedAt))
      .slice(0, limit);
  }

  #ensureChild(): void {
    if (this.#child || this.#tripped || this.#closed || this.#restart) {
      return;
    }
    try {
      const child = this.#options.spawn();
      this.#child = child;
      child.onMessage((message) => {
        this.#onMessage(message);
      });
      child.onExit((info) => {
        this.#onExit(child, info);
      });
    } catch (error) {
      this.#options.logger?.error({ err: error }, "failed to start capture child");
      this.#trip("spawn failed");
    }
  }

  #onMessage(message: unknown): void {
    if (!isChildMessage(message)) {
      return;
    }
    switch (message.type) {
      case "poll":
        this.#onPoll(message);
        break;
      case "ack":
        this.#settle(message.receipt, { status: "completed" });
        break;
      case "nack":
        this.#onNack(message);
        break;
      case "progress":
        this.#leases.touch(message.receipt);
        break;
      case "enqueue":
        this.enqueue(message.job).catch(() => {});
        break;
      default:
        break;
    }
  }

  #onPoll(message: Extract<ChildMessage, { type: "poll" }>): void {
    const timer = setTimeout(() => {
      this.#waiters = this.#waiters.filter((waiter) => waiter.id !== message.id);
      this.#child?.send({ type: "empty", id: message.id });
    }, message.waitMs);
    timer.unref();
    this.#waiters.push({ id: message.id, timer });
    this.#deliver();
  }

  #deliver(): void {
    while (this.#child && this.#hung === null && this.#book.hasPending) {
      const waiter = this.#waiters.shift();
      if (!waiter) {
        return;
      }
      const job = this.#book.take();
      if (!job) {
        this.#waiters.unshift(waiter);
        return;
      }
      this.#handOver(waiter, job);
    }
  }

  /** Give a job to the child that is waiting on `waiter`, and start watching it for progress. */
  #handOver(waiter: Waiter, job: DeliveredJob): void {
    clearTimeout(waiter.timer);
    this.#leases.start(job.receipt);
    this.#child?.send({ type: "job", id: waiter.id, job });
  }

  #onNack(message: Extract<ChildMessage, { type: "nack" }>): void {
    const job = this.#release(message.receipt);
    if (!job) {
      return;
    }
    if (!message.requeue) {
      this.#finish(job, { status: "failed", error: message.error ?? "capture failed" });
      return;
    }
    const redeliver = (): void => {
      this.#redeliver(job);
    };
    if (message.delayMs && message.delayMs > 0) {
      setTimeout(redeliver, message.delayMs).unref();
    } else {
      redeliver();
    }
  }

  /**
   * Put a nacked job back after its backoff. The child may have exited, or the queue tripped, while
   * the job sat out the delay; it was in neither the pending nor the in-flight set then.
   */
  #redeliver(job: PollableJob): void {
    if (this.#tripped) {
      this.#divert(divertable(job)).catch(() => {});
      return;
    }
    this.#book.requeue(job, { front: false });
    this.#ensureChild();
    this.#deliver();
  }

  #settle(receipt: string, outcome: ForkedJobOutcome): void {
    const job = this.#release(receipt);
    if (job) {
      this.#finish(job, outcome);
      // A job held back to run alone may be waiting for this one to finish.
      this.#deliver();
    }
  }

  /** Take a job back from the child: stop its lease and remove it from the in-flight set. */
  #release(receipt: string): PollableJob | undefined {
    this.#leases.stop(receipt);
    return this.#book.release(receipt);
  }

  #finish(job: PollableJob, outcome: ForkedJobOutcome): void {
    this.#book.finish(job, outcome.status, outcome.error);
    this.#options.onSettled?.(job, outcome).catch((error: unknown) => {
      this.#options.logger?.error({ err: error, buildId: job.buildId }, "settle hook failed");
    });
  }

  #onExit(child: ChildProcessHandle, info: { code: number | null; signal: string | null }): void {
    if (this.#child !== child) {
      return;
    }
    this.#child = null;
    this.#clearWaiters();
    const crashed = this.#isCrash(info);
    this.#recoverInFlight(info);
    if (crashed && this.#crashes.record()) {
      this.#trip(`capture child crashed repeatedly (last: ${describeExit(info)})`);
    } else if (this.#book.hasPending && !this.#closed) {
      this.#scheduleRestart();
    }
  }

  /**
   * An exit the parent did not ask for while work was waiting is a crash whatever its code: a child
   * that returns cleanly before polling (a broken entry module) would otherwise loop forever.
   */
  #isCrash(info: { code: number | null }): boolean {
    return info.code !== 0 || this.#book.hasPending || this.#book.inFlightCount > 0;
  }

  /**
   * Requeue (or, past `maxCrashRetries`, fail) what the dead child held. A crash is charged only to
   * the job that caused it: the hung one, or the only one in flight. Jobs that shared a crashed child
   * go back uncharged and each runs alone next, so a repeat crash names its culprit.
   */
  #recoverInFlight(info: { code: number | null; signal: string | null }): void {
    const jobs = this.#book.releaseAll();
    const hung = this.#hung;
    this.#hung = null;
    for (const job of jobs) {
      this.#leases.stop(job.receipt);
      if (hung === null ? jobs.length === 1 : job.receipt === hung) {
        this.#chargeCrash(job, info);
      } else {
        this.#book.requeue(job, { front: true, charge: false, solo: hung === null });
      }
    }
  }

  #chargeCrash(job: PollableJob, info: { code: number | null; signal: string | null }): void {
    const attempts = job.attempts ?? 0;
    if (attempts < (this.#options.maxCrashRetries ?? 2)) {
      this.#book.requeue(job, { front: true });
      return;
    }
    this.#finish(job, {
      status: "failed",
      error: `capture worker exited (${describeExit(info)}) ${attempts + 1} times`,
      crashed: true,
    });
  }

  #scheduleRestart(): void {
    this.#restart = setTimeout(() => {
      this.#restart = undefined;
      this.#ensureChild();
      this.#deliver();
    }, this.#options.restartDelayMs ?? 250);
    this.#restart.unref();
  }

  /** Forking is no longer viable: stop the child and move everything unfinished to the fallback. */
  #trip(reason: string): void {
    if (this.#tripped) {
      return;
    }
    this.#tripped = true;
    this.#options.logger?.error(
      { reason },
      "capture child unavailable; falling back to in-process capture",
    );
    this.#close();
    for (const job of this.#book.drain()) {
      this.#divert(divertable(job)).catch(() => {});
    }
  }

  async #divert(job: CaptureJob): Promise<void> {
    const fallback = this.#options.fallback;
    if (!fallback) {
      this.#book.reject(job, "capture child unavailable and no fallback queue");
      return;
    }
    this.#book.forget(job);
    this.#routed.add(entryKey(job));
    await fallback.enqueue(job);
  }

  #clearWaiters(): void {
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timer);
    }
    this.#waiters = [];
  }

  /** A delivered job went a full lease without progress: the child is hung, so kill it like a crash. */
  #onHung(receipt: string): void {
    if (!this.#book.isInFlight(receipt) || !this.#child || this.#hung !== null) {
      return;
    }
    this.#options.logger?.error(
      { receipt, leaseMs: this.#options.leaseMs },
      "capture child made no progress; killing it",
    );
    this.#hung = receipt;
    this.#child.kill(true);
  }

  #close(): void {
    this.#closed = true;
    this.#hung = null;
    this.#leases.stopAll();
    clearTimeout(this.#restart);
    this.#restart = undefined;
    this.#clearWaiters();
    const child = this.#child;
    this.#child = null;
    child?.kill();
  }
}

/** The parts of a job the fallback queue takes (no receipt or attempt count). */
function divertable(job: PollableJob): CaptureJob {
  return {
    buildId: job.buildId,
    reqId: job.reqId,
    traceparent: job.traceparent,
    ...(job.shard ? { shard: job.shard } : {}),
  };
}

function describeExit(info: { code: number | null; signal: string | null }): string {
  return info.signal ? `signal ${info.signal}` : `code ${info.code}`;
}
