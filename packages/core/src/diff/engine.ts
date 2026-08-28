import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import type { DiffOptions, DiffResult } from "./options.ts";

/**
 * Compare a baseline and a current PNG screenshot, producing a DiffResult.
 *
 * @param baseline - The baseline PNG image bytes.
 * @param current - The current PNG image bytes.
 * @param options - Diff comparison options.
 * @returns The comparison result, including a diff overlay when applicable.
 */
export function diffImages(baseline: Buffer, current: Buffer, options: DiffOptions): DiffResult {
  const baselinePng = PNG.sync.read(baseline);
  const currentPng = PNG.sync.read(current);

  const baselineDimensions = { width: baselinePng.width, height: baselinePng.height };
  const currentDimensions = { width: currentPng.width, height: currentPng.height };
  const sizeChanged =
    baselineDimensions.width !== currentDimensions.width || baselineDimensions.height !== currentDimensions.height;

  if (sizeChanged) {
    if (options.failOnSizeChange) {
      return {
        passed: false,
        diffPixels: 0,
        diffRatio: 1,
        diffImage: null,
        baselineDimensions,
        currentDimensions,
        sizeChanged: true,
      };
    }

    // With `failOnSizeChange: false` a size mismatch is not a failure: diff only
    // The top-left overlapping region, normalised by its area. Pixelmatch needs
    // Equal-size inputs, so the larger image is cropped first.
    const width = Math.min(baselineDimensions.width, currentDimensions.width);
    const height = Math.min(baselineDimensions.height, currentDimensions.height);
    const overlap = compareRegions(
      cropRgba(baselinePng.data, baselineDimensions.width, width, height),
      cropRgba(currentPng.data, currentDimensions.width, width, height),
      width,
      height,
      options,
    );
    const diffRatio = overlap.diffPixels / (width * height);
    return {
      passed: diffRatio <= options.maxDiffRatio,
      diffPixels: overlap.diffPixels,
      diffRatio,
      diffImage: overlap.diffImage,
      baselineDimensions,
      currentDimensions,
      sizeChanged: true,
    };
  }

  const width = baselineDimensions.width;
  const height = baselineDimensions.height;
  const overlap = compareRegions(baselinePng.data, currentPng.data, width, height, options);
  const diffRatio = overlap.diffPixels / (width * height);
  return {
    passed: diffRatio <= options.maxDiffRatio,
    diffPixels: overlap.diffPixels,
    diffRatio,
    diffImage: overlap.diffImage,
    baselineDimensions,
    currentDimensions,
    sizeChanged: false,
  };
}

/** Crop an RGBA buffer to the top-left `width` by `height` region. */
function cropRgba(source: Buffer, sourceWidth: number, width: number, height: number): Buffer {
  const cropped = Buffer.alloc(width * height * 4);
  const rowBytes = width * 4;
  const sourceRowBytes = sourceWidth * 4;
  for (let y = 0; y < height; y += 1) {
    source.copy(cropped, y * rowBytes, y * sourceRowBytes, y * sourceRowBytes + rowBytes);
  }
  return cropped;
}

/**
 * Compare two equally sized RGBA buffers and generate a diff overlay.
 *
 * @param baselineData - Baseline image data.
 * @param currentData - Current image data, same size as the baseline.
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param options - Diff comparison options.
 * @returns The differing pixel count and the diff overlay PNG bytes.
 */
function compareRegions(
  baselineData: Buffer,
  currentData: Buffer,
  width: number,
  height: number,
  options: DiffOptions,
): { diffPixels: number; diffImage: Buffer } {
  const diffPng = new PNG({ width, height });
  const diffPixels = pixelmatch(baselineData, currentData, diffPng.data, width, height, {
    threshold: options.pixelThreshold,
    includeAA: options.includeAntialiasing,
  });
  return { diffPixels, diffImage: PNG.sync.write(diffPng) };
}
