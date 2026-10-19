/**
 * Pixel diff engine: pixelmatch comparison plus overlay rendering.
 *
 * `diffImages` compares a baseline buffer against a current screenshot; `diffImagesAsync` does
 * the same on a worker-thread pool;
 * `DiffOptions` tunes thresholds (also settable per-project).
 */
export { diffImagesAsync, shutdownDiffPool } from "./async.ts";
export { diffImages } from "./engine.ts";
export { DEFAULT_DIFF_OPTIONS, type DiffOptions, type DiffResult } from "./options.ts";
