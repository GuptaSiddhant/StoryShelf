import type { CaptureQueue, PollableJob } from "@storyshelf/core/adapter/capture-queue";
import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import {
  createDispatchJob,
  failCrashedCapture,
  InMemoryCaptureQueue,
  recoverStuckCaptures,
} from "@storyshelf/core/capture";
import type {
  CaptureDispatchJob,
  CaptureJobOptions,
  DispatchDeps,
  ForkedJobOutcome,
  RecoveryDeps,
  RecoveryResult,
} from "@storyshelf/core/capture";
import { DEFAULT_SCRATCH_DIR } from "@storyshelf/core/config";
import type { ShelfConfig, ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { BuildModel } from "@storyshelf/core/models";
import { recommendedBuildConcurrency } from "@storyshelf/core/utils";
import { captureMetrics, currentTraceparent } from "@storyshelf/observability";
import { createForkedQueue, shouldForkCapture } from "./capture-process.ts";
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

/**
 * Builds already alerted about, keyed by the build's last update. A sharded build settles one job
 * per shard and every one of them sees the failed build; only the first alerts. A retry rewrites
 * the build, so its next failure is a new key.
 */
const alerted = new Set<string>();

export function alreadyAlerted(build: { id: string; updatedAt: string }): boolean {
  const key = `${build.id}@${build.updatedAt}`;
  if (alerted.has(key)) {
    return true;
  }
  alerted.add(key);
  return false;
}

/** Alert admins when an in-process capture leaves its build failed. */
async function notifyCaptureFailed(
  options: ShelfOptions,
  config: ShelfConfig,
  logger: Logger,
  buildId: string,
): Promise<void> {
  const build = await new BuildModel(options.database).get(buildId);
  if (build?.status !== "failed" || alreadyAlerted(build)) {
    return;
  }
  await notifySystemWith(
    {
      db: options.database,
      config,
      ui: options.ui ?? {},
      logger,
      notifiers: options.notifications?.notifiers ?? [],
      notificationsConfig: options.notifications?.config,
    },
    "sys:capture-failed",
    { buildId, projectId: build.projectId, gitBranch: build.gitBranch },
  );
}

/**
 * Settle hook for jobs that ran in a forked child. A job the parent failed because the child kept
 * crashing on it was never recorded by the child, so its build (or shard) is failed here first, the
 * way an in-process failure would be; then admins are alerted from the build's own status.
 */
export function forkedSettleHook(
  dispatch: DispatchDeps,
  notify: (buildId: string) => Promise<void>,
): (job: PollableJob, outcome: ForkedJobOutcome) => Promise<void> {
  return async (job, outcome) => {
    if (outcome.crashed) {
      await failCrashedCapture(dispatch, job, outcome.error ?? "capture worker crashed");
    }
    await notify(job.buildId);
  };
}

/** The in-process queue, or a forked child fronting it when `testing.workerEntry` and the host allow. */
function pickProcessQueue(
  options: ShelfOptions,
  config: ShelfConfig,
  logger: Logger,
  inProcess: CaptureQueue,
  dispatch: DispatchDeps,
): CaptureQueue {
  const workerEntry = options.testing?.workerEntry;
  if (!workerEntry || !shouldForkCapture(options.testing, logger)) {
    return inProcess;
  }
  return createForkedQueue({
    workerEntry,
    concurrency: options.testing?.concurrency,
    shardSize: options.testing?.shardSize,
    imageEngine: options.testing?.images?.engine,
    diffThreads: options.testing?.compare?.threads,
    fallback: inProcess,
    // Notifications stay in this process; the build's own status says whether the capture failed.
    onSettled: forkedSettleHook(dispatch, async (buildId) => {
      await notifyCaptureFailed(options, config, logger, buildId);
    }),
    logger,
  });
}

/** Bind an enqueue hook to a queue. */
function enqueuerFor(queue: CaptureQueue): (buildId: string, reqId?: string) => Promise<void> {
  return async (buildId, reqId) => {
    await enqueueJob(queue, buildId, reqId);
  };
}

/**
 * Assemble the capture queue and its enqueue hook. A supplied (remote) queue
 * wins and any runner is ignored server-side: an external worker captures.
 * With only a runner, captures run in-process. With neither, builds stay
 * `pending` until a runner is added.
 */
export function setupCaptureQueue(
  options: ShelfOptions,
  config: ShelfConfig,
  gitHosts: GitHostProvider[],
  logger: Logger,
): QueueWiring {
  const { queue: remote, runner } = options.testing ?? {};
  if (remote) {
    return { queue: remote, enqueueCapture: enqueuerFor(remote) };
  }
  if (!runner) {
    return { queue: null, enqueueCapture: undefined };
  }
  return setupInProcessQueue(options, config, gitHosts, logger, runner);
}

/** In-process queue (optionally forked) running the dispatch job with recovery and stall handling. */
function setupInProcessQueue(
  options: ShelfOptions,
  config: ShelfConfig,
  gitHosts: GitHostProvider[],
  logger: Logger,
  runner: CaptureRunner,
): QueueWiring {
  // `normalizeShelfOptions` defaults scratchDir whenever a runner is set.
  const scratchDir = config.scratchDir ?? DEFAULT_SCRATCH_DIR;
  const captureQueueRef: { current: CaptureQueue | null } = { current: null };
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
    runner,
    scratchDir,
    viewports: config.viewports,
    logger,
    secret: credentialKeys(config),
    design: options.design,
    shardSize: options.testing?.shardSize,
    // The queue is built below, from these options; shards go back onto it.
    enqueue: async (job) => {
      await captureQueueRef.current?.enqueue(job);
    },
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
  const inProcessQueue = new InMemoryCaptureQueue({
    concurrency: options.testing?.concurrency ?? recommendedBuildConcurrency(),
    logger,
    leaseMs: CAPTURE_LEASE_MS,
    onStalled: createStalledHandler({ runner, recovery, logger }),
    runJob: async (job: CaptureDispatchJob, lease): Promise<void> => {
      await timedRunJob(async (dispatched) => await runJob(dispatched, lease), job);
      // In-process completions only: remote-queue workers own their own
      // alerting (the server never sees those outcomes).
      await notifyCaptureFailed(options, config, logger, job.buildId);
    },
  });
  const captureQueue = pickProcessQueue(options, config, logger, inProcessQueue, dispatchDeps);
  captureQueueRef.current = captureQueue;
  const enqueueCapture = enqueuerFor(captureQueue);
  const recoverStuck = async (): Promise<RecoveryResult> => await recoverStuckCaptures(recovery);
  return { queue: captureQueue, enqueueCapture, recoverStuck };
}
