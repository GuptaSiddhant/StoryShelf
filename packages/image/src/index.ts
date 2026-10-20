/**
 * Image engine: pixel diffing (pixelmatch), overlay rendering and thumbnails.
 *
 * `diffImages` compares a baseline buffer against a current screenshot; `diffImagesAsync` does
 * the same on a worker-thread pool; `DiffOptions` tunes thresholds (also settable per-project).
 * `configureImages` picks the codec (`pngjs` default, optional `sharp`) and the pool size.
 */
export { configureImages, DIFF_WORKERS_ENV, diffImagesAsync, shutdownDiffPool } from "./async.ts";
export {
  DEFAULT_IMAGE_ENGINE,
  IMAGE_ENGINE_ENV,
  IMAGE_ENGINES,
  type ImageEngine,
  isImageEngine,
  resolveImageEngine,
} from "./codec.ts";
export { downscalePng } from "./downscale.ts";
export { diffImages } from "./engine.ts";
export { DEFAULT_DIFF_OPTIONS, type DiffOptions, type DiffResult } from "./options.ts";
export { currentImageEngine, type ImageSettings, verifyImageEngine } from "./settings.ts";
