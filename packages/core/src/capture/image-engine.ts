/** The image engine a capture needs: the process-wide settings and the check that it loads. */
import type { ShelfCompareOptions, ShelfImagesOptions } from "../config.ts";
import { configureImages, verifyImageEngine } from "../diff/index.ts";
import type { Logger } from "../logger.ts";

/**
 * Only touch the process-wide image settings when asked, so a forked capture child started next to
 * an app in one process does not undo the app's own `images`/`compare` options.
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
