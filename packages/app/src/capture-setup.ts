import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import {
  createDispatchJob,
  InMemoryCaptureQueue,
  recoverStuckCaptures,
} from "@storyshelf/core/capture";
import type {
  CaptureDispatchJob,
  CaptureJobOptions,
  DispatchDeps,
  RecoveryDeps,
  RecoveryResult,
} from "@storyshelf/core/capture";
import { DEFAULT_SCRATCH_DIR } from "@storyshelf/core/config";
import type { ShelfConfig, ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { BuildModel } from "@storyshelf/core/models";
import { recommendedBuildConcurrency } from "@storyshelf/core/utils";
import { captureMetrics, currentTraceparent } from "@storyshelf/observability";
import { credentialKeys } from "./credential-keys.ts";
import { notifySystemWith } from "./notify.ts";
import { CAPTURE_LEASE_MS, createStalledHandler } from "./stalled-capture.ts";

/**
 * Wiring for the capture queue: the queue instance (if any) and a helper
 * to enqueue a build for rendering. When no `captureRunner` is configured
 * both are null/undefined and builds remain `pending` until a runner is added.
 */
export interface QueueWiring {
  queue: CaptureQueue | null;
  enqueueCapture: ((buildId: string, reqId?: string) => Promise<void>) | undefined;
  /**
   * Boot sweep for builds a restart left in `capturing` (requeue once, else fail).
   * Only set for the in-process queue; remote queues redeliver on their own.
   */
  recoverStuck?: () => Promise<RecoveryResult>;
}

/** Enqueue a build, continuing the active request trace when present. */
async function enqueueJob(queue: CaptureQueue, buildId: string, reqId?: string): Promise<void> {
  const traceparent = currentTraceparent();
  await queue.enqueue({ buildId, reqId, ...(traceparent ? { traceparent } : {}) });
}

/** Wrap the dispatch job with duration + outcome metrics. */
async function timedRunJob(
  runJob: (job: CaptureDispatchJob) => Promise<void>,
  job: CaptureDispatchJob,
): Promise<void> {
  const instruments = captureMetrics();
  const start = performance.now();
  try {
    await runJob(job);
  } catch (error) {
    instruments.jobsFailed.add(1);
    instruments.jobDuration.record(performance.now() - start);
    throw error;
  }
  instruments.jobsCompleted.add(1);
  instruments.jobDuration.record(performance.now() - start);
}

/** Alert admins when an in-process capture leaves its build failed. */
async function notifyCaptureFailed(
  options: ShelfOptions,
  config: ShelfConfig,
  logger: Logger,
  buildId: string,
): Promise<void> {
  const build = await new BuildModel(options.database).get(buildId);
  if (build?.status !== "failed") {
    return;
  }
  await notifySystemWith(
    {
      db: options.database,
      config,
      ui: options.ui ?? {},
      logger,
      notifiers: options.notifiers ?? [],
    },
    "sys:capture-failed",
    { buildId, projectId: build.projectId, gitBranch: build.gitBranch },
  );
}

/** Assemble the capture queue and its enqueue hook. */
export function setupCaptureQueue(
  options: ShelfOptions,
  config: ShelfConfig,
  gitHosts: GitHostProvider[],
  logger: Logger,
): QueueWiring {
  if (!options.capture?.queue && !options.capture?.runner) {
    return { queue: null, enqueueCapture: undefined };
  }
  if (options.capture?.queue) {
    const queue = options.capture?.queue;
    const enqueueCapture = async (buildId: string, reqId?: string): Promise<void> => {
      await enqueueJob(queue, buildId, reqId);
    };
    if (!options.capture?.runner) {
      return { queue: options.capture?.queue, enqueueCapture };
    }
    // Both queue and runner supplied: runner is ignored server-side for remote queues;
    // enqueue goes to the supplied queue and capture is handled by an external worker.
    if (!config.scratchDir) {
      return { queue: options.capture?.queue, enqueueCapture };
    }
    // If scratchDir is set with both, still prefer the supplied queue; no in-memory queue needed.
    return { queue: options.capture?.queue, enqueueCapture };
  }
  if (!options.capture?.runner) {
    return { queue: null, enqueueCapture: undefined };
  }
  // `normalizeShelfOptions` defaults scratchDir whenever a runner is set.
  const scratchDir = config.scratchDir ?? DEFAULT_SCRATCH_DIR;
  const jobOptions: CaptureJobOptions = {
    db: options.database,
    tables: {
      projects: options.database.tables.projects,
      builds: options.database.tables.builds,
      buildLabels: options.database.tables.buildLabels,
      snapshots: options.database.tables.snapshots,
      baselines: options.database.tables.baselines,
      captureAttempts: options.database.tables.captureAttempts,
      captureLogs: options.database.tables.captureLogs,
    },
    storage: options.storage,
    runner: options.capture?.runner,
    scratchDir,
    viewports: config.viewports,
    logger,
    secret: credentialKeys(config),
    design: options.design,
  };
  const dispatchDeps: DispatchDeps = {
    db: options.database,
    tables: {
      projects: options.database.tables.projects,
      builds: options.database.tables.builds,
      buildLabels: options.database.tables.buildLabels,
      snapshots: options.database.tables.snapshots,
      projectStatusConfigs: options.database.tables.projectStatusConfigs,
      captureAttempts: options.database.tables.captureAttempts,
      captureLogs: options.database.tables.captureLogs,
    },
    jobOptions,
    gitHosts,
    secret: credentialKeys(config),
    logger,
  };
  const runJob = createDispatchJob(dispatchDeps);
  const recovery: RecoveryDeps = {
    deps: dispatchDeps,
    enqueue: async (buildId) => {
      await enqueueCapture(buildId);
    },
  };
  const captureQueue =
    options.capture?.queue ??
    new InMemoryCaptureQueue({
      concurrency: options.capture?.concurrency ?? recommendedBuildConcurrency(),
      logger,
      leaseMs: CAPTURE_LEASE_MS,
      onStalled: createStalledHandler({ runner: options.capture?.runner, recovery, logger }),
      runJob: async (job: CaptureDispatchJob, lease): Promise<void> => {
        await timedRunJob(async (dispatched) => await runJob(dispatched, lease), job);
        // In-process completions only: remote-queue workers own their own
        // alerting (the server never sees those outcomes).
        await notifyCaptureFailed(options, config, logger, job.buildId);
      },
    });
  const enqueueCapture = async (buildId: string, reqId?: string): Promise<void> => {
    await enqueueJob(captureQueue, buildId, reqId);
  };
  const recoverStuck = async (): Promise<RecoveryResult> => await recoverStuckCaptures(recovery);
  return { queue: captureQueue, enqueueCapture, recoverStuck };
}
