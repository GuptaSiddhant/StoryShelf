import type { Comment } from "@storyshelf/core/schema";
import type { BuildDiffData } from "../pages/build-diff.tsx";
import type { ReviewSectionData } from "../routers/review-section.handlers.ts";
import { BUILD_REVIEW, builds, comments, project, snapshots, catalogEntries } from "./dataset.ts";
import { hoursAgo } from "./time.ts";

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
    canTriage: true,
    names: new Map<string, string>(),
    hasBaseline,
    drifted: {},
    ...overrides,
  };
}

export const NEW_STORY_ID = reviewSnapshots.find(
  (snapshot) => snapshot.storyId === catalogEntries[4]?.id,
)?.id;

/** A change request (or plain comment) on the build under review, for the thread and checklist stories. */
export function reviewComment(
  key: string,
  overrides: Partial<Comment> & Pick<Comment, "body">,
): Comment {
  return {
    id: `01JD0000000000000000REQ${key}`,
    projectId: project.id,
    buildId: BUILD_REVIEW,
    snapshotId: null,
    storyId: null,
    userId: "u_ana",
    parentId: null,
    resolved: false,
    kind: "change_request",
    resolvedAt: null,
    resolvedBy: null,
    createdAt: hoursAgo(5),
    updatedAt: hoursAgo(5),
    ...overrides,
  };
}

/** Display names of the people in the review stories, by user id. */
export const reviewNames = new Map([
  ["u_ana", "Ana Ruiz"],
  ["u_bo", "Bo Chen"],
  ["u_cy", "Cy Okafor"],
]);

/** The build review page's data (what its cards read), with the given change requests and comments. */
export function reviewSection(overrides: Partial<ReviewSectionData> = {}): ReviewSectionData {
  return {
    project,
    build,
    state: {
      status: build.status,
      approvalsRequired: 1,
      approvals: 0,
      latest: [],
      history: [],
    },
    changeset: { baseline: null, changeset: { added: [], removed: [], changed: [], unchanged: 0 } },
    firstStory: new Map(),
    comments: [],
    names: reviewNames,
    assigned: [],
    changeRequests: [],
    snapshotLabels: new Map(),
    canTriage: true,
    testing: false,
    publishing: "success",
    canComment: true,
    canVerdict: true,
    ...overrides,
  };
}
