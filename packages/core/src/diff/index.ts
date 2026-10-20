/**
 * Pixel diff engine (re-exported from `@storyshelf/image`, which owns the codecs and worker pool).
 *
 * `diffImages` compares a baseline buffer against a current screenshot; `diffImagesAsync` does
 * the same on a worker-thread pool; `DiffOptions` tunes thresholds (also settable per-project).
 */
import { configureImages } from "@storyshelf/image";

export {
  configureImages,
  DEFAULT_DIFF_OPTIONS,
  DIFF_WORKERS_ENV,
  diffImages,
  diffImagesAsync,
  type DiffOptions,
  type DiffResult,
  IMAGE_ENGINE_ENV,
  type ImageEngine,
  shutdownDiffPool,
  verifyImageEngine,
} from "@storyshelf/image";

/** @deprecated Use `configureImages`, which also takes the image engine. */
export function configureDiffPool(options: { threads?: number }): void {
  configureImages(options);
}
