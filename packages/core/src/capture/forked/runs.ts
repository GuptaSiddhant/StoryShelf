/** The runs pushed to the capture child and not yet settled, and who may start next. */
import type { ConsumerJob, JobRunContext } from "../consumer/types.ts";

/** How a push ended. */
export type RunVerdict =
  | { kind: "done" }
  | { kind: "failed"; error: string }
  /** The child died under it; `charged` when this run is the one that took it down. */
  | { kind: "crashed"; charged: boolean; error: string };

/** One push of a job to the child. */
export interface Run {
  runId: string;
  job: ConsumerJob;
  context: JobRunContext;
  /** Runs alone: it shared a crashed child, so a repeat crash will name its culprit. */
  solo: boolean;
  settle: (verdict: RunVerdict) => void;
  verdict: Promise<RunVerdict>;
}

/** In-flight runs by id, plus the admission rule for solo runs and a signal for waiters. */
export class RunBook {
  readonly #runs = new Map<string, Run>();
  #waiters: (() => void)[] = [];
  #ids = 0;

  /** Register a run (call right after {@link canStart}, with no await between). */
  add(job: ConsumerJob, context: JobRunContext, solo: boolean): Run {
    this.#ids += 1;
    const { promise, resolve } = Promise.withResolvers<RunVerdict>();
    const run: Run = {
      runId: `run-${this.#ids}`,
      job,
      context,
      solo,
      settle: resolve,
      verdict: promise,
    };
    this.#runs.set(run.runId, run);
    return run;
  }

  get(runId: string): Run | undefined {
    return this.#runs.get(runId);
  }

  /** The run of `job` (by lease receipt, else build and shard), when it is out with the child. */
  runOf(job: ConsumerJob): Run | undefined {
    return [...this.#runs.values()].find((run) => jobKey(run.job) === jobKey(job));
  }

  get size(): number {
    return this.#runs.size;
  }

  /** A solo run waits for an empty child and then runs alone; nothing starts beside it. */
  canStart(solo: boolean): boolean {
    const runs = [...this.#runs.values()];
    if (runs.some((run) => run.solo)) {
      return false;
    }
    return solo ? runs.length === 0 : true;
  }

  /** Settle and remove one run, then wake whoever waits for a place. */
  finish(runId: string, verdict: RunVerdict): void {
    const run = this.#runs.get(runId);
    if (run) {
      this.#runs.delete(runId);
      run.settle(verdict);
    }
    this.wake();
  }

  /** Remove every run (the child that held them is gone), returning them. */
  takeAll(): Run[] {
    const runs = [...this.#runs.values()];
    this.#runs.clear();
    return runs;
  }

  /** Resolves at the next {@link wake}. */
  async changed(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#waiters.push(resolve);
    });
  }

  wake(): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }
}

/** Identity of a job across redeliveries of the same push loop: its lease receipt, else build and shard. */
export function jobKey(job: ConsumerJob): string {
  return job.receipt ?? `${job.buildId}:${job.shard ?? ""}`;
}
