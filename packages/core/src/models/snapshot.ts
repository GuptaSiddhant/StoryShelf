import { eq } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import { snapshots, type Snapshot } from "../schema.ts";
import type { SnapshotStatus } from "../types.ts";
import { ulid } from "../utils/ulid.ts";

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

export class SnapshotModel {
  constructor(private readonly db: DatabaseAdapter) {}

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

  async listByBuild(buildId: string): Promise<Snapshot[]> {
    return await this.db.list(snapshots, { where: eq(snapshots.buildId, buildId) });
  }

  async get(id: string): Promise<Snapshot | null> {
    return await this.db.get(snapshots, id);
  }

  async update(id: string, patch: Partial<Snapshot>): Promise<Snapshot> {
    return await this.db.update(snapshots, id, { ...patch, updatedAt: new Date().toISOString() });
  }

  async setStatus(id: string, status: SnapshotStatus): Promise<Snapshot> {
    return await this.update(id, { status });
  }

  async review(id: string, status: SnapshotStatus, userId: string): Promise<Snapshot> {
    return await this.update(id, { status, reviewedBy: userId, reviewedAt: new Date().toISOString() });
  }
}

export type { Snapshot };
