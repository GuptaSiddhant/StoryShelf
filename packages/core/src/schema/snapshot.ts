import type { SnapshotStatus } from "../types.ts";

/** A snapshot row. */
export interface Snapshot {
  id: string;
  projectId: string;
  buildId: string;
  storyId: string;
  storyName: string;
  storyTitle: string;
  storyImportPath: string | null;
  viewportName: string;
  viewportWidth: number;
  viewportHeight: number;
  screenshotPath: string;
  diffPath: string | null;
  diffPixels: number | null;
  diffRatio: number | null;
  diffPassed: boolean | null;
  status: SnapshotStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  infraHash: string | null;
  /** True when inherited unchanged from the baseline without rendering. */
  inherited: boolean;
  /** Baseline row the diff was computed against (null: no baseline, or legacy row). */
  baselineId: string | null;
  /** That baseline's `updatedAt` at diff time; compared on approval to detect drift. */
  baselineVersion: string | null;
  createdAt: string;
  updatedAt: string;
}
