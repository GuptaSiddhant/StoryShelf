import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { ShelfConfig } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
/* oxlint-disable typescript/promise-function-async -- interval helpers return promise factories */
import { ProjectModel } from "@storyshelf/core/models";
import { Retention } from "@storyshelf/core/retention";

const DEFAULT_BRANCH_TTL_DAYS = 30;
const DEFAULT_BRANCH_GC_INTERVAL_MS = 86_400_000;

export interface BranchGcTimer {
  stop(): void;
}

export function startBranchGcTimer(
  db: DatabaseAdapter,
  storage: StorageAdapter,
  config: ShelfConfig,
  logger: Logger,
): BranchGcTimer | null {
  const ttlDays = config.branchTtlDays ?? DEFAULT_BRANCH_TTL_DAYS;
  if (ttlDays === null) {
    return null;
  }
  const intervalMs = config.branchGcIntervalMs ?? DEFAULT_BRANCH_GC_INTERVAL_MS;
  if (intervalMs <= 0) {
    return null;
  }
  const run = createBranchGcRunner(db, storage, logger, ttlDays);
  return scheduleBranchGc(run, intervalMs);
}

// oxlint-disable-next-line typescript/promise-function-async
function createBranchGcRunner(
  db: DatabaseAdapter,
  storage: StorageAdapter,
  logger: Logger,
  ttlDays: number,
): () => Promise<void> {
  return async (): Promise<void> => {
    try {
      const projects = await new ProjectModel(db).list();
      const retention = new Retention(db, storage, logger);
      const results = await Promise.all(
        projects.map((project) => retention.purgeStaleBranches(project, ttlDays)),
      );
      const totalBranches = results.reduce(
        (sum: number, r: { removedBranches: number }) => sum + r.removedBranches,
        0,
      );
      const totalBaselines = results.reduce(
        (sum: number, r: { removedBaselines: number }) => sum + r.removedBaselines,
        0,
      );
      if (totalBranches > 0 || totalBaselines > 0) {
        logger.info({ totalBranches, totalBaselines }, "branch GC daily sweep complete");
      }
    } catch (error) {
      logger.error({ err: error }, "branch GC sweep failed");
    }
  };
}

function scheduleBranchGc(run: () => Promise<void>, intervalMs: number): BranchGcTimer {
  const firstDelay = Math.min(3_600_000, intervalMs);
  const timeout = setTimeout(() => {
    // oxlint-disable-next-line no-void -- fire-and-forget interval task
    void run();
  }, firstDelay);
  timeout.unref?.();

  const interval = setInterval(() => {
    // oxlint-disable-next-line no-void -- fire-and-forget interval task
    void run();
  }, intervalMs);
  interval.unref?.();

  return {
    stop: () => {
      clearTimeout(timeout);
      clearInterval(interval);
    },
  };
}
