/**
 * Pixel diff and image engine: pixelmatch comparison, overlay rendering and thumbnails, on a
 * worker-thread pool with pngjs (default) or sharp codecs.
 *
 * `diffImages` compares a baseline buffer against a current screenshot; `diffImagesAsync` does
 * the same on the pool; `DiffOptions` tunes thresholds (also settable per-project).
 * `configureImages` picks the codec (`pngjs` default, optional `sharp`) and the pool size.
 */
import { configureImages } from "./async.ts";

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

/** @deprecated Use `configureImages`, which also takes the image engine. */
export function configureDiffPool(options: { threads?: number }): void {
  configureImages(options);
}
