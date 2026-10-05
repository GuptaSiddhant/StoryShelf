/** Diff a stored screenshot against a baseline and persist the overlay; shared by capture and re-diff. */
import type { StorageAdapter } from "../adapters/storage.ts";
import { diffImages } from "../diff/engine.ts";
import { DEFAULT_DIFF_OPTIONS, type DiffResult } from "../diff/options.ts";

/** Project thresholds that drive a diff. */
export interface DiffThresholds {
  pixelThreshold: number;
  maxDiffRatio: number;
}

/** Read two stored PNGs and diff them with the project's thresholds. */
export async function diffStoredScreenshots(
  storage: StorageAdapter,
  project: DiffThresholds,
  baselinePath: string,
  currentPath: string,
): Promise<DiffResult> {
  const current = await storage.read(currentPath);
  const previous = await storage.read(baselinePath);
  return diffImages(previous, current, {
    ...DEFAULT_DIFF_OPTIONS,
    pixelThreshold: project.pixelThreshold,
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
