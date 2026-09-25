import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import { createDispatchJob, InMemoryCaptureQueue } from "@storyshelf/core/capture";
import type { CaptureJobOptions } from "@storyshelf/core/capture";
import type { ShelfConfig, ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";

/**
 * Wiring for the capture queue: the queue instance (if any) and a helper
 * to enqueue a build for rendering. When no `captureRunner` is configured
 * both are null/undefined and builds remain `pending` until a runner is added.
 */
export interface QueueWiring {
  queue: CaptureQueue | null;
  enqueueCapture: ((buildId: string, reqId?: string) => Promise<void>) | undefined;
}

/** Assemble the capture queue and its enqueue hook. */
export function setupCaptureQueue(
  options: ShelfOptions,
  config: ShelfConfig,
  gitHosts: GitHostProvider[],
  logger: Logger,
): QueueWiring {
  if (!options.captureQueue && !options.captureRunner) {
    return { queue: null, enqueueCapture: undefined };
  }
  if (options.captureQueue) {
    const queue = options.captureQueue;
    const enqueueCapture = async (buildId: string, reqId?: string): Promise<void> => {
      await queue.enqueue({ buildId, reqId });
    };
    if (!options.captureRunner) {
      return { queue: options.captureQueue, enqueueCapture };
    }
    // Both queue and runner supplied: runner is ignored server-side for remote queues;
    // enqueue goes to the supplied queue and capture is handled by an external worker.
    if (!config.scratchDir) {
      return { queue: options.captureQueue, enqueueCapture };
    }
    // If scratchDir is set with both, still prefer the supplied queue; no in-memory queue needed.
    return { queue: options.captureQueue, enqueueCapture };
  }
  if (!options.captureRunner) {
    return { queue: null, enqueueCapture: undefined };
  }
  if (!config.scratchDir) {
    throw new Error("captureRunner is enabled but ShelfConfig.scratchDir is not set");
  }
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
    runner: options.captureRunner,
    scratchDir: config.scratchDir,
    viewports: config.viewports,
    logger,
    secret: config.secret,
  };
  const runJob = createDispatchJob({
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
    secret: config.secret,
    logger,
  });
  const captureQueue =
    options.captureQueue ??
    new InMemoryCaptureQueue({
      concurrency: config.captureConcurrency ?? 2,
      logger,
      runJob,
    });
  const enqueueCapture = async (buildId: string, reqId?: string): Promise<void> => {
    await captureQueue.enqueue({ buildId, reqId });
  };
  return { queue: captureQueue, enqueueCapture };
}
