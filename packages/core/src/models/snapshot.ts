/** Snapshot records for captured stories within a build. */
import { eq } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { snapshots } from "../schema-tables.ts";
import type { Snapshot } from "../schema.ts";
import type { SnapshotStatus } from "../types.ts";
import { ulid } from "../utils/ulid.ts";

/** Input for creating a snapshot. */
export interface SnapshotCreateInput {
  storyId: string;
  storyName: string;
  storyTitle: string;
  storyImportPath?: string;
  viewportName: string;
  viewportWidth: number;
  viewportHeight: number;
  screenshotPath: string;
}

/** Data operations for snapshot records. */
export class SnapshotModel {
  /**
   * @param db - Database adapter.
   */
  constructor(private readonly db: DatabaseAdapter) {}

  /**
   * Create a snapshot for a story within a build.
   *
   * @param projectId - Project ID.
   * @param buildId - Build ID.
   * @param input - Snapshot creation input.
   * @returns The created snapshot.
   */
  async create(projectId: string, buildId: string, input: SnapshotCreateInput): Promise<Snapshot> {
    const now = new Date().toISOString();
    return await this.db.insert(snapshots, {
      id: ulid(),
      projectId,
      buildId,
      storyId: input.storyId,
      storyName: input.storyName,
      storyTitle: input.storyTitle,
      storyImportPath: input.storyImportPath,
      viewportName: input.viewportName,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      screenshotPath: input.screenshotPath,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  }

  /** List all snapshots belonging to a build. */
  async listByBuild(buildId: string): Promise<Snapshot[]> {
    return await this.db.list(snapshots, { where: eq(snapshots.buildId, buildId) });
  }

  /** Fetch a snapshot by id, or null if not found. */
  async get(id: string): Promise<Snapshot | null> {
    return await this.db.get(snapshots, id);
  }

  /** Update mutable fields of a snapshot. */
  async update(id: string, patch: Partial<Snapshot>): Promise<Snapshot> {
    return await this.db.update(snapshots, id, { ...patch, updatedAt: new Date().toISOString() });
  }

  /** Set the status of a snapshot. */
  async setStatus(id: string, status: SnapshotStatus): Promise<Snapshot> {
    return await this.update(id, { status });
  }

  /** Record a reviewer's decision on a snapshot. */
  async review(id: string, status: SnapshotStatus, userId: string): Promise<Snapshot> {
    return await this.update(id, {
      status,
      reviewedBy: userId,
      reviewedAt: new Date().toISOString(),
    });
  }
}

export type { Snapshot };
