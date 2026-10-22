/** Build-level review verdicts (ADR 0013, decision 3). */
import { asc, eq } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { BuildReview } from "../schema/build-review.ts";
import type { ReviewVerdict } from "../types.ts";
import { ulid } from "../utils/ulid.ts";
import { latestVerdicts } from "./build-review-status.ts";
import { col } from "./columns.ts";

/** Tables required by {@link BuildReviewModel}. */
export interface BuildReviewTables {
  buildReviews: Table;
}

/** Data operations for the verdicts reviewers give a build. */
export class BuildReviewModel {
  readonly #db: DatabaseAdapter;
  readonly #table: Table;

  constructor(db: DatabaseAdapter, tables?: BuildReviewTables) {
    this.#db = db;
    this.#table = (tables ?? { buildReviews: db.tables.buildReviews }).buildReviews;
  }

  /**
   * Record a verdict. A reviewer rewrites theirs by adding another row; the newest row counts.
   * `createdAt` is strictly increasing within a build, so "newest" never ties.
   */
  async add(
    buildId: string,
    userId: string | null,
    verdict: ReviewVerdict,
    body?: string,
  ): Promise<BuildReview> {
    const newest = (await this.listByBuild(buildId)).at(-1)?.createdAt;
    return (await this.#db.insert(this.#table, {
      id: ulid(),
      buildId,
      userId,
      verdict,
      body: body === undefined || body.length === 0 ? null : body,
      createdAt: after(newest),
    })) as unknown as BuildReview;
  }

  /** Every verdict of a build, oldest first. */
  async listByBuild(buildId: string): Promise<BuildReview[]> {
    const rows = (await this.#db.list(this.#table, {
      where: eq(col(this.#table, "buildId"), buildId),
      orderBy: asc(col(this.#table, "createdAt")),
    })) as unknown as BuildReview[];
    return rows.toSorted(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  }

  /** Each reviewer's latest verdict on a build. */
  async latestByBuild(buildId: string): Promise<BuildReview[]> {
    return latestVerdicts(await this.listByBuild(buildId));
  }
}

/** Now, or one millisecond past `newest` when the clock has not moved on. */
function after(newest: string | undefined): string {
  const now = Date.now();
  const floor = newest === undefined ? Number.NEGATIVE_INFINITY : Date.parse(newest) + 1;
  return new Date(Math.max(now, floor)).toISOString();
}
