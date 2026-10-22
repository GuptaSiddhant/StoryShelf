/** Option and handler types of the capture consumer. */
import type { PollableCaptureQueue, PollableJob } from "../../adapters/capture-queue.ts";
import type { ShelfCompareOptions, ShelfImagesOptions } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import type { CaptureJobKind } from "../../schema/capture-job.ts";
import type { PollCadence } from "../db-queue/cadence.ts";
import type { QueueTimers } from "../db-queue/timers.ts";
import type { CaptureHandlerOptions } from "./capture-handler.ts";
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
};

/** What a handler gets besides the job. */
export interface JobRunContext {
  /** Logger scoped to the job (`buildId`, `jobId`, `kind`). */
  logger: Logger;
  /** Report progress: renews the job's lease (throttled) and tells the host (`onProgress`). */
  touch(): void;
}

/** The code that runs jobs of one kind. */
export interface KindHandler {
  /** Run the job; resolve to ack it, reject to retry (or fail it on its last attempt). */
  run(job: ConsumerJob, context: JobRunContext): Promise<void>;
  /** Whether the job is well-formed; a job that is not is failed without retries. */
  accepts?(job: ConsumerJob): boolean;
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
  /** Capture jobs: wires the `capture` kind to the core dispatch (shorthand for `handlers.capture`). */
  capture?: Omit<CaptureHandlerOptions, "enqueue" | "logger"> &
    Partial<Pick<CaptureHandlerOptions, "enqueue">>;
  /** Handlers by kind; `publish` and `notify` register here. Overrides `capture`'s. */
  handlers?: JobHandlers;
  config?: ConsumerConfig;
  /** Scratch directory swept at start; defaults to `capture.scratchDir`. */
  scratchDir?: string;
  /** Image engine, as the server's `images` option; `start()` fails when it cannot load. */
  images?: ShelfImagesOptions;
  /** Diff pool size, as the server's `compare` option. */
  compare?: ShelfCompareOptions;
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

/** Handle returned by {@link createCaptureConsumer}. */
export interface CaptureConsumer {
  /** Start consuming. Resolves once stopped and drained; rejects when the image engine cannot load. */
  start(): Promise<void>;
  /** Stop polling and wait for the jobs in flight to finish (SIGTERM drain). */
  stop(): Promise<void>;
  isRunning(): boolean;
}
