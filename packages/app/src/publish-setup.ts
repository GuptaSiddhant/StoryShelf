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
import type { ShelfConfig, ShelfOptions } from "@storyshelf/core/config";
import { DEFAULT_SCRATCH_DIR } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import type { JobQueue } from "./job-queue.ts";

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
 * `delivery.buildState` shows the build's state on its git channels (the `storybook` status).
 */
export function setupPublishing(
  options: ShelfOptions,
  config: ShelfConfig,
  logger: Logger,
  captureWillRun: boolean,
  delivery: { jobs: JobQueue; buildState: BuildStatePublisher },
): PublishWiring {
  const { jobs } = delivery;
  const catalog = createCatalogLoader({
    db: options.database,
    storage: options.storage,
    logger: logger.child({ component: "catalog" }),
  });
  // The Storybook status shows the end of publishing, a transition no build status change marks.
  const afterPublish: AfterPublishHook[] = [
    createCatalogHook(catalog),
    async ({ build }) => {
      await delivery.buildState.request(build.id);
    },
  ];
  const completer = createPublishCompleter({
    db: options.database,
    captureWillRun,
    afterPublish,
    logger,
  });
  if (!jobs.kinds.includes("publish")) {
    return { completer, afterPublish, catalog, enqueuePublish: undefined, handler: null };
  }
  // A publish whose last attempt lost its lease has no running handler to fail the build.
  jobs.exhausted.publish = async (job, error): Promise<void> => {
    await completer.complete(job.buildId, { ok: false, error });
  };
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
