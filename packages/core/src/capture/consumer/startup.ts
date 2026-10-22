/** What the consumer does before it polls: process-wide image settings, the engine check, scratch sweep. */
import type { ShelfCompareOptions, ShelfImagesOptions } from "../../config.ts";
import { configureImages, verifyImageEngine } from "../../diff/index.ts";
import type { Logger } from "../../logger.ts";
import { sweepOrphanedScratch } from "../scratch.ts";

/**
 * Only touch the process-wide image settings when asked, so a consumer created next to an app in
 * one process does not undo the app's own `images`/`compare` options.
 */
export function applyImageSettings(
  images?: ShelfImagesOptions,
  compare?: ShelfCompareOptions,
): void {
  if (images || compare) {
    configureImages({ engine: images?.engine, threads: compare?.threads });
  }
}

/** Check that the image engine loads; a consumer that cannot diff must not claim jobs. */
export async function ensureImageEngine(logger: Logger): Promise<void> {
  try {
    await verifyImageEngine();
  } catch (error) {
    logger.error({ err: error }, "image engine cannot load; capture consumer stopping");
    throw error;
  }
}

/** Sweep scratch left by a killed run; failures are logged, never fatal. */
export async function sweepScratch(scratchDir: string | undefined, logger: Logger): Promise<void> {
  if (scratchDir === undefined) {
    return;
  }
  try {
    await sweepOrphanedScratch(scratchDir, { logger });
  } catch (error) {
    logger.warn({ err: error }, "scratch sweep failed");
  }
}
