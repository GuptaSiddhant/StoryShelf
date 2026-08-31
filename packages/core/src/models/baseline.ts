import { and, eq } from "drizzle-orm";

import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { emitWebhookEvent } from "../adapters/webhook-events.ts";
import { baselines, type Baseline } from "../schema.ts";
import { baselinePath } from "../utils/paths.ts";
import { ulid } from "../utils/ulid.ts";

/** Data and storage operations for per-branch baselines. */
export class BaselineModel {
  /**
   * @param db - Database adapter.
   * @param storage - Storage adapter used to read and write baseline images.
   */
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly storage: StorageAdapter,
  ) {}

  /**
   * Fetch the baseline for a specific story, viewport, and branch.
   *
   * @param projectId - Project ID.
   * @param storyId - Story ID.
   * @param viewport - Viewport name.
   * @param branch - Git branch.
   * @returns The matching baseline, or null.
   */
  async getFor(projectId: string, storyId: string, viewport: string, branch: string): Promise<Baseline | null> {
    const rows = await this.db.list(baselines, {
      where: and(eq(baselines.projectId, projectId), eq(baselines.storyId, storyId), eq(baselines.viewportName, viewport), eq(baselines.branch, branch)),
      limit: 1,
    });
    return rows[0] ?? null;
  }

  /**
   * Resolve the effective baseline, falling back to the default branch.
   *
   * @param projectId - Project ID.
   * @param storyId - Story ID.
   * @param viewport - Viewport name.
   * @param branch - Current git branch.
   * @param defaultBranch - Default branch used as fallback.
   * @returns The resolved baseline, or null.
   */
  async resolve(projectId: string, storyId: string, viewport: string, branch: string, defaultBranch: string): Promise<Baseline | null> {
    if (branch !== defaultBranch) {
      const own = await this.getFor(projectId, storyId, viewport, branch);
      if (own) {
        return own;
      }
    }
    return this.getFor(projectId, storyId, viewport, defaultBranch);
  }

  /** Read the screenshot bytes of a baseline. */
  async read(baseline: Baseline): Promise<Buffer> {
    return await this.storage.read(baseline.screenshotPath);
  }

  /**
   * Upsert a baseline for a story, copying the source screenshot into place.
   *
   * @param projectId - Project ID.
   * @param storyId - Story ID.
   * @param viewport - Viewport name.
   * @param branch - Git branch.
   * @param snapshotId - ID of the approving snapshot.
   * @param sourcePath - Storage path of the source screenshot.
   * @returns The created or updated baseline.
   */
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
    let baseline: Baseline;
    if (existing) {
      baseline = await this.db.update(baselines, existing.id, {
        snapshotId,
        screenshotPath,
        updatedAt: new Date().toISOString(),
      });
      await emitWebhookEvent(this.db, projectId, "baseline:updated", {
        baselineId: baseline.id,
        storyId,
        viewport,
        branch,
        snapshotId,
      });
    } else {
      const now = new Date().toISOString();
      baseline = await this.db.insert(baselines, {
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
      await emitWebhookEvent(this.db, projectId, "baseline:created", {
        baselineId: baseline.id,
        storyId,
        viewport,
        branch,
        snapshotId,
      });
    }
    return baseline;
  }

  /** List all baselines for a project. */
  async list(projectId: string): Promise<Baseline[]> {
    return await this.db.list(baselines, { where: eq(baselines.projectId, projectId) });
  }

  /**
   * Remove baselines whose stories are no longer valid.
   *
   * @param projectId - Project ID.
   * @param validStoryIds - Set of currently valid story IDs.
   * @returns The number of baselines removed.
   */
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
