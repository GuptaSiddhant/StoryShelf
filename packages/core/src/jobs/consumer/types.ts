/** Option and handler types of the capture consumer. */
import type { PollableCaptureQueue, PollableJob } from "../../adapters/capture-queue.ts";
import type { Logger } from "../../logger.ts";
import type { CaptureJobKind } from "../../schema/capture-job.ts";
import type { PollCadence } from "../db-queue/cadence.ts";
import type { QueueTimers } from "../db-queue/timers.ts";
import type { ConsumerMetrics } from "./metrics.ts";
import type { RetryConfig } from "./retry.ts";

/** A polled job as the consumer sees it: database jobs carry the extra fields, others omit them. */
export type ConsumerJob = PollableJob & {
  /** Job kind; absent on queues that only carry capture jobs (remote, IPC). */
  kind?: CaptureJobKind;
  /** Id of the job row (database queue). */
  jobId?: string;
  /** Attempt number from 1 (database queue). */
  attempt?: number;
  maxAttempts?: number;
  /** Kind-specific fields given at enqueue. */
  data?: Record<string, unknown>;
  /** Payload version (database queue); absent means 1. */
  payloadVersion?: number;
};

/** What a handler gets besides the job. */
export interface JobRunContext {
  /** Logger scoped to the job (`buildId`, `jobId`, `kind`). */
  logger: Logger;
  /** Report progress: renews the job's lease (throttled) and tells the host (`onProgress`). */
  touch(): void;
  /**
   * Aborted when the job is cancelled, loses its lease or passes `testing.maxJobSeconds`: stop
   * in-process work. The consumer keeps the job's slot until `run` returns (at most `STOP_GRACE_MS`).
   */
  signal: AbortSignal;
}

/** The code that runs jobs of one kind. */
export interface KindHandler {
  /**
   * Checked once before the consumer polls (the capture handler loads the image engine); a
   * rejection stops `start()` before any job is claimed.
   */
  prepare?(logger: Logger): Promise<void>;
  /** Run the job; resolve to ack it, reject to retry (or fail it on its last attempt). */
  run(job: ConsumerJob, context: JobRunContext): Promise<void>;
  /**
   * The highest payload version this handler reads (default 1). A job with a higher one is handed
   * back to the queue unrun and without spending an attempt (ADR 0053, decision 5).
   */
  payloadVersion?: number;
  /** Whether the job is well-formed; a job that is not is failed without retries. */
  accepts?(job: ConsumerJob): boolean;
  /**
   * The job passed its wall-clock bound and was abandoned (its lease is no longer renewed). Record
   * it where the job's work shows, e.g. the attempt log; failures are logged, never thrown.
   */
  deadlineExceeded?(job: ConsumerJob, seconds: number): Promise<void>;
  /**
   * Whether the job was queued for a run that has since been superseded (a retry started a newer
   * one). Checked before `run`; a superseded job ends `cancelled` and nothing it would write happens.
   */
  superseded?(job: ConsumerJob): Promise<boolean>;
  /** Retry delay of this kind: `baseMs * 2^n` capped at `maxMs`; defaults to the consumer's. */
  backoff?: { baseMs: number; maxMs: number };
  /** Stop a running job (lease lost or cancelled); must tolerate a job that already ended. */
  cancel?(job: ConsumerJob): Promise<void>;
}

/** Handler registry by job kind; a plain function is shorthand for `{ run }`. */
export type JobHandlers = Partial<
  Record<CaptureJobKind, KindHandler | KindHandler["run"] | undefined>
>;

/** Consumer tuning. */
export interface ConsumerConfig extends RetryConfig {
  /** Jobs run at once; default sized from the CPU and memory the process can use. */
  concurrency?: number;
  /** Long-poll wait for queues that block inside `poll` (default 20, max 20). */
  waitTimeSeconds?: number;
}

/** Options of {@link createCaptureConsumer}. */
export interface CaptureConsumerOptions {
  /** Queue to consume: the database queue, or the IPC queue of a forked child. */
  queue: PollableCaptureQueue;
  /** Handlers by kind: `capture` (`createCaptureHandler` from `/capture`), `publish`, `notify`. */
  handlers?: JobHandlers;
  config?: ConsumerConfig;
  /** Scratch directory swept at start. */
  scratchDir?: string;
  /** Called whenever a running job makes progress (the forked child reports it to its parent). */
  onProgress?: (job: ConsumerJob) => void;
  /** Optional observation hooks; core does not depend on any metrics library. */
  metrics?: ConsumerMetrics;
  logger?: Logger;
  /** Clock and timers (tests inject a manual clock). */
  now?: () => number;
  timers?: QueueTimers;
  /** Poll cadence of the database queue (default ADR 0006's). */
  cadence?: PollCadence;
  random?: () => number;
  /** Lease renewal throttle and state-check interval overrides (tests). */
  lease?: { renewEveryMs?: number; checkMs?: number };
}

/** Options of {@link CaptureConsumer.stop}. */
export interface ConsumerStopOptions {
  /**
   * Bound of the drain in ms (#912). Jobs still running near its end (it keeps a reserve of up to
   * `HAND_BACK_RESERVE_MS`) are stopped and handed back to the queue: visible again at once, their
   * attempt not spent, so another instance takes them over. Absent: wait for every job to end.
   */
  graceMs?: number;
}

/** Handle returned by {@link createCaptureConsumer}. */
export interface CaptureConsumer {
  /** Start consuming. Resolves once stopped and drained; rejects when a handler's `prepare` fails. */
  start(): Promise<void>;
  /**
   * Stop polling and wait for the jobs in flight to finish (SIGTERM drain); with `graceMs`, at most
   * that long, handing back the jobs still running. The first call's options apply.
   */
  stop(options?: ConsumerStopOptions): Promise<void>;
  isRunning(): boolean;
}
