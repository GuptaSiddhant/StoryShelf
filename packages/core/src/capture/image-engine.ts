/** The image engine a capture needs: its settings and the check that it loads (the runner's `images`). */
import type { ImageEngine } from "../adapters/image-engine.ts";
import type { ShelfCompareOptions, ShelfImagesOptions } from "../config.ts";
import type { Logger } from "../logger.ts";

/**
 * Only touch the image settings when asked, so a forked capture child started next to an app in
 * one process does not undo the app's own `images`/`compare` options.
 */
export function applyImageSettings(
  engine: ImageEngine,
  images?: ShelfImagesOptions,
  compare?: ShelfCompareOptions,
): void {
  if (images || compare) {
    engine.configure({ engine: images?.engine, threads: compare?.threads });
  }
}

/** Check that the image engine loads; a consumer that cannot diff must not claim jobs. */
export async function ensureImageEngine(engine: ImageEngine, logger: Logger): Promise<void> {
  try {
    await engine.verify();
  } catch (error) {
    logger.error({ err: error }, "image engine cannot load; capture consumer stopping");
    throw error;
  }
}
