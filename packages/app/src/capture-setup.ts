/**
 * Capture wiring (ADR 0006, decisions 4 to 6): where uploads queue their capture, and the handler
 * of `capture` jobs. Captures queue on the shared database queue. The handler runs them in this
 * process, or in a forked child the parent pushes jobs to (`testing.workerEntry`). The consumer
 * that polls the queue and calls the handler is built in `jobs-setup.ts`. The hooks, the choice
 * of process and the alerting wrapper live in `capture-handlers.ts`.
 */
import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import {
  captureDispatchDeps,
  DEFAULT_RETRIES,
  type BuildStatePublisher,
  type CaptureHandlerOptions,
} from "@storyshelf/core/capture";
import { DEFAULT_SCRATCH_DIR } from "@storyshelf/core/config";
import type { ShelfConfig, ResolvedShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { currentTraceparent } from "@storyshelf/core/telemetry";
import { notifyCaptureFailed, notifyCaptureStuck } from "./capture-alerts.ts";
import {
  alerting,
  handlerFor,
  registerCrashHooks,
  type CaptureAlerts,
  type CaptureHandler,
} from "./capture-handlers.ts";
import { recordShardRepeated } from "./consumer-setup.ts";
import { credentialKeys } from "./credential-keys.ts";
import type { JobQueue } from "./job-queue.ts";

export type { CaptureHandler };

/** What uploads and the consumer need of capture. */
export interface CaptureWiring {
  /** Where captures queue: the database queue, or null without `testing`. */
  queue: CaptureQueue | null;
  /** Queues a capture for a build; undefined without `testing`. */
  enqueueCapture: ((buildId: string, reqId?: string) => Promise<void>) | undefined;
  /** Runs `capture` jobs here; null without `testing`. */
  handler: CaptureHandler | null;
}

/** What a capture hands its results to. */
interface Delivery {
  notifiers: NotifierProvider[];
  buildState: BuildStatePublisher;
  /** The resolved public origin (ADR 0007): status links and targets that need a URL use it. */
  publicOrigin: () => Promise<string | undefined>;
}

/** Queue a build, continuing the active request trace when present. */
function enqueuerFor(queue: CaptureQueue): (buildId: string, reqId?: string) => Promise<void> {
  return async (buildId, reqId) => {
    const traceparent = currentTraceparent();
    await queue.enqueue({ buildId, reqId, ...(traceparent ? { traceparent } : {}) });
  };
}

/**
 * Wire capture for `options`: `testing` always has a runner, so this instance consumes the
 * captures it queues. Shard jobs go back onto the same queue the capture came from.
 */
export function setupCapture(
  options: ResolvedShelfOptions,
  config: ShelfConfig,
  delivery: Delivery,
  logger: Logger,
  jobs: JobQueue,
): CaptureWiring {
  const testing = options.testing;
  if (testing === undefined) {
    return { queue: null, enqueueCapture: undefined, handler: null };
  }
  const queue = jobs.view;
  const handlerOptions = captureHandlerOptions(options, config, delivery, logger, {
    runner: testing.runner,
    enqueue: async (job) => {
      await queue.enqueue(job);
    },
  });
  const retries = options.testing?.retries ?? DEFAULT_RETRIES;
  const alert: CaptureAlerts = {
    failed: async (buildId: string): Promise<void> => {
      await notifyCaptureFailed(options, config, logger, buildId, delivery.publicOrigin);
    },
    stuck: async (buildId: string): Promise<void> => {
      await notifyCaptureStuck(options, config, logger, buildId, delivery.publicOrigin);
    },
  };
  const failed = registerCrashHooks(jobs, captureDispatchDeps(handlerOptions, retries), alert);
  const handler = handlerFor(options, handlerOptions, { retries, onCrashed: failed, logger });
  return {
    queue,
    enqueueCapture: enqueuerFor(queue),
    handler: alerting(handler, retries, alert.failed),
  };
}

function captureHandlerOptions(
  options: ResolvedShelfOptions,
  config: ShelfConfig,
  delivery: Delivery,
  logger: Logger,
  parts: { runner: CaptureRunner; enqueue: CaptureHandlerOptions["enqueue"] },
): CaptureHandlerOptions {
  return {
    db: options.database,
    storage: options.storage,
    runner: parts.runner,
    // `resolveShelfOptions` defaults scratchDir; the fallback covers hand-built configs.
    scratchDir: config.scratchDir ?? DEFAULT_SCRATCH_DIR,
    viewports: config.viewports,
    logger,
    secret: credentialKeys(config),
    design: options.design,
    shardSize: options.testing?.shardSize,
    notifiers: delivery.notifiers,
    buildState: delivery.buildState,
    publicOrigin: delivery.publicOrigin,
    config,
    enqueue: parts.enqueue,
    maxRetries: options.testing?.retries,
    onShardRepeated: recordShardRepeated,
  };
}
