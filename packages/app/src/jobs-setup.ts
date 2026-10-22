/**
 * Background jobs of the app (ADR 0006): the one database queue, the handlers of its job kinds
 * (`capture` with `testing`, `publish` on a long-running host) and the one consumer that runs
 * them. A supplied `testing.queue` replaces the database queue for captures and gets its own
 * consumer when this instance renders; publishing stays on the database queue.
 */
import type { PollableCaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import { DEFAULT_RETRIES, type CaptureConsumer } from "@storyshelf/core/capture";
import type { ShelfOptions } from "@storyshelf/core/config";
import { DEFAULT_SCRATCH_DIR } from "@storyshelf/core/config";
import type { CaptureJobKind } from "@storyshelf/core/schema";
import { setupCapture, type CaptureHandler, type CaptureWiring } from "./capture-setup.ts";
import { combineConsumers, jobMetrics, lazyConsumer } from "./consumer-setup.ts";
import { createJobQueue, type JobQueue } from "./job-queue.ts";
import { setupPublishing, type PublishService, type PublishWiring } from "./publish-setup.ts";
import type { ServerRuntime } from "./runtime.ts";
import { isServerlessHost } from "./serverless.ts";

/** What the rest of the app takes from the job wiring. */
export interface JobsWiring {
  /** Where captures queue; null without `testing`. */
  captureQueue: CaptureWiring["queue"];
  enqueueCapture: CaptureWiring["enqueueCapture"];
  /** Whether this instance runs the capture jobs (the retry and compute-jobs UI applies). */
  capturesHere: boolean;
  publish: PublishService;
  /** Runs every handler this instance has; null when it consumes nothing. */
  consumer: CaptureConsumer | null;
}

/** Wire the queue, the handlers and the consumer for `options`. */
export function setupJobs(
  options: ShelfOptions,
  runtime: ServerRuntime,
  env: NodeJS.ProcessEnv = process.env,
): JobsWiring {
  const testing = options.testing;
  const retries = testing?.retries ?? DEFAULT_RETRIES;
  const databaseCaptures = testing?.runner !== undefined && testing.queue === undefined;
  const kinds: CaptureJobKind[] = [
    ...(databaseCaptures ? (["capture"] as const) : []),
    ...(isServerlessHost(env) ? [] : (["publish"] as const)),
  ];
  const jobs = createJobQueue(options, kinds, retries);
  const capture = setupCapture(options, runtime.config, runtime.notifiers, runtime.logger, jobs);
  const publishing = setupPublishing(
    options,
    runtime.config,
    runtime.logger,
    capture.enqueueCapture !== undefined,
    jobs,
  );
  const supplied = testing?.queue;
  const consumer = combineConsumers([
    ...(kinds.length > 0 ? [databaseConsumer(options, runtime, jobs, capture, publishing)] : []),
    ...(supplied !== undefined && capture.handler !== null
      ? [suppliedQueueConsumer(options, runtime, { queue: supplied, handler: capture.handler })]
      : []),
  ]);
  return {
    captureQueue: capture.queue,
    enqueueCapture: capture.enqueueCapture,
    capturesHere: capture.handler !== null,
    publish: publishing,
    consumer,
  };
}

/** The consumer of the database queue: captures (without a supplied queue) and publish jobs. */
function databaseConsumer(
  options: ShelfOptions,
  runtime: ServerRuntime,
  jobs: JobQueue,
  capture: CaptureWiring,
  publishing: Pick<PublishWiring, "handler">,
): CaptureConsumer {
  const capturesHere = jobs.kinds.includes("capture");
  return lazyConsumer(
    () => ({
      queue: jobs.get(),
      handlers: {
        ...(capturesHere && capture.handler ? { capture: capture.handler } : {}),
        ...(publishing.handler ? { publish: publishing.handler } : {}),
      },
      // Publishing alone is one job at a time, so a big zip never crowds out the web server.
      config: {
        concurrency: capturesHere ? options.testing?.concurrency : 1,
        maxRetries: options.testing?.retries ?? DEFAULT_RETRIES,
      },
      scratchDir: runtime.config.scratchDir ?? DEFAULT_SCRATCH_DIR,
      metrics: jobMetrics(),
      logger: runtime.logger.child({ component: "job-consumer" }),
    }),
    [
      async () => {
        if (capturesHere) {
          await capture.handler?.close?.();
        }
        await jobs.built()?.lifecycle.teardown();
      },
    ],
  );
}

/** The consumer of a supplied `testing.queue`: it runs `capture` jobs only. */
function suppliedQueueConsumer(
  options: ShelfOptions,
  runtime: ServerRuntime,
  supplied: { queue: PollableCaptureQueue; handler: CaptureHandler },
): CaptureConsumer {
  const { queue, handler } = supplied;
  return lazyConsumer(
    () => ({
      queue,
      handlers: { capture: handler },
      config: {
        concurrency: options.testing?.concurrency,
        maxRetries: options.testing?.retries ?? DEFAULT_RETRIES,
      },
      scratchDir: runtime.config.scratchDir ?? DEFAULT_SCRATCH_DIR,
      metrics: jobMetrics(),
      logger: runtime.logger.child({ component: "capture-consumer" }),
    }),
    [async () => await handler.close?.()],
  );
}
