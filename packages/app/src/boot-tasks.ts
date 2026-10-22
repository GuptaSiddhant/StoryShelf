import { sweepOrphanedScratch } from "@storyshelf/core/capture";
import type { ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { checkCredentialsAfterSetup } from "./credentials.ts";
import { logHostingOnlyMode } from "./hidden-data.ts";
import { startConsumer, trackBackground, type LifecycleCell } from "./lifecycle.ts";
import type { ServerRuntime } from "./runtime.ts";

/**
 * Boot-time work that runs once adapters are ready: the job consumer starts (there is no boot sweep
 * of builds left `capturing`: leases expire and jobs are redelivered, so a second instance can
 * start without touching a first one's builds), and the credential state is checked.
 */
export function runBootTasks(
  cell: LifecycleCell,
  scoped: ShelfOptions,
  runtime: ServerRuntime,
): void {
  startConsumerAfterSetup(cell, runtime.logger);
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

/** Once adapters are ready, start the consumer, so a host that never calls `setup()` still runs jobs. */
function startConsumerAfterSetup(cell: LifecycleCell, logger: Logger): void {
  trackBackground(
    cell,
    cell.ready
      .then((setup) => {
        if (setup.ok) {
          startConsumer(cell, logger);
        }
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "job consumer failed to start");
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
