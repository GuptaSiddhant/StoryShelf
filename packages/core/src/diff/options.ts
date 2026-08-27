export interface DiffOptions {
  pixelThreshold: number;
  maxDiffRatio: number;
  includeAntialiasing: boolean;
  failOnSizeChange: boolean;
}

export interface DiffResult {
  passed: boolean;
  diffPixels: number;
  diffRatio: number;
  diffImage: Buffer | null;
  baselineDimensions: { width: number; height: number };
  currentDimensions: { width: number; height: number };
  sizeChanged: boolean;
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  pixelThreshold: 0.1,
  maxDiffRatio: 0.01,
  includeAntialiasing: false,
  failOnSizeChange: true,
};
