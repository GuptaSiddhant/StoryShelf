/** A baseline row. */
export interface Baseline {
  id: string;
  projectId: string;
  storyId: string;
  viewportName: string;
  branch: string;
  snapshotId: string | null;
  /** Build that actually rendered this image; null for unknown or imported origins. */
  sourceBuildId?: string | null;
  screenshotPath: string;
  infraHash: string | null;
  /** JSON `Fingerprint` behind `infraHash`; null on baselines recorded before fingerprints. */
  fingerprint: string | null;
  /** Resolved mode definition (JSON) — display/capture only; identity is `viewportName`. */
  mode?: string | null;
  /** Engine the image was captured with. */
  browser?: string;
  createdAt: string;
  updatedAt: string;
}
