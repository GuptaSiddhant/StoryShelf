/**
 * Pending builds nobody finishes (ADR 0013, decision 9; ADR 0009, decision 4). A `pending` build
 * waits for a review verdict, so the terminal-status rule never reaches it; this rule gives it an
 * exit. A pending build is purgeable once its last activity is older than the retention window:
 * the later of its own last update (upload) and its newest comment or verdict. A build superseded
 * by a newer one on its branch, with no attempts, verdicts or comments, has no activity beyond
 * its upload, so it leaves at the same window; the build under review is never cut short.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import { BuildReviewModel } from "../models/build-review.ts";
import { BuildModel } from "../models/build.ts";
import { CommentModel } from "../models/comment.ts";
import type { Build } from "../schema/build.ts";

/** Why a pending build is purgeable. */
export type PendingReason = "superseded" | "idle";

/** A pending build the retention pass may remove. */
export interface PendingCandidate {
  buildId: string;
  reason: PendingReason;
}

/**
 * The project's pending builds whose last activity (upload, comment or verdict) is before
 * `cutoff`. `capture_attempts` need no check: a build capture worked on leaves `pending`.
 */
export async function pendingCandidates(
  db: DatabaseAdapter,
  projectId: string,
  cutoff: string,
): Promise<PendingCandidate[]> {
  const builds = new BuildModel(db);
  const pending = await builds.list(projectId, { status: "pending" });
  if (pending.length === 0) {
    return [];
  }
  const all = await builds.list(projectId);
  const found = await Promise.all(
    pending.map(async (build): Promise<PendingCandidate | null> => {
      const activity = await activityOf(db, build);
      if (activity.last >= cutoff) {
        return null;
      }
      const superseded = !activity.touched && hasNewerOnBranch(all, build);
      return { buildId: build.id, reason: superseded ? "superseded" : "idle" };
    }),
  );
  return found.filter((candidate) => candidate !== null);
}

interface Activity {
  /** Newest of the build's own update, its comments and its verdicts. */
  last: string;
  /** A person commented on or gave a verdict to the build. */
  touched: boolean;
}

async function activityOf(db: DatabaseAdapter, build: Build): Promise<Activity> {
  const [comments, reviews] = await Promise.all([
    new CommentModel(db).listByBuild(build.id),
    new BuildReviewModel(db).listByBuild(build.id),
  ]);
  const stamps = [
    build.updatedAt,
    ...comments.map((item) => stampOf(item)),
    ...reviews.map((item) => stampOf(item)),
  ];
  return {
    last: stamps.toSorted().at(-1) ?? build.updatedAt,
    touched: comments.length > 0 || reviews.length > 0,
  };
}

function stampOf(item: { createdAt: string }): string {
  return item.createdAt;
}

function hasNewerOnBranch(all: readonly Build[], build: Build): boolean {
  return all.some(
    (other) =>
      other.id !== build.id &&
      other.gitBranch === build.gitBranch &&
      other.createdAt > build.createdAt,
  );
}
