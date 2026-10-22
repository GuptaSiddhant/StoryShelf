/**
 * Capture wiring (ADR 0006, decisions 4 to 6): where uploads queue their capture, and the handler
 * of `capture` jobs. Captures queue on the shared database queue, or on `testing.queue` when one
 * is supplied. The handler runs them in this process, or in a forked child the parent pushes jobs
 * to (`testing.workerEntry`). The consumer that polls the queue and calls the handler is built
 * in `jobs-setup.ts`; with no `testing.runner` there is no handler and some other process consumes.
 */
import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import {
  captureDispatchDeps,
  createCaptureHandler,
  DEFAULT_RETRIES,
  failCrashedCapture,
  isFinalAttempt,
  type BuildStatePublisher,
  type CaptureHandlerOptions,
  type ConsumerJob,
  type KindHandler,
} from "@storyshelf/core/capture";
import { DEFAULT_SCRATCH_DIR } from "@storyshelf/core/config";
import type { ShelfConfig, ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { currentTraceparent } from "@storyshelf/observability";
import { notifyCaptureFailed } from "./capture-alerts.ts";
import { createForkedHandler, shouldForkCapture } from "./capture-process.ts";
import { credentialKeys } from "./credential-keys.ts";
import type { JobQueue } from "./job-queue.ts";

/** The `capture` handler, with a way to stop a forked child once the consumer has drained. */
export interface CaptureHandler extends KindHandler {
  close?: () => Promise<void>;
}

/** What uploads and the consumer need of capture. */
export interface CaptureWiring {
  /** Where captures queue: the database queue, `testing.queue`, or null without `testing`. */
  queue: CaptureQueue | null;
  /** Queues a capture for a build; undefined without `testing`. */
  enqueueCapture: ((buildId: string, reqId?: string) => Promise<void>) | undefined;
  /** Runs `capture` jobs here; null when no runner is set (another process consumes the queue). */
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
 * Wire capture for `options`. A supplied `testing.queue` replaces the database queue; with a
 * runner this instance consumes it, without one it only enqueues. Shard jobs go back onto the
 * same queue the capture came from.
 */
export function setupCapture(
  options: ShelfOptions,
  config: ShelfConfig,
  delivery: Delivery,
  logger: Logger,
  jobs: JobQueue,
): CaptureWiring {
  const testing = options.testing;
  if (testing === undefined) {
    return { queue: null, enqueueCapture: undefined, handler: null };
  }
  const queue = testing.queue ?? jobs.view;
  const enqueueCapture = enqueuerFor(queue);
  if (testing.runner === undefined) {
    return { queue, enqueueCapture, handler: null };
  }
  const handlerOptions = captureHandlerOptions(options, config, delivery, logger, {
    runner: testing.runner,
    enqueue: async (job) => {
      await queue.enqueue(job);
    },
  });
  const retries = options.testing?.retries ?? DEFAULT_RETRIES;
  const dispatch = captureDispatchDeps(handlerOptions, retries);
  const failed = async (job: ConsumerJob, error: string): Promise<void> => {
    await failCrashedCapture(dispatch, job, error);
    await notifyCaptureFailed(options, config, logger, job.buildId, delivery.publicOrigin);
  };
  jobs.exhausted.capture = failed;
  const inProcess = createCaptureHandler(handlerOptions);
  const handler = shouldForkCapture(testing, logger)
    ? forkedHandler(options, { fallback: inProcess, retries, onCrashed: failed, logger })
    : inProcess;
  return {
    queue,
    enqueueCapture,
    handler: alerting(handler, retries, async (buildId) => {
      await notifyCaptureFailed(options, config, logger, buildId, delivery.publicOrigin);
    }),
  };
}

function captureHandlerOptions(
  options: ShelfOptions,
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
  };
}

function forkedHandler(
  options: ShelfOptions,
  parts: {
    fallback: KindHandler;
    retries: number;
    onCrashed: (job: ConsumerJob, error: string) => Promise<void>;
    logger: Logger;
  },
): CaptureHandler {
  const testing = options.testing;
  return createForkedHandler({
    workerEntry: testing?.workerEntry ?? "",
    shardSize: testing?.shardSize,
    imageEngine: testing?.images?.engine,
    diffThreads: testing?.compare?.threads,
    ...parts,
  });
}

/**
 * Alert admins when a capture left its build failed: after a run that ended, and after a final
 * attempt that threw (the build may then already be failed by a crash hook). Alerts stay in this
 * process whichever process rendered.
 */
function alerting(
  inner: CaptureHandler,
  retries: number,
  alert: (buildId: string) => Promise<void>,
): CaptureHandler {
  return {
    accepts: (job) => inner.accepts?.(job) !== false,
    run: async (job, context) => {
      try {
        await inner.run(job, context);
      } catch (error) {
        if (isFinalAttempt(job, retries)) {
          await alert(job.buildId);
        }
        throw error;
      }
      await alert(job.buildId);
    },
    cancel: async (job) => {
      await inner.cancel?.(job);
    },
    ...(inner.close ? { close: inner.close } : {}),
  };
}
