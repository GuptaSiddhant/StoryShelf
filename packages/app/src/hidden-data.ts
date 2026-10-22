import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";

/**
 * Snapshots stored in the database. With `testing` off they are hidden, not deleted (ADR 0006,
 * decision 1): the System page and the startup log say how many.
 */
export async function countHiddenSnapshots(db: DatabaseAdapter): Promise<number> {
  return await db.count(db.tables.snapshots);
}

/** Log the mode at boot; with `testing` off, also how much captured data it hides. */
export async function logHostingOnlyMode(db: DatabaseAdapter, logger: Logger): Promise<void> {
  const hiddenSnapshots = await countHiddenSnapshots(db);
  if (hiddenSnapshots > 0) {
    logger.warn(
      { hiddenSnapshots },
      "testing is off: existing snapshots are hidden, not deleted; they reappear when testing is turned on",
    );
    return;
  }
  logger.info("testing is off: hosting Storybooks only (no capture, compare or baselines)");
}
