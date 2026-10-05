import type { Build, Project, Snapshot } from "@storyshelf/core/schema";

/** How far a build's review has progressed. */
export interface ReviewProgress {
  /** Snapshots a human has to decide on (changed/new, or already decided). */
  reviewable: number;
  /** Reviewable snapshots that are approved or rejected. */
  done: number;
  /** Snapshots still waiting for a decision. */
  pending: number;
}

const OPEN = new Set(["new", "changed"]);
const DECIDED = new Set(["approved", "rejected"]);

/** Count review progress; unchanged snapshots need no decision and are excluded. */
export function reviewProgress(snapshots: Snapshot[]): ReviewProgress {
  const pending = snapshots.filter((snap) => OPEN.has(snap.status)).length;
  const done = snapshots.filter((snap) => DECIDED.has(snap.status)).length;
  return { reviewable: pending + done, done, pending };
}

/** Position of the selected snapshot plus its neighbours in list order. */
export interface Neighbours {
  /** 1-based position, or 0 when nothing is selected. */
  position: number;
  total: number;
  prev: Snapshot | null;
  next: Snapshot | null;
}

/** Previous/next snapshot around the selected one. */
export function neighbours(snapshots: Snapshot[], selectedId?: string): Neighbours {
  const index = snapshots.findIndex((snap) => snap.id === selectedId);
  if (index === -1) {
    return { position: 0, total: snapshots.length, prev: null, next: null };
  }
  return {
    position: index + 1,
    total: snapshots.length,
    prev: snapshots[index - 1] ?? null,
    next: snapshots[index + 1] ?? null,
  };
}

/** Diff size as a percentage string ("3.1%"), or null when not computed. */
export function diffPercent(snapshot: Pick<Snapshot, "diffRatio">): string | null {
  return snapshot.diffRatio === null || snapshot.diffRatio === undefined
    ? null
    : `${(snapshot.diffRatio * 100).toFixed(1)}%`;
}

/** Review-page URL for one snapshot. */
export function snapshotPageUrl(project: Project, build: Build, snapshotId: string): string {
  return `/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snapshotId}`;
}

/** API URL of a snapshot image (`image`), its diff overlay, or its baseline. */
export function snapshotImageUrl(
  project: Project,
  build: Build,
  snapshot: Snapshot,
  kind: "image" | "diff" | "baseline",
): string {
  return `/api/v1/projects/${project.slug}/builds/${build.id}/snapshots/${snapshot.id}/${kind}`;
}
