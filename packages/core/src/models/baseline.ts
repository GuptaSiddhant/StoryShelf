/** Per-branch baseline screenshots with default-branch fallback. */
import { and, eq } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { emitWebhookEvent } from "../adapters/webhook-events.ts";
import { baselines } from "../schema/baseline.ts";
import type { Baseline } from "../schema/baseline.ts";
import { baselinePath } from "../utils/paths.ts";
import { ulid } from "../utils/ulid.ts";

/** Data operations for baseline screenshots. */
export class BaselineModel {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly storage: StorageAdapter,
  ) {}

  async getFor(
    projectId: string,
    storyId: string,
    viewport: string,
    branch: string,
  ): Promise<Baseline | null> {
    const rows = await this.db.list(baselines, {
      where: and(
        eq(baselines.projectId, projectId),
        eq(baselines.storyId, storyId),
        eq(baselines.viewportName, viewport),
        eq(baselines.branch, branch),
      ),
      limit: 1,
    });
    return rows[0] ?? null;
  }

  async resolve(
    projectId: string,
    storyId: string,
    viewport: string,
    branch: string,
    defaultBranch: string,
  ): Promise<Baseline | null> {
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
