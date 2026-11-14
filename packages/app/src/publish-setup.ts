import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
/**
 * Publishing wiring (ADR 0006, decision 10): the completer every upload route ends in, and the
 * `publish` job kind on the shared database queue. Its handler runs on every instance with a
 * database, so a hosting-only instance can publish large zips; it is absent on serverless hosts,
 * where an over-limit zip is refused instead. The consumer that calls the handler is built in
 * `jobs-setup.ts`, together with the capture handler.
 */
import {
  createCatalogHook,
  createCatalogLoader,
  createPublishCompleter,
  createPublishHandler,
  extractionLimitsOf,
  resolvePublishLimits,
  type AfterPublishHook,
  type BuildStatePublisher,
  type CatalogLoader,
  type KindHandler,
  type PublishCompleter,
} from "@storyshelf/core/capture";
import type { ShelfConfig, ResolvedShelfOptions } from "@storyshelf/core/config";
import { DEFAULT_SCRATCH_DIR } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { BuildModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import type { JobQueue } from "./job-queue.ts";
import { precompressBuild } from "./routers/published-precompress.ts";

/** What request handlers and the consumer use of publishing. */
export interface PublishWiring {
  /** Applies the acceptance rule and the hooks when a publish ends. */
  completer: PublishCompleter;
  /** Hooks run after every publish; the catalog registers here. */
  afterPublish: AfterPublishHook[];
  /** The Storybook catalog of published builds (cached in memory; catalogues old builds lazily). */
  catalog: CatalogLoader;
  /** Puts a `publish` job on the queue; undefined when this host runs no consumer. */
  enqueuePublish: ((buildId: string, reqId?: string) => Promise<void>) | undefined;
  /** Runs `publish` jobs; null when this host runs none. */
  handler: KindHandler | null;
}

/** The request-scoped part of {@link PublishWiring}. */
export type PublishService = Pick<
  PublishWiring,
  "completer" | "afterPublish" | "catalog" | "enqueuePublish"
>;

/**
 * Wire publishing for `options` (the instrumented options; `config` is the resolved config).
 * `captureWillRun` is whether uploads get a capture (`enqueueCapture` exists): capture owns the
 * build status then, and publishing leaves it alone. `delivery.jobs` is the shared queue; a host
 * that polls no `publish` jobs (serverless) has none of the job side. When publishing ends,
 * `delivery.buildState` shows the build's state on its git channels (the `storybook` status) and
 * `delivery.reviewRequested` asks the reviewers for a verdict on a build that waits for one.
 */
export function setupPublishing(
  options: ResolvedShelfOptions,
  config: ShelfConfig,
  logger: Logger,
  captureWillRun: boolean,
  delivery: {
    jobs: JobQueue;
    buildState: BuildStatePublisher;
    /** Tells the project's reviewers a build waits for a verdict (`review:requested`). */
    reviewRequested: (project: Project, build: Build) => Promise<void>;
  },
): PublishWiring {
  const { jobs } = delivery;
  const catalog = createCatalogLoader({
    db: options.database,
    storage: options.storage,
    logger: logger.child({ component: "catalog" }),
  });
  const afterPublish = publishHooks(catalog, captureWillRun, delivery, options.database, {
    enabled: config.publishedCompression === true,
    storage: options.storage,
    logger: logger.child({ component: "precompress" }),
  });
  const completer = createPublishCompleter({
    db: options.database,
    storage: options.storage,
    captureWillRun,
    afterPublish,
    logger,
  });
  if (!jobs.kinds.includes("publish")) {
    return { completer, afterPublish, catalog, enqueuePublish: undefined, handler: null };
  }
  hookPublishJobs(jobs, completer, delivery.buildState);
  return {
    completer,
    afterPublish,
    catalog,
    enqueuePublish: async (buildId, reqId): Promise<void> => {
      await jobs.get().enqueueJob({ kind: "publish", buildId, ...(reqId ? { reqId } : {}) });
    },
    handler: createPublishHandler({
      db: options.database,
      storage: options.storage,
      scratchDir: config.scratchDir ?? DEFAULT_SCRATCH_DIR,
      limits: extractionLimitsOf(resolvePublishLimits(config)),
      completer,
      logger,
    }),
  };
}

/**
 * What happens to the build when its publish job ends without a handler to say so. The build's
 * state is read from the job rows, and a publish job still counts as open while its handler (or
 * exhausted hook) completes the build, so the state is asked for again once the job has ended.
 */
function hookPublishJobs(
  jobs: JobQueue,
  completer: PublishCompleter,
  buildState: BuildStatePublisher,
): void {
  // A publish whose last attempt lost its lease has no running handler to fail the build. Every
  // exhausted-job hook run failing (abandoned) ends it the same way, or a reviewed build would
  // keep a pending Storybook check.
  jobs.exhausted.publish = async (job, error): Promise<void> => {
    await completer.complete(job.buildId, { ok: false, error });
  };
  jobs.abandoned.publish = jobs.exhausted.publish;
  jobs.ended.publish = async (job): Promise<void> => {
    await buildState.request(job.buildId);
  };
}

/**
 * Hooks run after every publish: the catalog, the build's state on its git channels (the Storybook
 * status shows the end of publishing, a transition no build status change marks) and, without
 * `testing`, the request for a verdict on a build left `pending` (ADR 0013, decision 4).
 */
function publishHooks(
  catalog: CatalogLoader,
  captureWillRun: boolean,
  delivery: Pick<Parameters<typeof setupPublishing>[4], "buildState" | "reviewRequested">,
  db: DatabaseAdapter,
  compression: { enabled: boolean; storage: StorageAdapter; logger: Logger },
): AfterPublishHook[] {
  return [
    createCatalogHook(catalog),
    // The gzip and brotli copies of a published build, made in the background so the first request
    // is already compressed. It never delays or fails the publish.
    // oxlint-disable-next-line typescript/promise-function-async -- queues work and returns; nothing to await
    ({ build, outcome }) => {
      if (compression.enabled && outcome.ok) {
        precompressBuild(compression.storage, build.projectId, build.id, compression.logger);
      }
      return Promise.resolve();
    },
    async ({ build }) => {
      await delivery.buildState.request(build.id);
    },
    async ({ build, project, outcome }) => {
      if (outcome.ok && !captureWillRun && build.status === "pending") {
        // One request per review cycle: the claim is the atomic check, so a repeated completion,
        // a retried hook or a second instance finds the cycle taken (ADR 0013, decision 4).
        const claimed = await new BuildModel(db).claimReviewRequest(build.id);
        if (claimed) await delivery.reviewRequested(project, claimed);
      }
    },
  ];
}
