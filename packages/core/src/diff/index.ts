/**
 * Pixel diff engine (re-exported from `@storyshelf/image`, which owns the codecs and worker pool).
 *
 * `diffImages` compares a baseline buffer against a current screenshot; `diffImagesAsync` does
 * the same on a worker-thread pool; `DiffOptions` tunes thresholds (also settable per-project).
 */
export {
  configureImages,
  DEFAULT_DIFF_OPTIONS,
  diffImages,
  diffImagesAsync,
  type DiffOptions,
  type DiffResult,
  type ImageEngine,
  shutdownDiffPool,
  verifyImageEngine,
} from "@storyshelf/image";
