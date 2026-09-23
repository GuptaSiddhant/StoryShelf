import type {
  CaptureQueue,
  PollableCaptureQueue,
  PollableJob,
} from "@storyshelf/core/adapter/capture-queue";
import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { createDispatchJob } from "@storyshelf/core/capture";
import type { CaptureJobOptions, DispatchDeps } from "@storyshelf/core/capture";
import { createShelfLogger, type Logger } from "@storyshelf/core/logger";
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
  /** Server secret for webhook decryption. */
  secret?: string;
  /** Logger for worker diagnostics. */
  logger?: Logger;
  /** Worker tuning. */
  config?: WorkerConfig;
  /** Viewports to capture (defaults to DEFAULT_VIEWPORTS). */
  viewports?: CaptureJobOptions["viewports"];
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

export function createCaptureWorker(options: WorkerOptions): WorkerHandle {
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

  let running = false;
  let loopPromise: Promise<void> | null = null;
  let stopResolve: (() => void) | null = null;
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

  async function processJob(job: PollableJob): Promise<void> {
    const jobLogger = logger?.child({ buildId: job.buildId, reqId: job.reqId });
    await acquire();
    const execution = (async (): Promise<void> => {
      try {
        jobLogger?.info("worker picked up job");
        await runJob({ buildId: job.buildId, reqId: job.reqId });
        await doAck(job);
        jobLogger?.info("worker completed job");
      } catch (error) {
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

  async function loop(): Promise<void> {
    const waitMs = config.waitTimeSeconds * 1000;
    while (running) {
      let job: PollableJob | null = null;
      try {
        job = await doPoll({ waitMs });
      } catch (error) {
        logger?.error({ err: error }, "poll failed");
        // Backoff on poll error
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            resolve();
          }, 1000);
        });
        continue;
      }
      if (!running) {
        break;
      }
      if (!job) {
        // No job: brief pause to avoid tight loop when waitMs=0
        if (waitMs === 0) {
          await new Promise<void>((resolve) => {
            setTimeout(() => {
              resolve();
            }, 500);
          });
        }
        continue;
      }
      // Check if we know this build already failed permanently? Attempts already handled in processJob.
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
    },
    async stop(): Promise<void> {
      if (!running && loopPromise === null) {
        return;
      }
      running = false;
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
