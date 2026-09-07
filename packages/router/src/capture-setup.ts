import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import { createDispatchJob, InMemoryCaptureQueue } from "@storyshelf/core/capture";
import type { CaptureJobOptions } from "@storyshelf/core/capture";
import type { ShelfConfig, ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";

export interface QueueWiring {
  queue: CaptureQueue | null;
  enqueueCapture: ((buildId: string, reqId?: string) => Promise<void>) | undefined;
}

/** Assemble the capture queue and its enqueue hook when a runner is configured. */
export function setupCaptureQueue(
  options: ShelfOptions,
  config: ShelfConfig,
  gitHosts: GitHostProvider[],
  logger: Logger,
): QueueWiring {
  if (!options.captureRunner) {
    return { queue: null, enqueueCapture: undefined };
  }
  if (!config.scratchDir) {
    throw new Error("captureRunner is enabled but ShelfConfig.scratchDir is not set");
  }
  const jobOptions: CaptureJobOptions = {
    db: options.database,
    storage: options.storage,
    runner: options.captureRunner,
    scratchDir: config.scratchDir,
    viewports: config.viewports,
    logger,
    secret: config.secret,
  };
  const runJob = createDispatchJob({
    db: options.database,
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
