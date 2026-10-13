/** A baseline row. */
export interface Baseline {
  id: string;
  projectId: string;
  storyId: string;
  viewportName: string;
  branch: string;
  snapshotId: string | null;
  screenshotPath: string;
  infraHash: string | null;
  /** Resolved mode definition (JSON) — display/capture only; identity is `viewportName`. */
  mode?: string | null;
  /** Engine the image was captured with. */
  browser?: string;
  createdAt: string;
  updatedAt: string;
}
