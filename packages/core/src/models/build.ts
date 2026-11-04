/** Build records, status transitions, and publication helpers. */
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { SQL, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
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

  /** `logger` only reports a status write refused by a `cancelled` build, at debug. */
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
    const conditions = [eq(col(this.tables.builds, "projectId"), projectId)];
    if (filter.status) {
      conditions.push(eq(col(this.tables.builds, "status"), filter.status));
    }
    if (filter.branch) {
      conditions.push(eq(col(this.tables.builds, "gitBranch"), filter.branch));
    }
    if (filter.labelKey && filter.labelValue) {
      const labels = (await this.db.list(this.tables.buildLabels, {
        where: and(
          eq(col(this.tables.buildLabels, "projectId"), projectId),
          eq(col(this.tables.buildLabels, "typeKey"), filter.labelKey),
          eq(col(this.tables.buildLabels, "value"), filter.labelValue),
        ),
      })) as unknown as { buildId: string }[];
      const ids = labels.map((l) => l.buildId);
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

  /**
   * Patch a build. A `cancelled` build is terminal (ADR 0006): a patch that carries another status
   * is refused, the row is returned as it is, so a capture that ends after a cancel cannot move
   * the build. Only {@link BuildModel.resetStatus} leaves `cancelled`.
   */
  async update(
    id: string,
    patch: Partial<
      Pick<Build, "status" | "public" | "message" | "authorEmail" | "authorName" | "captureJobId">
    >,
    options: { reset?: boolean } = {},
  ): Promise<Build> {
    const values = { ...patch, updatedAt: new Date().toISOString() };
    if (patch.status === "pending") {
      const reopened = await this.reopen(id, values);
      if (reopened) return reopened;
    }
    if (patch.status !== undefined && patch.status !== "cancelled" && options.reset !== true) {
      const current = (await this.db.updateWhere(
        this.tables.builds,
        id,
        values,
        ne(col(this.tables.builds, "status"), "cancelled"),
      )) as unknown as Build | null;
      if (!current) throw new Error("Build not found");
      if (current.status === "cancelled") {
        this.logger?.debug(
          { buildId: id, refused: patch.status },
          "build is cancelled; status write refused",
        );
      }
      return current;
    }
    return (await this.db.update(this.tables.builds, id, values)) as unknown as Build;
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
      { ...values, reviewCycle: cycle + 1 } as never,
      and(
        inArray(col(builds, "status"), [...REVIEWED]),
        eq(col(builds, "reviewCycle"), cycle),
      ) as never,
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
      { reviewRequestedCycle: cycle, updatedAt: stamp } as never,
      and(
        eq(col(builds, "status"), "pending"),
        eq(col(builds, "reviewCycle"), cycle),
        requested === null
          ? isNull(col(builds, "reviewRequestedCycle"))
          : eq(col(builds, "reviewRequestedCycle"), requested),
      ) as never,
    )) as unknown as Build | null;
    return written && sameInstant(written.updatedAt, stamp) ? written : null;
  }

  async setStatus(id: string, status: BuildStatus): Promise<Build> {
    return await this.update(id, { status });
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
      values as never,
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
   * Record `jobId` as the capture job whose run owns the build (called once its job row exists),
   * only while the build is still at `generation`, the value the enqueue read before inserting the
   * job: one conditional write, so a stale enqueue never overwrites a newer run. `stale` means a
   * retry superseded this run (the caller cancels its job); `ignored` is a cancelled or missing
   * build, left alone.
   */
  async stampCaptureJob(
    id: string,
    jobId: string,
    generation: number,
  ): Promise<"stamped" | "stale" | "ignored"> {
    const stamp = nextStamp();
    const columns = this.tables.builds;
    const row = (await this.db.updateWhere(
      columns,
      id,
      { captureJobId: jobId, updatedAt: stamp },
      // `and` of two conditions is never undefined.
      and(
        ne(col(columns, "status"), "cancelled"),
        eq(col(columns, "captureGeneration"), generation),
      ) as SQL,
    )) as unknown as Build | null;
    if (row === null) {
      return "ignored";
    }
    if (row.captureJobId === jobId && instantOf(row.updatedAt) === instantOf(stamp)) {
      return "stamped";
    }
    return (row.captureGeneration ?? 0) === generation ? "ignored" : "stale";
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
      // `and` of two conditions is never undefined.
      and(
        inArray(col(columns, "status"), ["pending", "capturing"]),
        eq(col(columns, "captureJobId"), jobId),
      ) as SQL,
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
      ? (parsed as string[])
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
