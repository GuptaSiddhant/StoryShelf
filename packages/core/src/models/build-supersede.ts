/**
 * Cancel the builds a newer build supersedes (ADR 0045, decisions 3 to 5). The write is the fence:
 * one conditional update moves a build to `cancelled` and records the newer build in the same
 * statement, only while it is still in a state the lifecycle lets move to `cancelled` (ADR 0046).
 */
import { and, eq, inArray, lt, ne } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { enteringFrom } from "../lifecycle/build-lifecycle.ts";
import type { Build } from "../schema/build.ts";
import { col } from "./columns.ts";

/** The newer build and the project, branch and creation time the candidates are checked against. */
export type SupersedingBuild = Pick<
  Build,
  "id" | "projectId" | "gitBranch" | "gitSha" | "createdAt"
>;

/** Hooks of {@link supersedeBuilds}; both run only for a build this call really cancelled. */
export interface SupersedeOptions {
  /**
   * A build someone may already be using, beyond what the rows show (for example a published build
   * that waits for verdicts with testing off). Returning true keeps it.
   */
  keep?: (build: Build) => Promise<boolean>;
  /** Stop the build's jobs and announce `cancelled`: the app's existing cancel path. */
  onCancelled?: (build: Build) => Promise<void>;
}

/** Whether a verdict or a comment is attached to the build: people may be using it. */
async function hasReviewActivity(db: DatabaseAdapter, buildId: string): Promise<boolean> {
  const where = (table: Parameters<typeof col>[0]): SQL => eq(col(table, "buildId"), buildId);
  const [reviews, comments] = await Promise.all([
    db.list(db.tables.buildReviews, { where: where(db.tables.buildReviews), limit: 1 }),
    db.list(db.tables.comments, { where: where(db.tables.comments), limit: 1 }),
  ]);
  return reviews.length > 0 || comments.length > 0;
}

/** The ids of `ids` that are candidates: same project and branch, another commit, created earlier. */
async function candidatesOf(
  db: DatabaseAdapter,
  newBuild: SupersedingBuild,
  ids: readonly string[],
): Promise<Build[]> {
  const { builds } = db.tables;
  const where = and(
    inArray(col(builds, "id"), [...ids]),
    eq(col(builds, "projectId"), newBuild.projectId),
    eq(col(builds, "gitBranch"), newBuild.gitBranch),
    ne(col(builds, "gitSha"), newBuild.gitSha),
    lt(col(builds, "createdAt"), newBuild.createdAt),
    inArray(col(builds, "status"), [...enteringFrom("cancelled")]),
  );
  return (await db.list(builds, { where })) as unknown as Build[];
}

/**
 * Cancel each of `ids` that is a valid target and return the ids it cancelled. Anything else
 * (another project or branch, the same commit, a newer build, a build past capture, one already
 * cancelled, one with a verdict or a comment) is ignored, never an error. A build that finishes
 * between the check and the write is left alone: the write applies only while its status still
 * allows the move, and it sets `superseded_by_build_id` in the same statement.
 */
export async function supersedeBuilds(
  db: DatabaseAdapter,
  newBuild: SupersedingBuild,
  ids: readonly string[],
  options: SupersedeOptions = {},
): Promise<string[]> {
  if (ids.length === 0) return [];
  const cancelled: string[] = [];
  for (const candidate of await candidatesOf(db, newBuild, [...new Set(ids)])) {
    // oxlint-disable-next-line no-await-in-loop -- one build at a time keeps the cancels ordered
    if (await supersedeOne(db, newBuild, candidate, options)) cancelled.push(candidate.id);
  }
  return cancelled;
}

/** One candidate: skip it when people use it, otherwise the conditional write decides. */
async function supersedeOne(
  db: DatabaseAdapter,
  newBuild: SupersedingBuild,
  candidate: Build,
  options: SupersedeOptions,
): Promise<boolean> {
  if ((await hasReviewActivity(db, candidate.id)) || (await options.keep?.(candidate)) === true) {
    return false;
  }
  const { builds } = db.tables;
  const row = (await db.updateWhere(
    builds,
    candidate.id,
    {
      status: "cancelled",
      supersededByBuildId: newBuild.id,
      updatedAt: new Date().toISOString(),
    },
    inArray(col(builds, "status"), [...enteringFrom("cancelled")]),
  )) as unknown as Build | null;
  // A refused write hands the row back as it is: ours only if it carries our mark.
  if (row?.status !== "cancelled" || row.supersededByBuildId !== newBuild.id) return false;
  await options.onCancelled?.(row);
  return true;
}
