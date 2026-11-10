import {
  requestOpenBuildStates,
  sweepOrphanedScratch,
  type BuildStatePublisher,
} from "@storyshelf/core/capture";
import type { ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { backfillContentUses } from "@storyshelf/core/retention";
import { checkCredentialsAfterSetup } from "./credentials.ts";
import { logHostingOnlyMode } from "./hidden-data.ts";
import { startConsumer, trackBackground, type LifecycleCell } from "./lifecycle.ts";
import { NOTIFICATIONS_PAUSED_TEXT } from "./notifications-pause.ts";
import type { ServerRuntime } from "./runtime.ts";

/**
 * Boot-time work that runs once adapters are ready: the job consumer starts (there is no boot sweep
 * of builds left `capturing`: leases expire and jobs are redelivered, so a second instance can
 * start without touching a first one's builds), the credential state is checked, and the git state
 * of open builds is asked for again (see {@link replayGitStateAfterSetup}).
 */
export function runBootTasks(
  cell: LifecycleCell,
  scoped: ShelfOptions,
  runtime: ServerRuntime,
  buildState?: BuildStatePublisher,
): void {
  startConsumerAfterSetup(cell, runtime.logger);
  sweepScratchOnBoot(cell, runtime.config.scratchDir, runtime.logger);
  checkCredentialsAfterSetup(cell, scoped.database, runtime.config, runtime.logger);
  logHostingOnlyAfterSetup(cell, scoped, runtime.logger);
  logPausedAfterSetup(cell, runtime);
  backfillContentUsesAfterSetup(cell, scoped, runtime.logger);
  if (buildState) {
    replayGitStateAfterSetup(cell, scoped, runtime, buildState);
  }
}

/**
 * A restart can lose a git status or comment: a delivery in flight on a host with no durable
 * queue, a request made while no origin resolved. Once adapters are ready, with notifiers wired
 * and a public origin resolved, the open builds (newest 25 per project) are asked for again, once
 * (ADR 0014, decision 11). Only git state is replayed: chat, email and alerts are not.
 */
function replayGitStateAfterSetup(
  cell: LifecycleCell,
  scoped: ShelfOptions,
  runtime: ServerRuntime,
  buildState: BuildStatePublisher,
): void {
  if (runtime.notifiers.length === 0) {
    return;
  }
  trackBackground(
    cell,
    cell.ready
      .then(async (setup) => {
        if (setup.ok && (await runtime.publicOrigin.url()) !== undefined) {
          const asked = await requestOpenBuildStates(
            { db: scoped.database, logger: runtime.logger },
            buildState,
          );
          runtime.logger.info({ asked }, "re-requested the git state of open builds at boot");
        }
      })
      .catch((error: unknown) => {
        runtime.logger.warn({ err: error }, "could not replay the git state of open builds");
      }),
  );
}

/**
 * Once adapters are ready and the database exposes the lifecycle capability, record the content
 * uses of builds published before `content_uses` existed (ADR 0039), unless an earlier boot
 * finished that. It deletes nothing and keeps its progress, so a restart resumes it; teardown
 * waits for it (bounded) through the background tracker.
 */
function backfillContentUsesAfterSetup(
  cell: LifecycleCell,
  scoped: ShelfOptions,
  logger: Logger,
): void {
  trackBackground(
    cell,
    cell.ready
      .then(async (setup) => {
        const lifecycle = scoped.database.buildReferenceLifecycle;
        if (!setup.ok || lifecycle === undefined) return;
        await backfillContentUses({
          db: scoped.database,
          storage: scoped.storage,
          lifecycle,
          logger,
        });
      })
      .catch((error: unknown) => {
        logger.warn({ err: error }, "content uses backfill failed; it will run again at next boot");
      }),
  );
}

/** With notifiers wired but no public origin resolved, say at boot that notifications are paused. */
function logPausedAfterSetup(cell: LifecycleCell, runtime: ServerRuntime): void {
  if (runtime.notifiers.length === 0) {
    return;
  }
  trackBackground(
    cell,
    cell.ready
      .then(async (setup) => {
        if (setup.ok && (await runtime.publicOrigin.url()) === undefined) {
          runtime.logger.warn({}, NOTIFICATIONS_PAUSED_TEXT);
        }
      })
      .catch((error: unknown) => {
        runtime.logger.warn({ err: error }, "could not check the public origin for notifications");
      }),
  );
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
