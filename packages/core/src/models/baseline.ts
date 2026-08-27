import { and, eq } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { baselines, type Baseline } from "../schema.ts";
import { baselinePath } from "../utils/paths.ts";
import { ulid } from "../utils/ulid.ts";

export class BaselineModel {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly storage: StorageAdapter,
  ) {}

  async getFor(projectId: string, storyId: string, viewport: string, branch: string): Promise<Baseline | null> {
    const rows = await this.db.list(baselines, {
      where: and(eq(baselines.projectId, projectId), eq(baselines.storyId, storyId), eq(baselines.viewportName, viewport), eq(baselines.branch, branch)),
      limit: 1,
    });
    return rows[0] ?? null;
  }

  async resolve(projectId: string, storyId: string, viewport: string, branch: string, defaultBranch: string): Promise<Baseline | null> {
    if (branch !== defaultBranch) {
      const own = await this.getFor(projectId, storyId, viewport, branch);
      if (own) {
        return own;
      }
    }
    return this.getFor(projectId, storyId, viewport, defaultBranch);
  }

  async read(baseline: Baseline): Promise<Buffer> {
    return await this.storage.read(baseline.screenshotPath);
  }

  async upsert(
    projectId: string,
    storyId: string,
    viewport: string,
    branch: string,
    snapshotId: string,
    sourcePath: string,
  ): Promise<Baseline> {
    const screenshotPath = baselinePath(projectId, branch, storyId, viewport);
    const source = await this.storage.read(sourcePath);
    await this.storage.write(screenshotPath, source);

    const existing = await this.getFor(projectId, storyId, viewport, branch);
    if (existing) {
      return this.db.update(baselines, existing.id, {
        snapshotId,
        screenshotPath,
        updatedAt: new Date().toISOString(),
      });
    }
    const now = new Date().toISOString();
    return this.db.insert(baselines, {
      id: ulid(),
      projectId,
      storyId,
      viewportName: viewport,
      branch,
      snapshotId,
      screenshotPath,
      createdAt: now,
      updatedAt: now,
    });
  }

  async list(projectId: string): Promise<Baseline[]> {
    return await this.db.list(baselines, { where: eq(baselines.projectId, projectId) });
  }

  async removeOrphans(projectId: string, validStoryIds: Set<string>): Promise<number> {
    const all = await this.list(projectId);
    const toRemove = all.filter((baseline) => !validStoryIds.has(baseline.storyId));
    await Promise.all(
      toRemove.map(async (baseline) => {
        await this.db.remove(baselines, baseline.id);
      }),
    );
    return toRemove.length;
  }
}

export type { Baseline };
