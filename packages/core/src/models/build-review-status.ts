/**
 * What the build-level verdicts make of a build (ADR 0013, decision 3). Pure: callers read the
 * reviews and the project, apply the result, and stay free of branching.
 */
import type { BuildReview } from "../schema/build-review.ts";

/** What {@link deriveReviewStatus} depends on. */
export interface ReviewStatusInput {
  /** `testing` is on: the snapshot rollup decides and verdicts never gate. */
  testing: boolean;
  /** The project's review switch. */
  review: boolean;
  /** `projects.review_approvals`: approvals a build needs (at least 1). */
  approvalsRequired: number;
  /** Every verdict given to the build, in any order; see {@link latestVerdicts}. */
  reviews: readonly Pick<BuildReview, "id" | "userId" | "verdict" | "createdAt">[];
}

/** Reviewer key standing for verdicts without a user (auth off or an admin token): one reviewer. */
const ANONYMOUS_REVIEWER = "";

/**
 * The status the verdicts give the build, or `null` when they do not decide it (`testing` is on,
 * or review is off and the build was accepted when it was published).
 *
 * - `rejected` when any reviewer's latest verdict is `rejected`;
 * - `approved` once the required approvals are present among the latest verdicts;
 * - `pending` otherwise.
 */
export function deriveReviewStatus(
  input: ReviewStatusInput,
): "approved" | "rejected" | "pending" | null {
  if (input.testing || !input.review) {
    return null;
  }
  const latest = latestVerdicts(input.reviews);
  if (latest.some((review) => review.verdict === "rejected")) {
    return "rejected";
  }
  const approvals = latest.filter((review) => review.verdict === "approved").length;
  return approvals >= Math.max(1, input.approvalsRequired) ? "approved" : "pending";
}

/** Each reviewer's latest verdict (newest `createdAt`, then newest id), oldest reviewer first. */
export function latestVerdicts<T extends Pick<BuildReview, "id" | "userId" | "createdAt">>(
  reviews: readonly T[],
): T[] {
  const latest = new Map<string, T>();
  for (const review of reviews) {
    const key = review.userId ?? ANONYMOUS_REVIEWER;
    const current = latest.get(key);
    if (current === undefined || isNewer(review, current)) {
      latest.set(key, review);
    }
  }
  return [...latest.values()].toSorted((a, b) => (isNewer(b, a) ? -1 : 1));
}

function isNewer(
  a: Pick<BuildReview, "id" | "createdAt">,
  b: Pick<BuildReview, "id" | "createdAt">,
): boolean {
  return a.createdAt === b.createdAt ? a.id > b.id : a.createdAt > b.createdAt;
}
