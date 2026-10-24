/**
 * Background jobs of the app (ADR 0006): the one database queue, the handlers of its job kinds
 * (`capture` with `testing`, `publish` on a long-running host, `notify` on a queue of its own) and the one consumer that runs
 * them.
 */
import {
  DEFAULT_RETRIES,
  NOTIFY_MAX_ATTEMPTS,
  type BuildStatePublisher,
  type CaptureConsumer,
  type KindHandler,
} from "@storyshelf/core/capture";
import type { ShelfOptions } from "@storyshelf/core/config";
import { DEFAULT_SCRATCH_DIR } from "@storyshelf/core/config";
import type { Build, CaptureJobKind, Project } from "@storyshelf/core/schema";
import { setupBuildState, type BuildStateWiring } from "./build-state-setup.ts";
import { setupCapture, type CaptureWiring } from "./capture-setup.ts";
import { combineConsumers, jobMetrics, lazyConsumer } from "./consumer-setup.ts";
import { createJobCanceller, type JobCanceller } from "./job-canceller.ts";
import { createJobQueue, type JobQueue } from "./job-queue.ts";
import { setupPublishing, type PublishService, type PublishWiring } from "./publish-setup.ts";
import { announceReviewWith, REVIEW_EVENTS, reviewRequestedData } from "./review-events.ts";
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
  /** Asks for a build's current state to be shown on its git channels (ADR 0014). */
  buildState: BuildStatePublisher;
  /** Cancels every unfinished job of a build, of any kind (capture, publish, notify). */
  cancelBuildJobs: JobCanceller;
  /** Runs every handler this instance has; null when it consumes nothing. */
  consumer: CaptureConsumer | null;
}

/** Wire the queue, the handlers and the consumer for `options`. */
export function setupJobs(
  options: ShelfOptions,
  runtime: ServerRuntime,
  env: NodeJS.ProcessEnv = process.env,
): JobsWiring {
  const { jobs, notifyJobs } = queuesFor(options, isServerlessHost(env));
  const buildState = setupBuildState(options, runtime, notifyJobs);
  const capture = setupCapture(
    options,
    runtime.config,
    {
      notifiers: runtime.notifiers,
      buildState: buildState.publisher,
      publicOrigin: async () => await runtime.publicOrigin.url(),
    },
    runtime.logger,
    jobs,
  );
  const publishing = setupPublishing(
    options,
    runtime.config,
    runtime.logger,
    capture.enqueueCapture !== undefined,
    {
      jobs,
      buildState: buildState.publisher,
      reviewRequested: reviewRequestedFor(options, runtime),
    },
  );
  const wiring = { capture, publishing, buildState, notifyJobs };
  return {
    captureQueue: capture.queue,
    enqueueCapture: capture.enqueueCapture,
    capturesHere: capture.handler !== null,
    publish: publishing,
    buildState: buildState.publisher,
    cancelBuildJobs: createJobCanceller([jobs.view]),
    consumer: combineConsumers(consumersOf(options, runtime, jobs, wiring)),
  };
}

/**
 * The database queue (captures with `testing`, publishing on a long-running host) and,
 * on a long-running host, a queue of its own for `notify` jobs: a status must not wait behind a
 * capture that holds every slot for minutes.
 */
function queuesFor(
  options: ShelfOptions,
  serverless: boolean,
): { jobs: JobQueue; notifyJobs: JobQueue | null } {
  const testing = options.testing;
  const databaseCaptures = testing?.runner !== undefined;
  const kinds: CaptureJobKind[] = [
    ...(databaseCaptures ? (["capture"] as const) : []),
    ...(serverless ? [] : (["publish"] as const)),
  ];
  return {
    jobs: createJobQueue(options, kinds, testing?.retries ?? DEFAULT_RETRIES),
    notifyJobs: serverless ? null : createJobQueue(options, ["notify"], NOTIFY_MAX_ATTEMPTS - 1),
  };
}

/** Every consumer this instance runs; none on a host that polls nothing. */
function consumersOf(
  options: ShelfOptions,
  runtime: ServerRuntime,
  jobs: JobQueue,
  wiring: {
    capture: CaptureWiring;
    publishing: Pick<PublishWiring, "handler">;
    buildState: Pick<BuildStateWiring, "handler">;
    notifyJobs: JobQueue | null;
  },
): CaptureConsumer[] {
  const { capture, publishing, buildState, notifyJobs } = wiring;
  return [
    ...(jobs.kinds.length > 0
      ? [databaseConsumer(options, runtime, jobs, { capture, publishing })]
      : []),
    ...(buildState.handler !== null && notifyJobs !== null
      ? [notifyConsumer(options, runtime, notifyJobs, buildState.handler)]
      : []),
  ];
}

/** The consumer of the database queue: capture and publish jobs. */
function databaseConsumer(
  options: ShelfOptions,
  runtime: ServerRuntime,
  jobs: JobQueue,
  wiring: {
    capture: CaptureWiring;
    publishing: Pick<PublishWiring, "handler">;
  },
): CaptureConsumer {
  const { capture, publishing } = wiring;
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
      ...(options.testing?.queueClock === undefined
        ? {}
        : { now: options.testing.queueClock.now, timers: options.testing.queueClock.timers }),
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

/** Deliveries running at once: short HTTP calls to a git host, bounded to stay clear of its rate limits. */
const NOTIFY_CONCURRENCY = 4;

/** The consumer of `notify` jobs, on its own queue so no capture or publish job can starve it. */
function notifyConsumer(
  options: ShelfOptions,
  runtime: ServerRuntime,
  queue: JobQueue,
  handler: KindHandler,
): CaptureConsumer {
  return lazyConsumer(
    () => ({
      queue: queue.get(),
      handlers: { notify: handler },
      config: { concurrency: NOTIFY_CONCURRENCY },
      metrics: jobMetrics(),
      logger: runtime.logger.child({ component: "notify-consumer" }),
      ...(options.testing?.queueClock === undefined
        ? {}
        : { now: options.testing.queueClock.now, timers: options.testing.queueClock.timers }),
    }),
    [
      async () => {
        await queue.built()?.lifecycle.teardown();
      },
    ],
  );
}

/** Tells the project's reviewers a published build waits for a verdict (webhook and notifications). */
function reviewRequestedFor(
  options: ShelfOptions,
  runtime: ServerRuntime,
): (project: Project, build: Build) => Promise<void> {
  return async (project, build) => {
    await announceReviewWith(
      {
        db: options.database,
        config: runtime.config,
        ui: runtime.ui,
        logger: runtime.logger,
        notifiers: runtime.notifiers,
        notificationsConfig: options.notifications?.config,
        publicOrigin: runtime.publicOrigin,
      },
      project,
      REVIEW_EVENTS.requested,
      reviewRequestedData(build),
      build.id,
    );
  };
}
