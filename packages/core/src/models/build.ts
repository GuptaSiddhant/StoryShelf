/** Build records, status transitions, and publication helpers. */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { Build } from "../schema/build.ts";
import type { BuildLabel } from "../schema/label.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import type { BuildStatus } from "../types.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link BuildModel}. */
export interface BuildTables {
  builds: {
    id: SQLWrapper;
    projectId: SQLWrapper;
    status: SQLWrapper;
    gitBranch: SQLWrapper;
    createdAt: SQLWrapper;
  } & Table & { $inferSelect: Build; $inferInsert: Build };
  buildLabels: {
    projectId: SQLWrapper;
    typeKey: SQLWrapper;
    value: SQLWrapper;
    buildId: SQLWrapper;
  } & Table & { $inferSelect: BuildLabel; $inferInsert: BuildLabel };
  snapshots: { buildId: SQLWrapper } & Table & { $inferSelect: Snapshot; $inferInsert: Snapshot };
}

/** Data operations for build records. */
export class BuildModel {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly tables: BuildTables,
  ) {}

  async create(projectId: string, input: BuildCreateInput): Promise<Build> {
    const now = new Date().toISOString();
    return await this.db.insert(this.tables.builds, {
      id: ulid(),
      projectId,
      gitSha: input.gitSha,
      gitBranch: input.gitBranch,
      isDefault: input.isDefault ?? false,
      authorEmail: input.authorEmail,
      authorName: input.authorName,
      message: input.message,
      public: input.public ?? false,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    } as never);
  }

  async get(id: string): Promise<Build | null> {
    return await this.db.get(this.tables.builds, id);
  }

  async list(projectId: string, filter: BuildListFilter = {}): Promise<Build[]> {
    const conditions = [eq(this.tables.builds.projectId, projectId)];
    if (filter.status) {
      conditions.push(eq(this.tables.builds.status, filter.status));
    }
    if (filter.branch) {
      conditions.push(eq(this.tables.builds.gitBranch, filter.branch));
    }
    if (filter.labelKey && filter.labelValue) {
      const labels = await this.db.list(this.tables.buildLabels, {
        where: and(
          eq(this.tables.buildLabels.projectId, projectId),
          eq(this.tables.buildLabels.typeKey, filter.labelKey),
          eq(this.tables.buildLabels.value, filter.labelValue),
        ),
      });
      const ids = labels.map((l) => l.buildId);
      if (ids.length === 0) {
        return [];
      }
      conditions.push(inArray(this.tables.builds.id, ids));
    }
    return this.db.list(this.tables.builds, {
      where: and(...conditions),
      orderBy: desc(this.tables.builds.createdAt),
    });
  }

  /** Return the most recent build intended for publishing, if any. */
  async latestPublished(project: {
    id: string;
    publicBranchRegex: string | null;
  }): Promise<Build | null> {
    const rows = await this.list(project.id);
    for (const build of rows) {
      if (isPublicBuild(project, build)) {
        return build;
      }
    }
    return null;
  }

  async update(
    id: string,
    patch: Partial<Pick<Build, "status" | "public" | "message" | "authorEmail" | "authorName">>,
  ): Promise<Build> {
    return await this.db.update(this.tables.builds, id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    } as never);
  }

  async setStatus(id: string, status: BuildStatus): Promise<Build> {
    return await this.update(id, { status });
  }

  async updateCounts(id: string): Promise<Build> {
    const rows = await this.db.list(this.tables.snapshots, {
      where: eq(this.tables.snapshots.buildId, id),
    });
    const snapshotCount = rows.length;
    const changedCount = rows.filter((s) => s.status === "changed" || s.status === "new").length;
    const approvedCount = rows.filter(
      (s) => s.status === "approved" || s.status === "unchanged",
    ).length;
    const rejectedCount = rows.filter((s) => s.status === "rejected").length;
    return this.db.update(this.tables.builds, id, {
      snapshotCount,
      changedCount,
      approvedCount,
      rejectedCount,
      updatedAt: new Date().toISOString(),
    } as never);
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
}

/** Filter options for listing builds. */
export interface BuildListFilter {
  status?: BuildStatus;
  branch?: string;
  labelKey?: string;
  labelValue?: string;
}
