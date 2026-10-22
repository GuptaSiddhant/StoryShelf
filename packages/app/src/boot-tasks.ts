import { sweepOrphanedScratch } from "@storyshelf/core/capture";
import type { ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { checkCredentialsAfterSetup } from "./credentials.ts";
import { logHostingOnlyMode } from "./hidden-data.ts";
import { trackBackground, type LifecycleCell } from "./lifecycle.ts";
import type { ServerRuntime } from "./runtime.ts";

/** Boot-time checks that run once adapters are ready: stuck-capture recovery and credential state. */
export function runBootTasks(
  cell: LifecycleCell,
  scoped: ShelfOptions,
  runtime: ServerRuntime,
  recoverStuck: (() => Promise<unknown>) | undefined,
): void {
  recoverAfterSetup(cell, recoverStuck, runtime.logger);
  sweepScratchOnBoot(cell, runtime.config.scratchDir, runtime.logger);
  checkCredentialsAfterSetup(cell, scoped.database, runtime.config, runtime.logger);
  logHostingOnlyAfterSetup(cell, scoped, runtime.logger);
}

/** Without `testing`, once adapters are ready, log the mode and any snapshots it hides. */
function logHostingOnlyAfterSetup(cell: LifecycleCell, scoped: ShelfOptions, logger: Logger): void {
  if (scoped.testing !== undefined) {
    return;
  }
  trackBackground(
    cell,
    cell.ready
      .then(async (setup) => {
        if (setup.ok) {
          await logHostingOnlyMode(scoped.database, logger);
        }
      })
      .catch((error: unknown) => {
        logger.warn({ err: error }, "could not count the snapshots hosting-only mode hides");
      }),
  );
}

/** Once adapters are ready, requeue-once or fail builds a restart left `capturing`. */
function recoverAfterSetup(
  cell: LifecycleCell,
  recoverStuck: (() => Promise<unknown>) | undefined,
  logger: Logger,
): void {
  if (!recoverStuck) {
    return;
  }
  trackBackground(
    cell,
    cell.ready
      .then(async (setup) => {
        if (setup.ok) {
          await recoverStuck();
        }
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "stuck capture recovery failed");
      }),
  );
}

/** Remove scratch dirs a crash left behind; filesystem only, so it never waits on adapters. */
function sweepScratchOnBoot(
  cell: LifecycleCell,
  scratchDir: string | undefined,
  logger: Logger,
): void {
  if (!scratchDir) {
    return;
  }
  trackBackground(
    cell,
    sweepOrphanedScratch(scratchDir, { logger }).then(
      () => {},
      (error: unknown) => {
        logger.warn({ err: error }, "scratch sweep failed");
      },
    ),
  );
}
