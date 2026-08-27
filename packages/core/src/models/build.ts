import { and, desc, eq, inArray } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import { buildLabels, builds, snapshots, type Build } from "../schema.ts";
import type { BuildStatus } from "../types.ts";
import { ulid } from "../utils/ulid.ts";

export interface BuildCreateInput {
  gitSha: string;
  gitBranch: string;
  isDefault?: boolean;
  authorEmail?: string;
  authorName?: string;
  message?: string;
  public?: boolean;
}

export interface BuildListFilter {
  status?: BuildStatus;
  branch?: string;
  labelKey?: string;
  labelValue?: string;
}

/** Data operations for build records. */
export class BuildModel {
  /**
   * @param db - Database adapter.
   */
  constructor(private readonly db: DatabaseAdapter) {}

  /**
   * Create a new build for a project.
   *
   * @param projectId - Project ID.
   * @param input - Build creation input.
   * @returns The created build.
   */
  async create(projectId: string, input: BuildCreateInput): Promise<Build> {
    const now = new Date().toISOString();
    return await this.db.insert(builds, {
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
    });
  }

  /** Fetch a build by id, or null if not found. */
  async get(id: string): Promise<Build | null> {
    return await this.db.get(builds, id);
  }

  /**
   * List builds for a project, optionally filtered.
   *
   * @param projectId - Project ID.
   * @param filter - Optional status, branch, or label filter.
   * @returns The matching builds, newest first.
   */
  async list(projectId: string, filter: BuildListFilter = {}): Promise<Build[]> {
    const conditions = [eq(builds.projectId, projectId)];
    if (filter.status) {
      conditions.push(eq(builds.status, filter.status));
    }
    if (filter.branch) {
      conditions.push(eq(builds.gitBranch, filter.branch));
    }
    if (filter.labelKey && filter.labelValue) {
      const labels = await this.db.list(buildLabels, {
        where: and(eq(buildLabels.projectId, projectId), eq(buildLabels.typeKey, filter.labelKey), eq(buildLabels.value, filter.labelValue)),
      });
      const ids = labels.map((l) => l.buildId);
      if (ids.length === 0) {
        return [];
      }
      conditions.push(inArray(builds.id, ids));
    }
    return this.db.list(builds, { where: and(...conditions), orderBy: desc(builds.createdAt) });
  }

  /** Update mutable fields of a build. */
  async update(id: string, patch: Partial<Pick<Build, "status" | "public" | "message" | "authorEmail" | "authorName">>): Promise<Build> {
    return await this.db.update(builds, id, { ...patch, updatedAt: new Date().toISOString() });
  }

  /** Set the status of a build. */
  async setStatus(id: string, status: BuildStatus): Promise<Build> {
    return await this.update(id, { status });
  }

  /** Recompute and persist snapshot count aggregates for a build. */
  async updateCounts(id: string): Promise<Build> {
    const rows = await this.db.list(snapshots, { where: eq(snapshots.buildId, id) });
    const snapshotCount = rows.length;
    const changedCount = rows.filter((s) => s.status === "changed" || s.status === "new").length;
    const approvedCount = rows.filter((s) => s.status === "approved" || s.status === "unchanged").length;
    const rejectedCount = rows.filter((s) => s.status === "rejected").length;
    return this.db.update(builds, id, {
      snapshotCount,
      changedCount,
      approvedCount,
      rejectedCount,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Delete a build by id. */
  async remove(id: string): Promise<void> {
    await this.db.remove(builds, id);
  }
}

export type { Build };
