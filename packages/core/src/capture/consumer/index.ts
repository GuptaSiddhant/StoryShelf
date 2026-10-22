/**
 * The capture consumer (ADR 0006, decisions 4 and 11): consumes any `PollableCaptureQueue` (the
 * database queue, the IPC queue of a forked capture child) and runs a handler per
 * job `kind`. A slot is taken before polling, a failing job is retried with exponential backoff
 * until its last attempt, the lease is kept by the job's progress, a lost lease or a cancel stops
 * the run, and `stop()` drains the jobs in flight.
 *
 * ```ts
 * const consumer = createCaptureConsumer({
 *   queue: createDatabaseCaptureQueue(db),
 *   capture: { db, storage, runner, scratchDir },
 *   config: { concurrency: 2 },
 * });
 * consumer.start(); // resolves after stop()
 * // on SIGTERM: await consumer.stop();
 * ```
 */
import type { PollableCaptureQueue } from "../../adapters/capture-queue.ts";
import { createShelfLogger, type Logger } from "../../logger.ts";
import { recommendedBuildConcurrency } from "../../utils/resources.ts";
import { startPollLoop, type PollLoop } from "../db-queue/poll-loop.ts";
import { REAL_TIMERS } from "../db-queue/timers.ts";
import type { DatabaseCaptureQueue } from "../db-queue/types.ts";
import { createCaptureHandler } from "./capture-handler.ts";
import { startSlotLoop } from "./loop.ts";
import { startQueueSampling } from "./metrics.ts";
import { DEFAULT_BACKOFF_MS, DEFAULT_MAX_RETRIES, DEFAULT_WAIT_TIME_SECONDS } from "./retry.ts";
import { runJob, type JobRuntime } from "./run-job.ts";
import { applyImageSettings, ensureImageEngine, sweepScratch } from "./startup.ts";
import type {
  CaptureConsumer,
  CaptureConsumerOptions,
  ConsumerJob,
  JobHandlers,
  KindHandler,
} from "./types.ts";

/** Create a consumer of `options.queue`; nothing runs until `start()`. */
export function createCaptureConsumer(options: CaptureConsumerOptions): CaptureConsumer {
  applyImageSettings(options.images, options.compare);
  const logger = options.logger ?? createShelfLogger();
  options.queue.setLogger?.(logger.child({ component: options.queue.metadata.kind }));
  const rt = buildRuntime(options, logger);
  const slots = options.config?.concurrency ?? recommendedBuildConcurrency();
  let session: Promise<void> | null = null;
  let requestStop: (() => void) | null = null;
  let stopRequested = false;
  return {
    isRunning: () => session !== null,
    start: async () => {
      if (session !== null) {
        return;
      }
      const stopped = Promise.withResolvers<null>();
      stopRequested = false;
      requestStop = (): void => {
        stopRequested = true;
        stopped.resolve(null);
      };
      session = consume({
        options,
        rt,
        slots,
        stopped: stopped.promise,
        isStopped: () => stopRequested,
      });
      await session.finally(() => {
        session = null;
      });
    },
    stop: async () => {
      requestStop?.();
      await session?.catch(() => {});
    },
  };
}

interface Consuming {
  options: CaptureConsumerOptions;
  rt: JobRuntime;
  slots: number;
  /** Resolves when `stop()` was called. */
  stopped: Promise<null>;
  isStopped: () => boolean;
}

/** One start-to-drain session: sweep, check the engine, poll until stopped, drain. */
async function consume(c: Consuming): Promise<void> {
  const { options, rt } = c;
  const sweep = sweepScratch(options.scratchDir ?? options.capture?.scratchDir, rt.logger);
  try {
    await ensureImageEngine(rt.logger);
    if (!c.isStopped()) {
      await pollUntilStopped(c);
    }
  } finally {
    await sweep;
  }
}

/** Poll (and sample the queue) until `stop()`, then drain the jobs in flight. */
async function pollUntilStopped(c: Consuming): Promise<void> {
  const { options, rt } = c;
  const loop = startLoop(c);
  const stopSampling = startQueueSampling(options.queue, options.metrics, {
    now: rt.now,
    timers: rt.timers ?? REAL_TIMERS,
    logger: rt.logger,
  });
  await c.stopped;
  stopSampling();
  await loop.stop();
}

/** The database queue sets its own cadence; any other queue is polled in a slot loop. */
function startLoop(c: Consuming): PollLoop {
  const { options, rt } = c;
  const run = async (job: ConsumerJob): Promise<void> => {
    await runJob(rt, job);
  };
  if (isDatabaseQueue(options.queue)) {
    return startPollLoop({
      queue: options.queue,
      slots: c.slots,
      run,
      logger: rt.logger,
      now: rt.now,
      ...(options.cadence === undefined ? {} : { cadence: options.cadence }),
      ...(options.random === undefined ? {} : { random: options.random }),
    });
  }
  const waitSeconds = options.config?.waitTimeSeconds ?? DEFAULT_WAIT_TIME_SECONDS;
  return startSlotLoop({
    queue: options.queue,
    slots: c.slots,
    waitMs: waitSeconds * 1000,
    run,
    logger: rt.logger,
    now: rt.now,
    timers: options.timers,
  });
}

function isDatabaseQueue(queue: PollableCaptureQueue): queue is DatabaseCaptureQueue {
  return typeof (queue as Partial<DatabaseCaptureQueue>).waitForWork === "function";
}

function buildRuntime(options: CaptureConsumerOptions, logger: Logger): JobRuntime {
  return {
    queue: options.queue,
    handlers: registry(options, logger),
    maxRetries: options.config?.maxRetries ?? DEFAULT_MAX_RETRIES,
    backoffMs: options.config?.backoffMs ?? DEFAULT_BACKOFF_MS,
    logger,
    metrics: options.metrics,
    onProgress: options.onProgress,
    now: options.now ?? Date.now,
    timers: options.timers,
    lease: options.lease,
  };
}

/** `capture` wired to the core dispatch, then the explicit handlers on top. */
function registry(options: CaptureConsumerOptions, logger: Logger): Map<string, KindHandler> {
  const all: JobHandlers = {};
  if (options.capture !== undefined) {
    all.capture = createCaptureHandler({
      enqueue: async (job) => {
        await options.queue.enqueue(job);
      },
      maxRetries: options.config?.maxRetries,
      ...options.capture,
      logger,
    });
  }
  Object.assign(all, options.handlers);
  const map = new Map<string, KindHandler>();
  for (const [kind, handler] of Object.entries(all)) {
    if (handler !== undefined) {
      map.set(kind, typeof handler === "function" ? { run: handler } : handler);
    }
  }
  return map;
}

export {
  captureDispatchDeps,
  createCaptureHandler,
  type CaptureHandlerOptions,
} from "./capture-handler.ts";
export { idleDelayMs, isFastEmptyPoll, MIN_BLOCKING_POLL_MS } from "./idle.ts";
export {
  DEFAULT_SAMPLE_MS,
  sampleQueue,
  type ConsumerMetrics,
  type JobFinishedEvent,
  type JobOutcome,
  type QueueSample,
} from "./metrics.ts";
export {
  backoffDelayMs,
  DEFAULT_BACKOFF_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_WAIT_TIME_SECONDS,
  isFinalAttempt,
  MAX_BACKOFF_MS,
  type RetryConfig,
} from "./retry.ts";
export type {
  CaptureConsumer,
  CaptureConsumerOptions,
  ConsumerConfig,
  ConsumerJob,
  JobHandlers,
  JobRunContext,
  KindHandler,
} from "./types.ts";
