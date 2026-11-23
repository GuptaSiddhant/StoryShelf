/**
 * The image contract of a capture (#1365): what core and the app need from an image library, which
 * the runner supplies on `CaptureRunner.images` (`@storyshelf/runner/images` is the built-in one).
 * Core never imports an image library: decoding, encoding, pixel comparison, thumbnails and the
 * diff worker pool all live behind this interface, and with no `testing` nothing image-related
 * loads.
 */

/** Image libraries accepted by `testing.images.engine` and `SHELF_IMAGE_ENGINE`. */
export type ImageEngineName = "pngjs" | "sharp";

/** Environment variable that selects the image library when `testing.images.engine` is not set. */
export const IMAGE_ENGINE_ENV = "SHELF_IMAGE_ENGINE";

/** Environment variable overriding the diff pool size; `0` runs diffs in-thread. */
export const DIFF_WORKERS_ENV = "SHELF_DIFF_WORKERS";

/** Options that control how two images are compared. */
export interface DiffOptions {
  /** Per-pixel difference threshold (0-1) above which a pixel counts as different. */
  pixelThreshold: number;
  /** Maximum allowed ratio of differing pixels for a diff to pass. */
  maxDiffRatio: number;
  /** Whether to include antialiasing artifacts when counting differing pixels. */
  includeAntialiasing: boolean;
  /** Whether a size mismatch between images should fail the diff. When false, only the overlapping region is diffed. */
  failOnSizeChange: boolean;
}

/** The outcome of comparing a baseline and a current screenshot. */
export interface DiffResult {
  /** Whether the current image is within the accepted tolerance. */
  passed: boolean;
  /** Number of differing pixels. */
  diffPixels: number;
  /** Ratio of differing pixels to total pixels. */
  diffRatio: number;
  /** Generated diff overlay image, or null when unavailable. */
  diffImage: Buffer | null;
  /** Dimensions of the baseline image. */
  baselineDimensions: { width: number; height: number };
  /** Dimensions of the current image. */
  currentDimensions: { width: number; height: number };
  /** Whether the two images have different dimensions. */
  sizeChanged: boolean;
}

/** Default diff settings used when no project overrides are present. */
export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  pixelThreshold: 0.1,
  maxDiffRatio: 0.01,
  includeAntialiasing: false,
  failOnSizeChange: true,
};

/** What `createShelfApp` hands the engine: `testing.images.engine` and `testing.compare.threads`. */
export interface ImageSettings {
  /** Image library: `"pngjs"` (default) or `"sharp"`; falls back to `SHELF_IMAGE_ENGINE`. */
  engine?: string;
  /** Worker threads for diffs; `0` runs on the main thread. */
  threads?: number;
}

/** What the diff path runs on now, for the admin health report. */
export interface ImageEngineState {
  /** The image library in effect. */
  engine: ImageEngineName;
  /** Configured worker threads (`0` = in-thread by choice). */
  workers: number;
  /** Whether diffs run on the calling thread: by choice, or because workers could not start. */
  inThread: boolean;
}

/** Image work for captures, re-diffs and AI thumbnails; supplied by the runner. */
export interface ImageEngine {
  /**
   * Apply the server's settings; each beats its environment variable. Throws on an unknown engine
   * name. A running pool that no longer matches is rebuilt on next use.
   */
  configure(settings: ImageSettings): void;
  /**
   * Load the configured library and the comparison now, so a missing package fails readiness with
   * a message naming it instead of the first diff. Resolves to the library in effect.
   */
  verify(): Promise<ImageEngineName>;
  /**
   * Compare two PNGs without blocking the event loop. The buffers may be transferred to a worker,
   * which detaches them in the caller: do not read them afterwards.
   */
  compare(baseline: Buffer, current: Buffer, options: DiffOptions): Promise<DiffResult>;
  /** Downscale a PNG so its long edge is at most `maxEdge`; the output stays PNG. */
  downscale(png: Uint8Array, maxEdge: number): Promise<Uint8Array>;
  /** The library and pool size in effect. Starts nothing. */
  state(): ImageEngineState;
  /** Stop the diff workers; a later `compare` starts fresh ones. */
  shutdown(): Promise<void>;
}
