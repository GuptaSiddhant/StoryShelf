/** Snapshot records for captured stories within a build. */
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../db/database.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import type { SnapshotStatus } from "../types.ts";
import { ulid } from "../utils/ulid.ts";

/** Tables required by {@link SnapshotModel}. */
export interface SnapshotTables {
  snapshots: Table;
}

/** Data operations for snapshot records. */
export class SnapshotModel {
  private readonly tables: SnapshotTables;
  /**
   * @param db - Database adapter.
   * @param tables - Table handles.
   */
  constructor(
    private readonly db: DatabaseAdapter,
    tables?: SnapshotTables,
  ) {
    this.tables = tables ?? { snapshots: db.tables.snapshots };
  }

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
    return (await this.db.insert(this.tables.snapshots, {
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
      infraHash: input.infraHash ?? null,
      inherited: input.inherited ?? false,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })) as unknown as Snapshot;
  }

  /** List all snapshots belonging to a build. */
  async listByBuild(buildId: string): Promise<Snapshot[]> {
    return (await this.db.list(this.tables.snapshots, {
      where: eq(
        getTableColumns(this.tables.snapshots)["buildId"] as unknown as SQLWrapper,
        buildId,
      ),
    })) as unknown as Snapshot[];
  }

  /** Fetch a snapshot by id, or null if not found. */
  async get(id: string): Promise<Snapshot | null> {
    return (await this.db.get(this.tables.snapshots, id)) as unknown as Snapshot | null;
  }

  /** Update mutable fields of a snapshot. */
  async update(id: string, patch: Partial<Snapshot>): Promise<Snapshot> {
    return (await this.db.update(this.tables.snapshots, id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    })) as unknown as Snapshot;
  }

  /** Set the status of a snapshot. */
  async setStatus(id: string, status: SnapshotStatus): Promise<Snapshot> {
    return await this.update(id, { status });
  }

  /** Record a reviewer's decision on a snapshot. */
  async review(id: string, status: SnapshotStatus, userId: string | null): Promise<Snapshot> {
    return await this.update(id, {
      status,
      reviewedBy: userId,
      reviewedAt: new Date().toISOString(),
    });
  }
}

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
  infraHash?: string | null;
  inherited?: boolean;
}
