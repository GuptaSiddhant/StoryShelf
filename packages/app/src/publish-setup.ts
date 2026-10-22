/**
 * Publishing wiring (ADR 0006, decision 10): the completer every upload route ends in, the
 * `publish` job queue and its consumer. The consumer runs on every instance with a database, so
 * a hosting-only instance can publish large zips; it is not started on serverless hosts, where an
 * over-limit zip is refused instead. Capture's own queue is wired elsewhere (`capture-setup.ts`).
 */
import {
  createCaptureConsumer,
  createDatabaseCaptureQueue,
  createPublishCompleter,
  createPublishHandler,
  extractionLimitsOf,
  resolvePublishLimits,
  type AfterPublishHook,
  type CaptureConsumer,
  type DatabaseCaptureQueue,
  type ConsumerMetrics,
  type PublishCompleter,
} from "@storyshelf/core/capture";
import type { ShelfConfig, ShelfOptions } from "@storyshelf/core/config";
import { DEFAULT_SCRATCH_DIR } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { captureMetrics } from "@storyshelf/observability";
import { isServerlessHost } from "./serverless.ts";

/** What request handlers and the lifecycle use of publishing. */
export interface PublishWiring {
  /** Applies the acceptance rule and the hooks when a publish ends. */
  completer: PublishCompleter;
  /** Hooks run after every publish; the catalog registers here. */
  afterPublish: AfterPublishHook[];
  /** Puts a `publish` job on the queue; undefined when this host runs no consumer. */
  enqueuePublish: ((buildId: string, reqId?: string) => Promise<void>) | undefined;
  /** Runs the queued publish jobs; null when this host runs none. */
  consumer: CaptureConsumer | null;
}

/** The request-scoped part of {@link PublishWiring}. */
export type PublishService = Pick<PublishWiring, "completer" | "afterPublish" | "enqueuePublish">;

/**
 * Wire publishing for `options` (the instrumented options; `config` is the resolved config).
 * `captureWillRun` is whether uploads get a capture (`enqueueCapture` exists): capture owns the
 * build status then, and publishing leaves it alone.
 */
export function setupPublishing(
  options: ShelfOptions,
  config: ShelfConfig,
  logger: Logger,
  captureWillRun: boolean,
  env: NodeJS.ProcessEnv = process.env,
): PublishWiring {
  const afterPublish: AfterPublishHook[] = [];
  const completer = createPublishCompleter({
    db: options.database,
    captureWillRun,
    afterPublish,
    logger,
  });
  if (isServerlessHost(env)) {
    return { completer, afterPublish, enqueuePublish: undefined, consumer: null };
  }
  // Built on first use: a host that never enqueues or starts the consumer (OpenAPI generation,
  // asset-only tests with stub tables) never touches `capture_jobs`.
  const parts = lazily(() => buildQueueAndConsumer(options, config, logger, completer));
  return {
    completer,
    afterPublish,
    enqueuePublish: async (buildId, reqId) => {
      await parts().queue.enqueueJob({ kind: "publish", buildId, ...(reqId ? { reqId } : {}) });
    },
    consumer: lazyConsumer(parts),
  };
}

function lazily<T>(make: () => T): { (): T; built: () => T | undefined } {
  let value: T | undefined;
  const get = (): T => (value ??= make());
  return Object.assign(get, { built: () => value });
}

interface QueueAndConsumer {
  queue: DatabaseCaptureQueue;
  consumer: CaptureConsumer;
}

function buildQueueAndConsumer(
  options: ShelfOptions,
  config: ShelfConfig,
  logger: Logger,
  completer: PublishCompleter,
): QueueAndConsumer {
  const queue = createDatabaseCaptureQueue(options.database, { kinds: ["publish"] });
  const scratchDir = config.scratchDir ?? DEFAULT_SCRATCH_DIR;
  const handler = createPublishHandler({
    db: options.database,
    storage: options.storage,
    scratchDir,
    limits: extractionLimitsOf(resolvePublishLimits(config)),
    completer,
    logger,
  });
  const consumer = createCaptureConsumer({
    queue,
    handlers: { publish: handler },
    scratchDir,
    config: { concurrency: 1 },
    metrics: publishMetrics(),
    logger: logger.child({ component: "publish-consumer" }),
  });
  return { queue, consumer };
}

/** A consumer that is built when first started; stopping one never started is a no-op. */
function lazyConsumer(parts: ReturnType<typeof lazily<QueueAndConsumer>>): CaptureConsumer {
  return {
    start: async () => {
      await parts().consumer.start();
    },
    stop: async () => {
      const built = parts.built();
      await built?.consumer.stop();
      await built?.queue.lifecycle.teardown();
    },
    isRunning: () => parts.built()?.consumer.isRunning() ?? false,
  };
}

/** Publish jobs count on the capture job instruments, told apart by `job.kind`. */
function publishMetrics(): ConsumerMetrics {
  return {
    jobFinished: (event) => {
      const instruments = captureMetrics();
      const attributes = { "job.kind": event.kind };
      instruments.jobDuration.record(event.durationMs, attributes);
      if (event.outcome === "completed") {
        instruments.jobsCompleted.add(1, attributes);
      } else if (event.outcome === "failed") {
        instruments.jobsFailed.add(1, attributes);
      }
    },
  };
}
