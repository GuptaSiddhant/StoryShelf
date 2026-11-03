import type { BuildDiffData } from "../pages/build-diff.tsx";
import { BUILD_REVIEW, builds, comments, project, snapshots, catalogEntries } from "./dataset.ts";

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`fixture missing: ${what}`);
  return value;
}

const build = required(
  builds.find((item) => item.id === BUILD_REVIEW),
  "the build under review",
);

/** Snapshots of the build under review (three changed, one new, the rest unchanged). */
export const reviewSnapshots = snapshots.filter((snapshot) => snapshot.buildId === BUILD_REVIEW);

/** Whether each story already has a baseline (the new `Card / Elevated` has none). */
const hasBaseline = Object.fromEntries(
  reviewSnapshots.map((snapshot) => [snapshot.id, snapshot.status !== "new"]),
);

/** The review page's data for a build with undecided changes, selected on a changed snapshot. */
export function reviewData(overrides: Partial<BuildDiffData> = {}): BuildDiffData {
  return {
    project,
    build,
    snapshots: reviewSnapshots,
    comments: comments.filter((comment) => comment.buildId === BUILD_REVIEW),
    selectedId: reviewSnapshots.find((snapshot) => snapshot.storyId === "kit-button--primary")?.id,
    canReview: true,
    hasBaseline,
    drifted: {},
    ...overrides,
  };
}

export const NEW_STORY_ID = reviewSnapshots.find(
  (snapshot) => snapshot.storyId === catalogEntries[4]?.id,
)?.id;
