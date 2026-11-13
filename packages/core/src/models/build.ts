/** Build records, status transitions, and publication helpers. */
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { SQL, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { allowedFrom, enteringFrom } from "../lifecycle/build-lifecycle.ts";
import type { Logger } from "../logger.ts";
import type { Build } from "../schema/build.ts";
import type { BuildStatus } from "../types.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

/** The verdict statuses; a build leaving them for `pending` is reopened. */
const REVIEWED: ReadonlySet<BuildStatus> = new Set<BuildStatus>(["approved", "rejected"]);

/** Reopening attempts when another writer changes the cycle between the read and the write. */
const REOPEN_ATTEMPTS = 3;

/** The last stamp handed out by `uniqueStamp` or `nextStamp`; both only ever move it forward. */
let lastStamp = 0;

/**
 * An ISO timestamp no other call in this process returns twice and later than `after` (the
 * `updatedAt` the row had), so it cannot be mistaken for a write that was already there.
 */
function uniqueStamp(after: string): string {
  const seen = Date.parse(after);
  lastStamp = Math.max(Date.now(), lastStamp + 1, Number.isNaN(seen) ? 0 : seen + 1);
  return new Date(lastStamp).toISOString();
}

const TIMESTAMP_TEXT =
  /^(?<day>\d{4}-\d\d-\d\d)[T ](?<time>\d\d:\d\d:\d\d(?:\.\d+)?)(?<zone>Z|[+-]\d\d(?::?\d\d)?)?$/u;

/** Whether two timestamp texts (ISO, or a driver's `YYYY-MM-DD HH:MM:SS.mmm+00`) are one instant. */
function sameInstant(left: string, right: string): boolean {
  const instants = [left, right].map((text) => {
    const found = TIMESTAMP_TEXT.exec(text)?.groups;
    if (!found) return Number.NaN;
    const zone = found["zone"] ?? "Z";
    const offset = /^[+-]\d\d$/u.test(zone) ? `${zone}:00` : zone;
    return Date.parse(`${found["day"]}T${found["time"]}${offset}`);
  });
  return !Number.isNaN(instants[0]) && instants[0] === instants[1];
}

/** Tables required by {@link BuildModel}. */
export interface BuildTables {
  builds: Table;
  buildLabels: Table;
  snapshots: Table;
}

/** Data operations for build records. */
export class BuildModel {
  private readonly tables: BuildTables;
  private readonly db: DatabaseAdapter;
  private readonly logger: Logger | undefined;

  /** `logger` only reports a status write the lifecycle table refuses, at debug. */
  constructor(db: DatabaseAdapter, tables?: BuildTables, logger?: Logger) {
    this.db = db;
    this.logger = logger;
    this.tables = tables ?? {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      snapshots: db.tables.snapshots,
    };
  }

  async create(projectId: string, input: BuildCreateInput): Promise<Build> {
    const now = new Date().toISOString();
    return (await this.db.insert(this.tables.builds, {
      id: ulid(),
      projectId,
      gitSha: input.gitSha,
      gitBranch: input.gitBranch,
      isDefault: input.isDefault ?? false,
      authorEmail: input.authorEmail,
      authorName: input.authorName,
      message: input.message,
      public: input.public ?? false,
      affectedOnly: input.affectedOnly ?? true,
      baselineSha: input.baselineSha ?? null,
      changedFiles: serializePaths(input.changedFiles),
      affectedImportPaths: serializePaths(input.affectedImportPaths),
      status: "pending",
      captureGeneration: 0,
      createdAt: now,
      updatedAt: now,
    })) as unknown as Build;
  }

  async get(id: string): Promise<Build | null> {
    return (await this.db.get(this.tables.builds, id)) as unknown as Build | null;
  }

  async list(projectId: string, filter: BuildListFilter = {}): Promise<Build[]> {
    const conditions = this.listConditions(projectId, filter);
    if (filter.labelKey && filter.labelValue) {
      const ids = await this.buildIdsWithLabel(projectId, filter.labelKey, filter.labelValue);
      if (ids.length === 0) {
        return [];
      }
      conditions.push(inArray(col(this.tables.builds, "id"), ids));
    }
    return (await this.db.list(this.tables.builds, {
      where: and(...conditions),
      orderBy: desc(col(this.tables.builds, "createdAt")),
      ...(filter.limit === undefined ? {} : { limit: filter.limit }),
    })) as unknown as Build[];
  }

  /** The status and branch conditions of a listing, after the project's own. */
  private listConditions(projectId: string, filter: BuildListFilter): SQL[] {
    const conditions = [eq(col(this.tables.builds, "projectId"), projectId)];
    if (filter.status) {
      conditions.push(eq(col(this.tables.builds, "status"), filter.status));
    }
    if (filter.branch) {
      conditions.push(eq(col(this.tables.builds, "gitBranch"), filter.branch));
    }
    return conditions;
  }

  private async buildIdsWithLabel(
    projectId: string,
    typeKey: string,
    value: string,
  ): Promise<string[]> {
    const { buildLabels } = this.tables;
    const labels = (await this.db.list(buildLabels, {
      where: allOf(
        eq(col(buildLabels, "projectId"), projectId),
        eq(col(buildLabels, "typeKey"), typeKey),
        eq(col(buildLabels, "value"), value),
      ),
    })) as unknown as { buildId: string }[];
    return labels.map((l) => l.buildId);
  }

  /**
   * Return the build a project-slug Storybook link resolves to: the most recent
   * `approved` build on the project's default branch. Approved builds on other
   * branches never qualify (their PR can still be dismissed), and neither do
   * pending, failed, or unreviewed default-branch builds. Visibility (public or
   * authenticated) is checked separately by the caller.
   */
  async latestApprovedDefault(project: {
    id: string;
    gitDefaultBranch: string;
  }): Promise<Build | null> {
    const rows = await this.list(project.id, {
      branch: project.gitDefaultBranch,
      status: "approved",
    });
    return rows[0] ?? null;
  }

  /** The newest approved build of commit `sha` on `branch`: the build affected capture compared against. */
  async comparisonBuild(projectId: string, branch: string, sha: string): Promise<Build | null> {
    const approved = await this.list(projectId, { branch, status: "approved" });
    return approved.find((build) => build.gitSha === sha) ?? null;
  }

  /** When each of the given builds was created, by id (a build that is gone is left out). */
  async createdAtOf(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = (await this.db.list(this.tables.builds, {
      where: inArray(col(this.tables.builds, "id"), [...ids]),
    })) as unknown as Build[];
    return new Map(rows.map((row) => [row.id, row.createdAt]));
  }

  /**
   * The newest build on `branch` whose outcome reached the baselines, other than one of commit
   * `excludeSha`: the comparison point of affected capture, which inherits every story it does not
   * render from the baselines. Only an `approved` build counts today; a build still being reviewed,
   * cancelled, failed or rejected is passed over, because its changes were never accepted and
   * inheriting past it would show them as unchanged. A planned `skipped` build (resolved to its
   * source) joins this rule here, so affected capture and skipping cannot drift apart.
   */
  async newestComparableBuild(
    projectId: string,
    branch: string,
    excludeSha: string,
  ): Promise<Build | null> {
    const approved = await this.list(projectId, { branch, status: "approved" });
    return approved.find((build) => build.gitSha !== excludeSha) ?? null;
  }

  /**
   * Patch a build. A status in the patch moves the build only along the lifecycle table (ADR 0046):
   * one conditional write, `WHERE status IN (the states that may move to it)` plus `fence`, so a
   * write that races a cancel, a retry or a verdict loses, across instances. A refused write is a
   * normal outcome: the row comes back as it is. Only {@link BuildModel.resetStatus} leaves `cancelled`.
   */
  async update(
    id: string,
    patch: Partial<
      Pick<Build, "status" | "public" | "message" | "authorEmail" | "authorName" | "captureJobId">
    >,
    fence?: SQL,
  ): Promise<Build> {
    const values = { ...patch, updatedAt: new Date().toISOString() };
    if (patch.status === undefined) {
      return (await this.db.update(this.tables.builds, id, values)) as unknown as Build;
    }
    if (patch.status === "pending" && fence === undefined) {
      const reopened = await this.reopen(id, values);
      if (reopened) return reopened;
    }
    return await this.moveStatus(id, values, patch.status, fence);
  }

  /** A status write the lifecycle table gates: a refused one returns the row as it is. */
  private async moveStatus(
    id: string,
    values: Record<string, unknown>,
    status: BuildStatus,
    fence: SQL | undefined,
  ): Promise<Build> {
    const statusColumn = col(this.tables.builds, "status");
    const current = (await this.db.updateWhere(
      this.tables.builds,
      id,
      values,
      allOf(
        inArray(statusColumn, [...allowedFrom(status)]),
        ...(fence === undefined ? [] : [fence]),
      ),
    )) as unknown as Build | null;
    if (!current) throw new Error("Build not found");
    if (current.status !== status) {
      this.logger?.debug(
        { buildId: id, refused: status, status: current.status },
        "build status write refused",
      );
    }
    return current;
  }

  /**
   * A verdict build going back to `pending` starts a new review cycle. The write is a
   * compare-and-set on the `review_cycle` just read (`WHERE status IN (approved, rejected) AND
   * review_cycle = ?`, setting it to the next value), so two writers cannot count one reopening
   * twice and a lost race is retried against the fresh row. Null when the build was in another
   * status (the plain write then applies).
   */
  private async reopen(
    id: string,
    values: Record<string, unknown>,
    attempts = REOPEN_ATTEMPTS,
  ): Promise<Build | null> {
    const { builds } = this.tables;
    const current = (await this.db.get(builds, id)) as unknown as Build | null;
    if (!current || !REVIEWED.has(current.status)) return null;
    const cycle = current.reviewCycle ?? 0;
    // A refused write returns the current row, so the outcome is read from it: `pending` means
    // this write or a concurrent reopening landed (counted once either way).
    const written = (await this.db.updateWhere(
      builds,
      id,
      { ...values, reviewCycle: cycle + 1 },
      allOf(inArray(col(builds, "status"), [...REVIEWED]), eq(col(builds, "reviewCycle"), cycle)),
    )) as unknown as Build | null;
    if (written?.status === "pending") return written;
    return attempts > 1 ? await this.reopen(id, values, attempts - 1) : null;
  }

  /**
   * Claim the right to announce this build's review request for its current cycle: one atomic
   * compare-and-set on the cycle and the requested cycle just read (`review_requested_cycle` goes
   * from NULL or an older cycle to `review_cycle`, only while `pending`), so it holds across
   * retries, concurrent hooks and instances. Resolves to the row, whose `reviewCycle` is the cycle
   * to announce, when this caller won; null when the cycle was already claimed or the build is not
   * `pending`.
   *
   * The adapter returns the current row for a refused write too, so the winner is the caller whose
   * own `updatedAt` stamp (unique within the process, later than the row's) is on the returned
   * row. Drivers hand a timestamp back in their own text form, so the two are compared as instants.
   */
  async claimReviewRequest(id: string): Promise<Build | null> {
    const { builds } = this.tables;
    const before = (await this.db.get(builds, id)) as unknown as Build | null;
    if (before?.status !== "pending") return null;
    const cycle = before.reviewCycle ?? 0;
    const requested = before.reviewRequestedCycle ?? null;
    if ((requested ?? -1) >= cycle) return null;
    const stamp = uniqueStamp(before.updatedAt);
    const written = (await this.db.updateWhere(
      builds,
      id,
      { reviewRequestedCycle: cycle, updatedAt: stamp },
      allOf(
        eq(col(builds, "status"), "pending"),
        eq(col(builds, "reviewCycle"), cycle),
        requested === null
          ? isNull(col(builds, "reviewRequestedCycle"))
          : eq(col(builds, "reviewRequestedCycle"), requested),
      ),
    )) as unknown as Build | null;
    return written && sameInstant(written.updatedAt, stamp) ? written : null;
  }

  /**
   * Claim the build's manifest (write-once publish, ADR 0051): one conditional write of
   * `manifest_sha256` while it is NULL. `claimed` means this caller owns the publish; `duplicate`
   * means the same manifest was already accepted; `conflict` means a different one was; `missing`
   * means the build is gone. The adapter hands back the current row for a refused write too, so the
   * winner is the caller whose own `updatedAt` stamp is on the returned row.
   */
  async claimManifest(id: string, sha256: string): Promise<ManifestClaim> {
    const { builds } = this.tables;
    const before = (await this.db.get(builds, id)) as unknown as Build | null;
    if (!before) return "missing";
    const stamp = uniqueStamp(before.updatedAt);
    const written = (await this.db.updateWhere(
      builds,
      id,
      { manifestSha256: sha256, updatedAt: stamp },
      isNull(col(builds, "manifestSha256")),
    )) as unknown as Build | null;
    if (!written) return "missing";
    if (written.manifestSha256 === sha256 && sameInstant(written.updatedAt, stamp)) {
      return "claimed";
    }
    return written.manifestSha256 === sha256 ? "duplicate" : "conflict";
  }

  /** Give the claim back (a failed publish) so a corrected manifest can be sent; only while it is still `sha256`. */
  async releaseManifest(id: string, sha256: string): Promise<void> {
    const { builds } = this.tables;
    await this.db.updateWhere(
      builds,
      id,
      { manifestSha256: null },
      eq(col(builds, "manifestSha256"), sha256),
    );
  }

  /**
   * Move the build to `status` if the lifecycle allows it from where it is; the row comes back
   * either way. `fence` is an extra condition for a status derived from other rows (see
   * `BuildReviewModel.newestVerdictIs`): the write applies only while it still holds.
   */
  async setStatus(id: string, status: BuildStatus, fence?: SQL): Promise<Build> {
    return await this.update(id, { status }, fence);
  }

  /**
   * Put a finished build back to `status` for a retry. The one write that leaves `cancelled`
   * (a user chose it), so it skips the terminal guard of {@link BuildModel.update}. It clears the
   * owning run and advances the run generation in one conditional write (compare-and-set on the
   * generation it read), so an enqueue that read the old generation can no longer stamp its job.
   */
  async resetStatus(id: string, status: BuildStatus): Promise<Build> {
    for (let attempt = 0; attempt < RESET_ATTEMPTS; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each retry needs the generation the loser lost to
      const reset = await this.resetOnce(id, status);
      if (reset !== null) {
        return reset;
      }
    }
    throw new Error("Build reset lost the race repeatedly");
  }

  /** One compare-and-set reset; null when another writer advanced the generation first. */
  private async resetOnce(id: string, status: BuildStatus): Promise<Build | null> {
    const current = await this.get(id);
    if (current === null) {
      throw new Error("Build not found");
    }
    const stamp = nextStamp();
    const generation = current.captureGeneration ?? 0;
    const { values, where } = this.resetWrite(current, status, stamp);
    const row = (await this.db.updateWhere(
      this.tables.builds,
      id,
      values,
      where,
    )) as unknown as Build | null;
    // Only our own write carries our stamp (see `failIfOwnedBy`).
    if (
      row?.captureGeneration !== generation + 1 ||
      instantOf(row.updatedAt) !== instantOf(stamp)
    ) {
      return null;
    }
    return row;
  }

  /**
   * The reset write and its condition. Always a compare-and-set on the run generation read. A
   * verdict build going back to `pending` also starts the next review cycle, as
   * {@link BuildModel.update} does for any such write, guarded by the cycle just read.
   */
  private resetWrite(
    current: Build,
    status: BuildStatus,
    stamp: string,
  ): { values: Record<string, unknown>; where: SQL } {
    const { builds } = this.tables;
    const generation = current.captureGeneration ?? 0;
    const base = {
      status,
      captureJobId: null,
      captureGeneration: generation + 1,
      updatedAt: stamp,
    };
    const sameGeneration = eq(col(builds, "captureGeneration"), generation);
    if (status !== "pending" || !REVIEWED.has(current.status)) {
      // Also the status just read: a verdict that lands before this write is not overwritten, and
      // the retry reads it and reopens its review cycle instead.
      return {
        values: base,
        where: allOf(sameGeneration, eq(col(builds, "status"), current.status)),
      };
    }
    const cycle = current.reviewCycle ?? 0;
    return {
      values: { ...base, reviewCycle: cycle + 1 },
      where: allOf(
        sameGeneration,
        inArray(col(builds, "status"), [...REVIEWED]),
        eq(col(builds, "reviewCycle"), cycle),
      ),
    };
  }

  /**
   * Claim the build for capture job `jobId` and start its run: one conditional write that records
   * the owner and advances the run generation from `generation` (the value the enqueue read). Of two
   * enqueues that read the same generation only one applies; the other comes back `stale` and must
   * not insert its job. `stamped` carries the new generation, which the job's payload holds so its
   * worker can tell a superseded run. `ignored` is a cancelled or missing build, left alone.
   */
  async stampCaptureJob(
    id: string,
    jobId: string,
    generation: number,
  ): Promise<{ result: "stamped"; generation: number } | { result: "stale" | "ignored" }> {
    const stamp = nextStamp();
    const columns = this.tables.builds;
    const row = (await this.db.updateWhere(
      columns,
      id,
      { captureJobId: jobId, captureGeneration: generation + 1, updatedAt: stamp },
      allOf(
        ne(col(columns, "status"), "cancelled"),
        eq(col(columns, "captureGeneration"), generation),
      ),
    )) as unknown as Build | null;
    if (row === null) {
      return { result: "ignored" };
    }
    if (row.captureJobId === jobId && instantOf(row.updatedAt) === instantOf(stamp)) {
      return { result: "stamped", generation: generation + 1 };
    }
    return { result: (row.captureGeneration ?? 0) === generation ? "ignored" : "stale" };
  }

  /**
   * Set the build's status only while it is still at run `generation` and the lifecycle allows the move from `capturing` (the state a run finalizes from): one
   * conditional write, so a worker of a superseded run (a retry started a newer one) writes nothing.
   * Resolves to whether it applied and the row as it stands.
   */
  async setStatusAtGeneration(
    id: string,
    status: BuildStatus,
    generation: number,
  ): Promise<{ applied: boolean; build: Build | null }> {
    const stamp = nextStamp();
    const columns = this.tables.builds;
    const build = (await this.db.updateWhere(
      columns,
      id,
      { status, updatedAt: stamp },
      allOf(
        inArray(
          col(columns, "status"),
          allowedFrom(status).filter((from) => from === "capturing" || from === status),
        ),
        eq(col(columns, "captureGeneration"), generation),
      ),
    )) as unknown as Build | null;
    // A refused write returns the row another writer left, whose stamp can equal ours in the same
    // millisecond: it only counts as ours if it also holds the status and generation we wrote.
    const applied =
      build?.status === status &&
      (build.captureGeneration ?? 0) === generation &&
      instantOf(build.updatedAt) === instantOf(stamp);
    return { applied, build };
  }

  /**
   * Fail the build only while capture job `jobId` still owns it and it is `pending` or
   * `capturing`: one conditional write, so a hook that outlived its run cannot fail a newer one.
   * Resolves to whether the write applied, and the row as it stands (null when the build is gone).
   */
  async failIfOwnedBy(
    id: string,
    jobId: string,
  ): Promise<{ applied: boolean; build: Build | null }> {
    const stamp = nextStamp();
    const columns = this.tables.builds;
    const current = (await this.db.updateWhere(
      columns,
      id,
      { status: "failed", updatedAt: stamp },
      allOf(
        inArray(col(columns, "status"), [...enteringFrom("failed")]),
        eq(col(columns, "captureJobId"), jobId),
      ),
    )) as unknown as Build | null;
    // `updateWhere` returns the row either way; only our own write carries our stamp. Compared as
    // instants: Postgres hands the column back as `2026-11-03 19:46:04.101+00`, not as the ISO we wrote.
    // A millisecond stamp can coincide with another instance's, but a refused write returns the row of
    // whichever job owns it, so the owner must be ours as well.
    const applied =
      current?.status === "failed" &&
      current.captureJobId === jobId &&
      instantOf(current.updatedAt) === instantOf(stamp);
    return { applied, build: current };
  }

  /**
   * Fail the build only while it is still `pending`: one conditional write, so a cancel, a verdict
   * or a retry that landed since the caller read the row is never overwritten. Resolves to whether
   * this write applied, and the row as it stands (null when the build is gone).
   */
  async failIfPending(id: string): Promise<{ applied: boolean; build: Build | null }> {
    const stamp = nextStamp();
    const columns = this.tables.builds;
    const current = (await this.db.updateWhere(
      columns,
      id,
      { status: "failed", updatedAt: stamp },
      eq(col(columns, "status"), "pending"),
    )) as unknown as Build | null;
    // `updateWhere` returns the row either way; only our own write carries our stamp (compared as
    // instants, as `failIfOwnedBy` does).
    const applied =
      current?.status === "failed" && instantOf(current.updatedAt) === instantOf(stamp);
    return { applied, build: current };
  }

  /**
   * Record the affected-capture computation for a build. Idempotent: the CLI
   * posts this once after creating the build and before uploading the bundle.
   */
  async setAffected(id: string, input: AffectedComputation): Promise<Build> {
    return (await this.db.update(this.tables.builds, id, {
      baselineSha: input.baselineSha,
      changedFiles: serializePaths(input.changedFiles),
      affectedImportPaths: serializePaths(input.affectedImportPaths),
      updatedAt: new Date().toISOString(),
    })) as unknown as Build;
  }

  /**
   * Store the results of the build's `.test()` entries (`TestResult[]`, as JSON), or clear them
   * with null. Written once per capture run, by the run that ran the tests.
   */
  async setTestResults(id: string, results: readonly unknown[] | null): Promise<Build> {
    return (await this.db.update(this.tables.builds, id, {
      testResults: results === null ? null : JSON.stringify(results),
      updatedAt: new Date().toISOString(),
    })) as unknown as Build;
  }

  /**
   * Parse a build's affected import paths. Returns `null` for full capture
   * (no computation, or an unreadable payload) — callers render everything.
   */
  static affectedPaths(build: Pick<Build, "affectedImportPaths">): string[] | null {
    return parsePaths(build.affectedImportPaths);
  }

  async updateCounts(id: string): Promise<Build> {
    const rows = (await this.db.list(this.tables.snapshots, {
      where: eq(col(this.tables.snapshots, "buildId"), id),
    })) as unknown as { status: string; inherited: boolean }[];
    const snapshotCount = rows.length;
    const changedCount = rows.filter((s) => s.status === "changed" || s.status === "new").length;
    const approvedCount = rows.filter(
      (s) => s.status === "approved" || s.status === "unchanged",
    ).length;
    const rejectedCount = rows.filter((s) => s.status === "rejected").length;
    const inheritedCount = rows.filter((s) => s.inherited).length;
    return (await this.db.update(this.tables.builds, id, {
      snapshotCount,
      changedCount,
      approvedCount,
      rejectedCount,
      inheritedCount,
      updatedAt: new Date().toISOString(),
    })) as unknown as Build;
  }

  async remove(id: string): Promise<void> {
    await this.db.remove(this.tables.builds, id);
  }
}

/**
 * Return whether a build is publicly viewable without a session.
 *
 * A build is public iff `builds.public` is set or its branch matches the
 * project's `public_branch_regex` (ADR 0011). Supplying an empty/nonexistent
 * regex makes every build require auth.
 */
export function isPublicBuild(
  project: { publicBranchRegex: string | null },
  build: Pick<Build, "public" | "gitBranch">,
): boolean {
  if (build.public) {
    return true;
  }
  if (!project.publicBranchRegex) {
    return false;
  }
  return new RegExp(project.publicBranchRegex, "u").test(build.gitBranch);
}

/** Input for creating a build. */
export interface BuildCreateInput {
  gitSha: string;
  gitBranch: string;
  isDefault?: boolean;
  authorEmail?: string;
  authorName?: string;
  message?: string;
  public?: boolean;
  affectedOnly?: boolean;
  baselineSha?: string | null;
  changedFiles?: string[] | null;
  affectedImportPaths?: string[] | null;
}

/** Affected-capture computation posted after build creation. */
export interface AffectedComputation {
  baselineSha: string | null;
  changedFiles: string[];
  affectedImportPaths: string[] | null;
}

/** Serialize an optional path list to its JSON text form (or null). */
function serializePaths(paths: string[] | null | undefined): string | null {
  if (!paths) {
    return null;
  }
  return JSON.stringify(paths);
}

/** Parse a JSON path list; null (full capture) on missing/invalid input. */
function parsePaths(raw: string | null): string[] | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** Filter options for listing builds. */
export interface BuildListFilter {
  status?: BuildStatus;
  branch?: string;
  labelKey?: string;
  labelValue?: string;
  /** Newest builds to return at most. */
  limit?: number;
}

/** How many times a reset re-reads the generation after losing a race to another reset. */
const RESET_ATTEMPTS = 5;

/** How {@link BuildModel.claimManifest} ended. */
export type ManifestClaim = "claimed" | "duplicate" | "conflict" | "missing";

/** The instant a stored timestamp names, in epoch ms, whichever string form the driver returns. */
function instantOf(value: string): number {
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) {
    return direct;
  }
  // `2026-11-03 19:46:04.101+00` (Postgres) is not ISO: make it so, for runtimes that do not guess.
  return Date.parse(value.replace(" ", "T").replace(/(?<hours>[+-]\d{2})$/u, "$<hours>:00"));
}

/** An ISO timestamp strictly later than the previous one this process handed out. */
function nextStamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

/** `and` of conditions, which is never undefined when it is given at least one. */
function allOf(first: SQL, ...rest: SQL[]): SQL {
  return and(first, ...rest) ?? first;
}
