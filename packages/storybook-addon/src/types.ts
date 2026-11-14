/**
 * The `story-status` response (ADR 0042, decision 3). A small copy, so the addon never pulls server
 * code into a browser bundle; `types.test.ts` guards it against the OpenAPI document.
 */

/** Review statuses of a story's snapshots, worst first in the server's roll-up. */
export const SNAPSHOT_STATUSES = [
  "pending",
  "new",
  "unchanged",
  "changed",
  "approved",
  "rejected",
] as const;

/** Lifecycle statuses of a build. */
export const BUILD_STATUSES = [
  "pending",
  "capturing",
  "comparing",
  "reviewing",
  "approved",
  "rejected",
  "failed",
  "cancelled",
] as const;

/** Known design problems; a current or unknown design is left out of the response. */
export const DESIGN_PROBLEMS = ["stale", "deleted"] as const;

export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];
export type BuildStatus = (typeof BUILD_STATUSES)[number];
export type DesignProblem = (typeof DESIGN_PROBLEMS)[number];

/** One story's badge state. */
export interface StoryStatusEntry {
  status: SnapshotStatus;
  design?: DesignProblem;
}

/** What `GET /api/v1/projects/:slug/builds/:buildId/story-status` answers. */
export interface StoryStatusBody {
  build: { status: BuildStatus; reviewPath: string };
  stories: Record<string, StoryStatusEntry>;
}
