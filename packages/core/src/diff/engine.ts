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

  const width = baselineDimensions.width;
  const height = baselineDimensions.height;
  const diffPng = new PNG({ width, height });

  const diffPixels = pixelmatch(baselinePng.data, currentPng.data, diffPng.data, width, height, {
    threshold: options.pixelThreshold,
    includeAA: options.includeAntialiasing,
  });

  const diffRatio = diffPixels / (width * height);
  const passed = diffRatio <= options.maxDiffRatio;

  return {
    passed,
    diffPixels,
    diffRatio,
    diffImage: PNG.sync.write(diffPng),
    baselineDimensions,
    currentDimensions,
    sizeChanged: false,
  };
}
