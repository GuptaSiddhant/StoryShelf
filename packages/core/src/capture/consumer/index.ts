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
import type { CaptureJobKind } from "../../schema/capture-job.ts";
import { recommendedBuildConcurrency } from "../../utils/resources.ts";
import { startPollLoop, type PollLoop } from "../db-queue/poll-loop.ts";
import { REAL_TIMERS, type QueueTimers } from "../db-queue/timers.ts";
import type { DatabaseCaptureQueue } from "../db-queue/types.ts";
import { createCaptureHandler } from "./capture-handler.ts";
import { startSlotLoop } from "./loop.ts";
import { startQueueSampling } from "./metrics.ts";
import {
  DEFAULT_BACKOFF_MS,
  DEFAULT_MAX_JOB_SECONDS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_WAIT_TIME_SECONDS,
} from "./retry.ts";
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
  claimHandledKinds(options.queue, rt);
  const slots = options.config?.concurrency ?? recommendedBuildConcurrency();
  let active: ActiveSession | null = null;
  return {
    isRunning: () => active !== null,
    start: async () => {
      if (active !== null) {
        return;
      }
      const session = openSession({ options, rt, slots });
      active = session;
      await session.done.finally(() => {
        active = null;
      });
    },
    stop: async (stopOptions) => {
      active?.requestStop();
      await drain(
        active?.done.catch(() => {}),
        stopOptions?.graceMs,
        {
          timers: options.timers ?? REAL_TIMERS,
          handBack: () => {
            active?.giveUp();
          },
          logger,
        },
      );
    },
  };
}

/** One running start-to-drain session and the two ways to end it early. */
interface ActiveSession {
  done: Promise<void>;
  /** Stop polling; the session ends once the jobs in flight have. */
  requestStop(): void;
  /** The drain's time is up: running jobs are cancelled and handed back to the queue. */
  giveUp(): void;
}

function openSession(c: Pick<Consuming, "options" | "rt" | "slots">): ActiveSession {
  const stopped = Promise.withResolvers<null>();
  const handBack = Promise.withResolvers<null>();
  let stopRequested = false;
  c.rt.handBack = handBack.promise.then(() => {});
  return {
    done: consume({ ...c, stopped: stopped.promise, isStopped: () => stopRequested }),
    requestStop: () => {
      stopRequested = true;
      stopped.resolve(null);
    },
    giveUp: () => {
      handBack.resolve(null);
    },
  };
}

/** Share of the grace kept to hand jobs back (at most), once the drain has had the rest. */
const HAND_BACK_RESERVE_MS = 2000;

/** Wait for the drained session: without a grace for as long as it takes, else {@link drainWithin}. */
async function drain(
  running: Promise<void> | undefined,
  graceMs: number | undefined,
  ctx: { timers: QueueTimers; handBack: () => void; logger: Logger },
): Promise<void> {
  if (running === undefined) {
    return;
  }
  await (graceMs === undefined ? running : drainWithin(running, graceMs, ctx));
}

/**
 * Wait for `running` (the drained session) for the grace minus a reserve, then hand the jobs still
 * running back and wait for that for the reserve. Resolves by the end of the grace either way.
 */
async function drainWithin(
  running: Promise<void>,
  graceMs: number,
  ctx: { timers: QueueTimers; handBack: () => void; logger: Logger },
): Promise<void> {
  const reserve = Math.min(HAND_BACK_RESERVE_MS, Math.max(0, graceMs) / 2);
  if (await settledWithin(running, graceMs - reserve, ctx.timers)) {
    return;
  }
  ctx.logger.warn({ graceMs }, "shutdown drain timed out; handing running jobs back");
  ctx.handBack();
  if (!(await settledWithin(running, reserve, ctx.timers))) {
    ctx.logger.warn("jobs were not all handed back in time; their leases recover them");
  }
}

/** True when `work` settled within `ms`. */
async function settledWithin(
  work: Promise<void>,
  ms: number,
  timers: QueueTimers,
): Promise<boolean> {
  const timedOut = Promise.withResolvers<false>();
  const handle = timers.setTimeout(
    () => {
      timedOut.resolve(false);
    },
    Math.max(0, ms),
  );
  try {
    return await Promise.race([work.then(() => true as const), timedOut.promise]);
  } finally {
    timers.clearTimeout(handle);
  }
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

/** Claim only the kinds this consumer can run: an old copy never takes a newer kind (ADR 0053). */
function claimHandledKinds(queue: PollableCaptureQueue, rt: JobRuntime): void {
  if (isDatabaseQueue(queue)) {
    queue.claimOnly([...rt.handlers.keys()] as CaptureJobKind[]);
  }
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
    maxJobMs: (options.config?.maxJobSeconds ?? DEFAULT_MAX_JOB_SECONDS) * 1000,
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
      onShardRepeated: (event) => {
        options.metrics?.shardRepeated?.(event);
      },
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
