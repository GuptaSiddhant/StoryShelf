/**
 * The parent side of forked capture (ADR 0006, decision 5). The app's consumer polls the queue and
 * holds the slots; its `capture` handler is this one, which pushes each leased job to a child over
 * IPC and waits for the child's `done` or `failed`. The child's `progress` messages become the
 * job's progress, which renews the lease the consumer keeps.
 *
 * One limit covers failed attempts, lost leases and child crashes, so a crash simply fails the
 * run and the consumer retries it. A crash is charged only to the run that caused it (the hung one,
 * or the only one out); runs that shared a crashed child are pushed again, uncharged, one at a time,
 * so a repeat crash names its culprit. A crash loop, or a child that cannot start, hands everything
 * to the in-process handler.
 */
import type { Logger } from "../../logger.ts";
import { isFinalAttempt } from "../consumer/retry.ts";
import type { ConsumerJob, JobRunContext, KindHandler } from "../consumer/types.ts";
import { DEFAULT_LEASE_MS } from "../db-queue/types.ts";
import type { ChildProcessHandle } from "./channel.ts";
import { CrashTracker } from "./crash-tracker.ts";
import { describeExit, type ChildExit } from "./exit.ts";
import { LeaseBook } from "./lease-book.ts";
import { isChildMessage, type ChildMessage } from "./protocol.ts";
import { jobKey, RunBook, type Run, type RunVerdict } from "./runs.ts";

/** Options of {@link createForkedCaptureHandler}. */
export interface ForkedCaptureOptions {
  /** Start the capture child. Throwing counts as "fork failed" and trips the fallback. */
  spawn: () => ChildProcessHandle;
  /** Runs jobs in this process when forking stops being viable. */
  fallback: KindHandler;
  /** Longest a pushed job may go without progress before the child is declared hung and killed (0 disables). */
  leaseMs?: number;
  /** Non-zero exits within `crashWindowMs` that trip the fallback (default 3). */
  crashLimit?: number;
  crashWindowMs?: number;
  /** Delay before pushing again after a crash (default 250 ms). */
  restartDelayMs?: number;
  /** Retries assumed for jobs that do not state `maxAttempts` (the consumer's `maxRetries`). */
  maxRetries?: number;
  /**
   * The child kept dying on this job's last attempt, so it never recorded the failure: write it
   * (the build, or the shard, fails). Runs before the job is failed on the queue.
   */
  onCrashed?: (job: ConsumerJob, error: string) => Promise<void>;
  logger?: Logger;
}

/** A `capture` handler that runs jobs in a forked child. */
export interface ForkedCaptureHandler extends KindHandler {
  /** Whether forking was given up and jobs run in-process. */
  readonly tripped: boolean;
  /** Stop the child (SIGTERM, escalating to SIGKILL). Call after the consumer has drained. */
  close(): Promise<void>;
}

/** Create the handler; the child is forked when the first job arrives. */
export function createForkedCaptureHandler(options: ForkedCaptureOptions): ForkedCaptureHandler {
  const forked = new ForkedCapture(options);
  // Plain closures, so the pieces can be passed around detached from the instance.
  return {
    get tripped() {
      return forked.tripped;
    },
    accepts: (job) => forked.accepts(job),
    run: async (job, context) => {
      await forked.run(job, context);
    },
    cancel: async (job) => {
      await forked.cancel(job);
    },
    close: async () => {
      await forked.close();
    },
  };
}

class ForkedCapture {
  readonly #options: ForkedCaptureOptions;
  readonly #runs = new RunBook();
  readonly #crashes: CrashTracker;
  readonly #leases: LeaseBook;
  /** Jobs the consumer gave up on (lease lost, cancelled) that may still wait to be pushed. */
  readonly #abandoned = new Set<string>();
  #child: ChildProcessHandle | null = null;
  /** The run whose lease ran out, while its child is being killed; that run alone is at fault. */
  #hung: string | null = null;
  #tripped = false;
  #closed = false;

  constructor(options: ForkedCaptureOptions) {
    this.#options = options;
    this.#crashes = new CrashTracker(options.crashLimit ?? 3, options.crashWindowMs ?? 300_000);
    this.#leases = new LeaseBook(options.leaseMs ?? DEFAULT_LEASE_MS, (runId) => {
      this.#onHung(runId);
    });
  }

  get tripped(): boolean {
    return this.#tripped;
  }

  accepts(job: ConsumerJob): boolean {
    return this.#options.fallback.accepts?.(job) !== false;
  }

  async run(job: ConsumerJob, context: JobRunContext): Promise<void> {
    const key = jobKey(job);
    try {
      await this.#runUntilSettled(job, context);
    } finally {
      this.#abandoned.delete(key);
    }
  }

  /** Push the job until it settles: a crash that was not this run's fault pushes it again, alone. */
  async #runUntilSettled(job: ConsumerJob, context: JobRunContext, solo = false): Promise<void> {
    if (this.#tripped || this.#closed) {
      await this.#options.fallback.run(job, context);
      return;
    }
    const verdict = await this.#pushWhenAllowed(job, context, solo);
    if (verdict !== null && (await this.#conclude(job, verdict))) {
      return;
    }
    if (verdict !== null) {
      await delay(this.#options.restartDelayMs ?? 250);
    }
    await this.#runUntilSettled(job, context, solo || verdict !== null);
  }

  /** Whether the push is over: true for a done run; a failed or charged one throws; false = push again. */
  async #conclude(job: ConsumerJob, verdict: RunVerdict): Promise<boolean> {
    if (verdict.kind === "done") {
      return true;
    }
    if (verdict.kind === "failed") {
      throw new Error(verdict.error);
    }
    if (!verdict.charged) {
      return false;
    }
    await this.#failCrashed(job, verdict.error);
    throw new Error(verdict.error);
  }

  /** Wait for a place, push, and wait for the verdict; null when the situation changed (tripped). */
  async #pushWhenAllowed(
    job: ConsumerJob,
    context: JobRunContext,
    solo: boolean,
  ): Promise<RunVerdict | null> {
    const run = await this.#waitForPlace(job, context, solo);
    return run === null ? null : await run.verdict;
  }

  async #waitForPlace(
    job: ConsumerJob,
    context: JobRunContext,
    solo: boolean,
  ): Promise<Run | null> {
    while (!this.#tripped && !this.#closed) {
      if (this.#abandoned.has(jobKey(job))) {
        throw new Error("capture job was cancelled before it ran");
      }
      if (this.#runs.canStart(solo)) {
        // Check and registration share one synchronous block: two waiters never both start solo.
        return this.#push(job, context, solo);
      }
      // oxlint-disable-next-line no-await-in-loop -- wait for a place
      await this.#runs.changed();
    }
    return null;
  }

  /** The consumer stopped waiting for this job: stop the child's render, or keep it from starting. */
  async cancel(job: ConsumerJob): Promise<void> {
    const run = this.#runs.runOf(job);
    if (run) {
      this.#child?.send({ type: "cancel", runId: run.runId });
      return;
    }
    this.#abandoned.add(jobKey(job));
    this.#runs.wake();
    if (this.#tripped) {
      await this.#options.fallback.cancel?.(job);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#shutDown();
    for (const run of this.#runs.takeAll()) {
      run.settle({ kind: "failed", error: "capture child stopped" });
    }
    await Promise.resolve();
  }

  #push(job: ConsumerJob, context: JobRunContext, solo: boolean): Run | null {
    const child = this.#ensureChild();
    if (child === null) {
      return null;
    }
    const run = this.#runs.add(job, context, solo);
    this.#leases.start(run.runId);
    child.send({ type: "run", runId: run.runId, job });
    return run;
  }

  #ensureChild(): ChildProcessHandle | null {
    if (this.#child) {
      return this.#child;
    }
    try {
      this.#child = this.#attach(this.#options.spawn());
      return this.#child;
    } catch (error) {
      this.#options.logger?.error({ err: error }, "failed to start capture child");
      this.#trip("spawn failed");
      return null;
    }
  }

  #attach(child: ChildProcessHandle): ChildProcessHandle {
    child.onMessage((message) => {
      this.#onMessage(message);
    });
    child.onExit((info) => {
      this.#onExit(child, info);
    });
    return child;
  }

  #onMessage(message: unknown): void {
    if (!isChildMessage(message)) {
      return;
    }
    const run = this.#runs.get(message.runId);
    if (!run) {
      return;
    }
    this.#onRunMessage(run, message);
  }

  #onRunMessage(run: Run, message: ChildMessage): void {
    if (message.type === "progress") {
      this.#leases.touch(run.runId);
      run.context.touch();
      return;
    }
    this.#leases.stop(run.runId);
    this.#runs.finish(
      run.runId,
      message.type === "done" ? { kind: "done" } : { kind: "failed", error: message.error },
    );
  }

  #onExit(child: ChildProcessHandle, info: ChildExit): void {
    if (this.#child !== child) {
      return;
    }
    this.#child = null;
    // An exit the parent did not ask for while work was out is a crash whatever its code: a child
    // that returns cleanly before answering (a broken entry module) would otherwise loop forever.
    const crashed = info.code !== 0 || this.#runs.size > 0;
    this.#settleCrashedRuns(info);
    if (crashed && !this.#closed && this.#crashes.record()) {
      this.#trip(`capture child crashed repeatedly (last: ${describeExit(info)})`);
    }
    this.#runs.wake();
  }

  /** Charge the crash to the hung run, or to the only run out; the others go back uncharged. */
  #settleCrashedRuns(info: ChildExit): void {
    const runs = this.#runs.takeAll();
    const hung = this.#hung;
    this.#hung = null;
    for (const run of runs) {
      this.#leases.stop(run.runId);
      run.settle({
        kind: "crashed",
        charged: hung === null ? runs.length === 1 : run.runId === hung,
        error: crashMessage(info, hung === run.runId),
      });
    }
  }

  /** On its last attempt a job the child kept killing is failed here: the child never recorded it. */
  async #failCrashed(job: ConsumerJob, error: string): Promise<void> {
    if (!isFinalAttempt(job, this.#options.maxRetries)) {
      return;
    }
    try {
      await this.#options.onCrashed?.(job, error);
    } catch (hookError) {
      this.#options.logger?.error({ err: hookError, buildId: job.buildId }, "crash hook failed");
    }
  }

  /** A pushed job went a full lease without progress: the child is hung, so kill it like a crash. */
  #onHung(runId: string): void {
    if (!this.#runs.get(runId) || !this.#child || this.#hung !== null) {
      return;
    }
    this.#options.logger?.error(
      { runId, leaseMs: this.#options.leaseMs },
      "capture child made no progress; killing it",
    );
    this.#hung = runId;
    this.#child.kill(true);
  }

  /** Forking is no longer viable: stop the child; waiting and crashed runs go to the fallback. */
  #trip(reason: string): void {
    if (this.#tripped) {
      return;
    }
    this.#tripped = true;
    this.#options.logger?.error(
      { reason },
      "capture child unavailable; falling back to in-process capture",
    );
    this.#shutDown();
  }

  #shutDown(): void {
    this.#hung = null;
    this.#leases.stopAll();
    const child = this.#child;
    this.#child = null;
    child?.kill();
    this.#runs.wake();
  }
}

function crashMessage(info: ChildExit, hung: boolean): string {
  return hung
    ? `capture worker made no progress and was killed (${describeExit(info)})`
    : `capture worker exited (${describeExit(info)})`;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}
