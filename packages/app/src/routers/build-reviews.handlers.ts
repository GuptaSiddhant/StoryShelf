/**
 * Build-level verdicts (ADR 0013, decision 3): giving one and reading where a build stands. The
 * routes are classed `review`, so `requireReview` answers 404 for a project with review off.
 */
import {
  BuildModel,
  BuildReviewModel,
  deriveReviewStatus,
  latestVerdicts,
} from "@storyshelf/core/models";
import type { Build, BuildReview, Project } from "@storyshelf/core/schema";
import type { BuildStatus, ReviewVerdict } from "@storyshelf/core/types";
import { HTTPException } from "hono/http-exception";
import { requestBuildState } from "../git-status.ts";
import { REVIEW_EVENTS, announceReview } from "../review-events.ts";
import { getStore } from "../store.ts";
import { announceBuildStatus } from "./builds.handlers.ts";

/** Statuses the verdicts may move a build between; a failed or capturing build is not theirs to decide. */
const VERDICT_STATUSES: ReadonlySet<BuildStatus> = new Set(["pending", "approved", "rejected"]);

/** Where a build stands in review. */
export interface ReviewState {
  status: BuildStatus;
  approvalsRequired: number;
  approvals: number;
  latest: BuildReview[];
  history: BuildReview[];
}

/** The verdicts of a build and what they make of it. */
export async function reviewStateOf(project: Project, build: Build): Promise<ReviewState> {
  const history = await new BuildReviewModel(getStore().db).listByBuild(build.id);
  const latest = latestVerdicts(history);
  return {
    status: build.status,
    approvalsRequired: approvalsRequired(project),
    approvals: latest.filter((review) => review.verdict === "approved").length,
    latest,
    history,
  };
}

/**
 * Record `userId`'s verdict and let the verdicts decide the build. With `testing` on the verdict is
 * stored as a sign-off and the snapshot rollup keeps deciding. Every write asks for the build's
 * state to be shown on its git channels; a status the verdicts moved to `approved` or `rejected`
 * is announced like any other (webhook and notifications). Every verdict raises `review:verdict`.
 */
export async function giveVerdict(
  project: Project,
  build: Build,
  userId: string | null,
  input: { verdict: ReviewVerdict; body?: string | undefined },
): Promise<BuildReview> {
  if (build.status === "failed") {
    throw new HTTPException(409, { message: "The build failed; there is nothing to review" });
  }
  const review = await new BuildReviewModel(getStore().db).add(
    build.id,
    userId,
    input.verdict,
    input.body,
  );
  const status = await decideBuild(project, build);
  await announceReview(
    project,
    REVIEW_EVENTS.verdict,
    {
      buildId: build.id,
      gitBranch: build.gitBranch,
      verdict: review.verdict,
      userId,
      body: review.body?.slice(0, 500) ?? null,
      status: status ?? build.status,
    },
    build.id,
  );
  // Only a decision is news; a build sent back to `pending` just shows its new state on the host.
  if (status === null || status === "pending") {
    await requestBuildState(build.id);
  } else {
    await announceBuildStatus(build.id, status);
  }
  return review;
}

/** Move the build to the status its verdicts give it; the new status, or null when it did not move. */
async function decideBuild(
  project: Project,
  build: Build,
): Promise<"approved" | "rejected" | "pending" | null> {
  const { db, testing } = getStore();
  const status = deriveReviewStatus({
    testing,
    review: true,
    approvalsRequired: approvalsRequired(project),
    reviews: await new BuildReviewModel(db).listByBuild(build.id),
  });
  if (status === null || !VERDICT_STATUSES.has(build.status) || status === build.status) {
    return null;
  }
  await new BuildModel(db).setStatus(build.id, status);
  return status;
}

function approvalsRequired(project: Project): number {
  return Math.max(1, project.reviewApprovals ?? 1);
}
