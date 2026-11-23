/** Diff a stored screenshot against a baseline and persist the overlay; shared by capture and re-diff. */
import {
  DEFAULT_DIFF_OPTIONS,
  type DiffResult,
  type ImageEngine,
} from "../adapters/image-engine.ts";
import type { StorageAdapter } from "../adapters/storage.ts";

/** Project thresholds that drive a diff. */
export interface DiffThresholds {
  pixelThreshold: number;
  maxDiffRatio: number;
}

/** Per-story `diffThreshold` when it is a finite number in 0..1; otherwise the project threshold. */
export function resolvePixelThreshold(projectThreshold: number, override?: number): number {
  const valid = typeof override === "number" && Number.isFinite(override);
  return valid && override >= 0 && override <= 1 ? override : projectThreshold;
}

/**
 * Content-addressed screenshots share a path exactly when their bytes are equal, so the diff is
 * empty without reading either image. Dimensions are not known (nothing was read) and report 0.
 */
function samePathResult(): DiffResult {
  const unread = { width: 0, height: 0 };
  return {
    passed: true,
    diffPixels: 0,
    diffRatio: 0,
    diffImage: null,
    baselineDimensions: unread,
    currentDimensions: unread,
    sizeChanged: false,
  };
}

/**
 * Read two stored PNGs and diff them on the runner's image engine with the project's thresholds
 * (optionally a per-story pixel threshold).
 */
export async function diffStoredScreenshots(
  stores: { storage: StorageAdapter; images: ImageEngine },
  project: DiffThresholds,
  baselinePath: string,
  currentPath: string,
  diffThreshold?: number,
): Promise<DiffResult> {
  if (baselinePath === currentPath) {
    return samePathResult();
  }
  const current = await stores.storage.read(currentPath);
  const previous = await stores.storage.read(baselinePath);
  return await stores.images.compare(previous, current, {
    ...DEFAULT_DIFF_OPTIONS,
    pixelThreshold: resolvePixelThreshold(project.pixelThreshold, diffThreshold),
    maxDiffRatio: project.maxDiffRatio,
  });
}

/** Write the diff overlay for a failing diff; returns the stored path, or null when none applies. */
export async function writeDiffOverlay(
  storage: StorageAdapter,
  path: string,
  result: Pick<DiffResult, "diffImage">,
  passed: boolean,
): Promise<string | null> {
  if (passed || !result.diffImage) {
    return null;
  }
  await storage.write(path, result.diffImage);
  return path;
}
