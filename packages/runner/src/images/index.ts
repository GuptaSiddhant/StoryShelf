/**
 * `@storyshelf/runner/images`: the image engine behind core's `ImageEngine` contract (#1365).
 * pixelmatch comparison, overlays and thumbnails on a worker-thread pool, with pngjs (default) or
 * sharp codecs. `pngjs` and `pixelmatch` are this package's dependencies; `sharp` is an optional
 * peer, chosen with `testing.images.engine` or `SHELF_IMAGE_ENGINE`.
 *
 * `createImageEngine()` is what the runner puts on `CaptureRunner.images`. The pool and the
 * settings are process-wide, so every engine object in one process shares them.
 */
import type { ImageEngine } from "@storyshelf/core/adapter/capture-runner";
import { configureImages, diffImagesAsync, imageEngineState, shutdownDiffPool } from "./async.ts";
import { downscalePng } from "./downscale.ts";
import { verifyImageEngine } from "./settings.ts";

/** The process-wide image engine as core's `ImageEngine`. */
export function createImageEngine(): ImageEngine {
  return {
    configure: (settings) => {
      configureImages(settings);
    },
    verify: async () => await verifyImageEngine(),
    compare: async (baseline, current, options) =>
      await diffImagesAsync(baseline, current, options),
    downscale: async (png, maxEdge) => await downscalePng(png, maxEdge),
    state: () => imageEngineState(),
    shutdown: async () => {
      await shutdownDiffPool();
    },
  };
}

export {
  configureImages,
  DIFF_WORKERS_ENV,
  diffImagesAsync,
  imageEngineState,
  shutdownDiffPool,
} from "./async.ts";
export {
  DEFAULT_IMAGE_ENGINE,
  IMAGE_ENGINE_ENV,
  IMAGE_ENGINES,
  type ImageEngineName,
  isImageEngine,
  resolveImageEngine,
} from "./codec.ts";
export { downscalePng } from "./downscale.ts";
export { diffImages } from "./engine.ts";
export { DEFAULT_DIFF_OPTIONS, type DiffOptions, type DiffResult } from "./options.ts";
export { currentImageEngine, verifyImageEngine } from "./settings.ts";
export type {
  ImageEngine,
  ImageEngineState,
  ImageSettings,
} from "@storyshelf/core/adapter/capture-runner";
