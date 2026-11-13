import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
/**
 * The `statics-reclaim` job kind (ADR 0040): reclaim the per-build Storybook copies kept before
 * published files were stored once (#849). The daily retention sweep queues one job; the handler
 * visits pages of builds until the sweep is done or the job is stopped, and the sweep's cursor
 * (`site_settings`) lets the next job resume. Single-flight through `activeKey`, on the main queue
 * behind capture and publish, never at boot (ADR 0053).
 */
import type { KindHandler } from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";
import { reclaimBuildCopies, reclaimCopiesDone } from "@storyshelf/core/retention";
import type { JobQueue } from "./job-queue.ts";

const ACTIVE_KEY = "statics-reclaim";

/** What {@link setupStaticsReclaim} returns. */
export interface StaticsReclaimWiring {
  /** Queues a sweep unless one is done or open; undefined where this host polls no such queue. */
  enqueue: (() => Promise<void>) | undefined;
  /** Runs the jobs; null where this host polls no such queue. */
  handler: KindHandler | null;
}

/** Wire the job on `jobs`; none on a host whose queue does not poll the kind. */
export function setupStaticsReclaim(
  deps: { db: DatabaseAdapter; storage: StorageAdapter; logger: Logger },
  jobs: JobQueue,
): StaticsReclaimWiring {
  if (!jobs.kinds.includes("statics-reclaim")) return { enqueue: undefined, handler: null };
  return {
    enqueue: async (): Promise<void> => {
      if (await reclaimCopiesDone(deps.db)) return;
      await jobs.get().enqueueJob({ kind: "statics-reclaim", activeKey: ACTIVE_KEY });
    },
    handler: {
      run: async (_job, context): Promise<void> => {
        for (;;) {
          // oxlint-disable-next-line no-await-in-loop -- one page at a time, progress saved per build
          const page = await reclaimBuildCopies({ ...deps, signal: context.signal });
          context.touch();
          if (page.done || context.signal.aborted) return;
        }
      },
    },
  };
}
