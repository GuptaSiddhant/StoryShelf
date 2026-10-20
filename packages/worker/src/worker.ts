import type {
  CaptureQueue,
  PollableCaptureQueue,
  PollableJob,
} from "@storyshelf/core/adapter/capture-queue";
import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { DesignProvider } from "@storyshelf/core/adapter/design";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { createDispatchJob, sweepOrphanedScratch } from "@storyshelf/core/capture";
import type { CaptureJobOptions, DispatchDeps } from "@storyshelf/core/capture";
import type { ShelfCompareOptions, ShelfImagesOptions } from "@storyshelf/core/config";
import { configureImages, verifyImageEngine } from "@storyshelf/core/diff";
import { createShelfLogger, type Logger } from "@storyshelf/core/logger";
import { roundedTimings, runWithTimings } from "@storyshelf/core/utils";
import {
  baselines,
  buildLabels,
  builds,
  captureAttempts,
  captureLogs,
  projectStatusConfigs,
  projects,
  snapshots,
} from "@storyshelf/db-sqlite/schema";
import { resolveWorkerConfig, type WorkerConfig } from "./config.ts";
import { idleDelayMs, isFastEmptyPoll } from "./idle.ts";
import { LeaseLostError, startLease, type ExtendLease } from "./lease.ts";

/** Table handles required by the worker (orchestrator + dispatch). */
export type WorkerTables = {
  projects: typeof projects;
  builds: typeof builds;
  buildLabels: typeof buildLabels;
  snapshots: typeof snapshots;
  baselines: typeof baselines;
  projectStatusConfigs: typeof projectStatusConfigs;
  captureAttempts: typeof captureAttempts;
  captureLogs: typeof captureLogs;
};

/** Options for creating a capture worker. */
export interface WorkerOptions {
  /** Queue to poll; must implement poll/ack/nack for remote queues. */
  queue: CaptureQueue | PollableCaptureQueue;
  /** Optional poll override (for testing or custom transports). */
  poll?: (options?: { waitMs?: number }) => Promise<PollableJob | null>;
  /** Optional ack override. */
  ack?: (job: PollableJob) => Promise<void>;
  /** Optional nack override. */
  nack?: (job: PollableJob, options?: { requeue?: boolean; delayMs?: number }) => Promise<void>;
  /** Optional lease-renewal override; defaults to `queue.extend` when present. */
  extend?: ExtendLease;
  /**
   * Called whenever a running capture makes progress (each attempt-log line). The forked child
   * uses it to renew the job's lease in the parent, so a hung capture is noticed.
   */
  onProgress?: (job: PollableJob) => void;
  /** Database adapter (same as server). */
  db: DatabaseAdapter;
  /** Table handles; defaults to sqlite schema handles. */
  tables?: WorkerTables;
  /** Storage adapter (same as server). */
  storage: StorageAdapter;
  /** Pure capture runner (Playwright). */
  runner: CaptureRunner;
  /** Scratch directory for storybook extraction. */
  scratchDir: string;
  /** Git host providers for status fanout. */
  gitHosts?: GitHostProvider[];
  /** Design providers validating declared design links during capture. */
  design?: DesignProvider[];
  /**
   * Image engine, same as the server's `images` option. Set it (or `STORYSHELF_IMAGE_ENGINE`) to
   * match the server so remote workers diff with the same codec; `start()` fails when the engine
   * cannot load.
   */
  images?: ShelfImagesOptions;
  /** Diff pool size, same as the server's `compare` option. */
  compare?: ShelfCompareOptions;
  /** Server secret for webhook decryption. */
  secret?: string;
  /** Logger for worker diagnostics. */
  logger?: Logger;
  /** Worker tuning. */
  config?: WorkerConfig;
  /** Viewports to capture (defaults to DEFAULT_VIEWPORTS). */
  viewports?: CaptureJobOptions["viewports"];
  /**
   * Split big builds across the queue: captures per shard. A build of up to twice this size still
   * runs as one job. Unset keeps every build in one job.
   */
  shardSize?: number;
}

/** Handle returned by `createCaptureWorker`. */
export interface WorkerHandle {
  /** Start polling and processing jobs. Resolves when stopped. */
  start(): Promise<void>;
  /** Signal the worker to stop and wait for in-flight jobs. */
  stop(): Promise<void>;
  /** Whether the worker is currently running. */
  isRunning(): boolean;
}

/** Whether a polled job carries the minimum shape to execute. */
function isValidJob(job: PollableJob): boolean {
  return typeof job.buildId === "string" && job.buildId.length > 0;
}

export function createCaptureWorker(options: WorkerOptions): WorkerHandle {
  // Only touch the process-wide image settings when asked, so a worker created next to an app in
  // one process does not undo the app's own `images`/`compare` options.
  if (options.images || options.compare) {
    configureImages({ engine: options.images?.engine, threads: options.compare?.threads });
  }
  const config = resolveWorkerConfig(options.config);
  const tables: WorkerTables = options.tables ?? {
    projects,
    builds,
    buildLabels,
    snapshots,
    baselines,
    projectStatusConfigs,
    captureAttempts,
    captureLogs,
  };
  const gitHosts = options.gitHosts ?? [];
  const logger = options.logger ?? createShelfLogger();

  const jobOptions: CaptureJobOptions = {
    db: options.db,
    tables: {
      projects: tables.projects,
      builds: tables.builds,
      buildLabels: tables.buildLabels,
      snapshots: tables.snapshots,
      baselines: tables.baselines,
      captureAttempts: tables.captureAttempts,
      captureLogs: tables.captureLogs,
    },
    storage: options.storage,
    runner: options.runner,
    scratchDir: options.scratchDir,
    viewports: options.viewports,
    logger,
    secret: options.secret,
    design: options.design,
    shardSize: options.shardSize,
    enqueue: async (job) => {
      await options.queue.enqueue(job);
    },
  };

  const dispatchDeps: DispatchDeps = {
    db: options.db,
    tables: {
      projects: tables.projects,
      builds: tables.builds,
      buildLabels: tables.buildLabels,
      snapshots: tables.snapshots,
      projectStatusConfigs: tables.projectStatusConfigs,
      captureAttempts: tables.captureAttempts,
      captureLogs: tables.captureLogs,
    },
    jobOptions,
    gitHosts,
    secret: options.secret,
    logger,
    maxRetries: config.maxRetries,
  };

  const runJob = createDispatchJob(dispatchDeps);

  const pollable = options.queue as PollableCaptureQueue;
  pollable.setLogger?.(logger.child({ component: pollable.metadata.kind }));
  const doPoll =
    options.poll ??
    ((): ((o?: { waitMs?: number }) => Promise<PollableJob | null>) => {
      if (typeof pollable.poll === "function") {
        return pollable.poll.bind(pollable) as (o?: {
          waitMs?: number;
        }) => Promise<PollableJob | null>;
      }
      return async () => null;
    })();
  const doAck =
    options.ack ??
    (async (job: PollableJob): Promise<void> => {
      if (typeof pollable.ack === "function") {
        await pollable.ack(job);
      }
    });
  const doNack =
    options.nack ??
    (async (
      job: PollableJob,
      nackOpts?: { requeue?: boolean; delayMs?: number },
    ): Promise<void> => {
      if (typeof pollable.nack === "function") {
        await pollable.nack(job, nackOpts);
      } else if (nackOpts?.requeue === false) {
        await doAck(job);
      }
    });

  const doExtend: ExtendLease | undefined =
    options.extend ??
    (typeof pollable.extend === "function" ? pollable.extend.bind(pollable) : undefined);

  let running = false;
  let loopPromise: Promise<void> | null = null;
  let stopResolve: (() => void) | null = null;
  let startFailure: Error | null = null;
  const inFlight = new Set<Promise<void>>();
  let concurrencyRunning = 0;
  const waiting: (() => void)[] = [];

  async function acquire(): Promise<void> {
    if (concurrencyRunning < config.concurrency) {
      concurrencyRunning += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
    await acquire();
  }

  function release(): void {
    concurrencyRunning -= 1;
    const next = waiting.shift();
    if (next) {
      next();
    }
  }

  function backoffMs(attempts: number): number {
    return Math.min(30_000, config.backoffMs * 2 ** attempts);
  }

  /** Drop a malformed job without retries so poison payloads never loop. */
  async function dropPoisonJob(job: PollableJob): Promise<void> {
    logger?.warn({ buildId: job.buildId, attempts: job.attempts }, "dropping malformed queue job");
    try {
      await doAck(job);
    } catch (error) {
      logger?.error({ err: error }, "failed to ack malformed job");
    }
  }

  /** Run the capture while a heartbeat keeps the job's queue lease alive. */
  async function runWithLease(job: PollableJob): Promise<void> {
    const lease = startLease(job, doExtend, logger?.child({ buildId: job.buildId }));
    const onProgress = options.onProgress;
    const run = runJob(
      {
        buildId: job.buildId,
        shard: job.shard,
        attempts: job.attempts,
        reqId: job.reqId,
        traceparent: job.traceparent,
      },
      onProgress ? { touch: (): void => onProgress(job) } : undefined,
    );
    try {
      await (lease ? Promise.race([run, lease.lost]) : run);
    } finally {
      lease?.stop();
      run.catch(() => {});
    }
  }

  /** Another consumer owns the message now: stop our render, leave ack/nack to them. */
  async function abandonLostJob(job: PollableJob, error: LeaseLostError): Promise<void> {
    logger?.warn({ err: error, buildId: job.buildId }, "queue lease lost, aborting capture");
    await options.runner.cancel(job.buildId).catch(() => {});
  }

  async function processJob(job: PollableJob): Promise<void> {
    const jobLogger = logger?.child({ buildId: job.buildId, reqId: job.reqId });
    await acquire();
    const execution = (async (): Promise<void> => {
      try {
        jobLogger?.info("worker picked up job");
        // traceparent rides along: executeCaptureJob continues the trace.
        const { timings } = await runWithTimings(async () => {
          await runWithLease(job);
        });
        jobLogger?.info({ timings: roundedTimings(timings) }, "worker job timings");
        await doAck(job);
        jobLogger?.info("worker completed job");
      } catch (error) {
        if (error instanceof LeaseLostError) {
          await abandonLostJob(job, error);
          return;
        }
        const attempts = job.attempts ?? 0;
        if (attempts < config.maxRetries) {
          const delay = backoffMs(attempts);
          try {
            await doNack(job, { requeue: true, delayMs: delay });
          } catch (nackError) {
            jobLogger?.error({ err: nackError }, "failed to nack job for retry");
          }
          jobLogger?.warn({ err: error, attempts, delayMs: delay }, "capture failed, requeued");
        } else {
          try {
            await doAck(job);
          } catch (ackError) {
            try {
              await doNack(job, { requeue: false });
            } catch {
              jobLogger?.error({ err: ackError }, "failed to ack permanently failed job");
            }
          }
          jobLogger?.error({ err: error, attempts }, "capture permanently failed");
        }
      } finally {
        release();
      }
    })();
    // Track in-flight without blocking loop
    const tracked = execution
      .catch(() => {})
      .finally(() => {
        inFlight.delete(tracked);
      });
    inFlight.add(tracked);
  }

  let wakeIdle: (() => void) | null = null;

  /** Interruptible sleep so `stop()` never waits out a backoff. */
  async function idleSleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        wakeIdle = null;
        resolve();
      }
      wakeIdle = done;
    });
  }

  /** Poll once; undefined means the poll failed (already logged and backed off). */
  async function pollOnce(waitMs: number): Promise<PollableJob | null | undefined> {
    try {
      return await doPoll({ waitMs });
    } catch (error) {
      logger?.error({ err: error }, "poll failed");
      await idleSleep(1000);
      return undefined;
    }
  }

  /** Check the image engine before the first poll; when it cannot load, `start()` ends with the error. */
  async function engineLoads(): Promise<boolean> {
    try {
      await verifyImageEngine();
      return true;
    } catch (error) {
      startFailure = error instanceof Error ? error : new Error(String(error));
      logger.error({ err: startFailure }, "image engine cannot load; capture worker stopping");
      running = false;
      stopResolve?.();
      stopResolve = null;
      return false;
    }
  }

  async function loop(): Promise<void> {
    if (!(await engineLoads())) {
      return;
    }
    const waitMs = config.waitTimeSeconds * 1000;
    let emptyStreak = 0;
    while (running) {
      const startedAt = Date.now();
      const job = await pollOnce(waitMs);
      if (job === undefined || !running) {
        continue;
      }
      if (!job) {
        // Queues without long-poll return instantly; back off instead of spinning.
        emptyStreak = isFastEmptyPoll(Date.now() - startedAt) ? emptyStreak + 1 : 0;
        if (emptyStreak > 0) {
          await idleSleep(idleDelayMs(emptyStreak));
        }
        continue;
      }
      emptyStreak = 0;
      if (!isValidJob(job)) {
        await dropPoisonJob(job);
        continue;
      }
      await processJob(job);
    }
  }

  return {
    isRunning(): boolean {
      return running;
    },
    async start(): Promise<void> {
      if (running) {
        return;
      }
      running = true;
      // Not awaited before the loop: `start()` must reach its stop hook synchronously so an early
      // `stop()` still resolves it. Settled before start() returns.
      const sweep = sweepOrphanedScratch(options.scratchDir, { logger }).catch((error: unknown) => {
        logger.warn({ err: error }, "scratch sweep failed");
      });
      loopPromise = loop();
      // Keep start() pending until stop() is called; loop() runs in background
      await new Promise<void>((resolve) => {
        stopResolve = resolve;
      });
      // Wait for loop to exit and in-flight to drain
      running = false;
      if (loopPromise !== null) {
        await loopPromise.catch(() => {});
      }
      if (inFlight.size > 0) {
        await Promise.all([...inFlight]).catch(() => {});
      }
      await sweep;
      if (startFailure) {
        const failure = startFailure;
        startFailure = null;
        throw failure;
      }
    },
    async stop(): Promise<void> {
      if (!running && loopPromise === null) {
        return;
      }
      running = false;
      wakeIdle?.();
      if (stopResolve) {
        stopResolve();
        stopResolve = null;
      }
      if (loopPromise !== null) {
        await loopPromise.catch(() => {});
      }
      if (inFlight.size > 0) {
        await Promise.all([...inFlight]).catch(() => {});
      }
    },
  };
}
