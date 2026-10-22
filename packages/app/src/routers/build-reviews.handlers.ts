/**
 * Build-level verdicts (ADR 0013, decision 3): giving one and reading where a build stands. The
 * routes are classed `review`, so `requireReview` answers 404 for a project with review off.
 */
import { publishingOf } from "@storyshelf/core/capture";
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
  await assertReviewable(project, build, userId);
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
  // Every move is news: `approved` and `rejected` as ever, and `pending` when a rewritten verdict
  // sends the build back; a verdict that moves nothing only refreshes the git channels.
  if (status === null) {
    await requestBuildState(build.id);
  } else {
    await announceBuildStatus(build.id, status);
  }
  return review;
}

/**
 * A verdict needs a build that is not `failed`, whose publishing has ended (a publish that later
 * failed would otherwise leave an approved build without statics), and, when it has no user (an
 * instance without authentication), a project that needs one approval: the anonymous reviewer is
 * one person, however many verdicts they give.
 */
async function assertReviewable(
  project: Project,
  build: Build,
  userId: string | null,
): Promise<void> {
  if (build.status === "failed") {
    throw new HTTPException(409, { message: "The build failed; there is nothing to review" });
  }
  if ((await publishingOf(getStore().storage, build)) !== "success") {
    throw new HTTPException(409, {
      message: "The build is still publishing; give a verdict once its Storybook is published",
    });
  }
  if (userId === null && approvalsRequired(project) > 1) {
    throw new HTTPException(409, {
      message: `Verdicts without authentication count as one reviewer, but this project needs ${String(approvalsRequired(project))} approvals; enable authentication to review`,
    });
  }
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
