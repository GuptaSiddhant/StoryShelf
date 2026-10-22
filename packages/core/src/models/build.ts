/** Build records, status transitions, and publication helpers. */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Logger } from "../logger.ts";
import type { Build } from "../schema/build.ts";
import type { BuildStatus } from "../types.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";

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
    patch: Partial<Pick<Build, "status" | "public" | "message" | "authorEmail" | "authorName">>,
    options: { reset?: boolean } = {},
  ): Promise<Build> {
    if (patch.status !== undefined && patch.status !== "cancelled" && options.reset !== true) {
      const current = await this.get(id);
      if (current?.status === "cancelled") {
        this.logger?.debug(
          { buildId: id, refused: patch.status },
          "build is cancelled; status write refused",
        );
        return current;
      }
    }
    return (await this.db.update(this.tables.builds, id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    })) as unknown as Build;
  }

  async setStatus(id: string, status: BuildStatus): Promise<Build> {
    return await this.update(id, { status });
  }

  /**
   * Put a finished build back to `status` for a retry. The one write that leaves `cancelled`
   * (a user chose it), so it skips the terminal guard of {@link BuildModel.update}.
   */
  async resetStatus(id: string, status: BuildStatus): Promise<Build> {
    return await this.update(id, { status }, { reset: true });
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
