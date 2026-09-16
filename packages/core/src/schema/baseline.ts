/** A baseline row. */
export interface Baseline {
  id: string;
  projectId: string;
  storyId: string;
  viewportName: string;
  branch: string;
  snapshotId: string | null;
  screenshotPath: string;
  createdAt: string;
  updatedAt: string;
}
