/** Options that control how two images are compared. */
export interface DiffOptions {
  /** Per-pixel difference threshold (0-1) above which a pixel counts as different. */
  pixelThreshold: number;
  /** Maximum allowed ratio of differing pixels for a diff to pass. */
  maxDiffRatio: number;
  /** Whether to include antialiasing artifacts when counting differing pixels. */
  includeAntialiasing: boolean;
  /** Whether a size mismatch between images should fail the diff. */
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
