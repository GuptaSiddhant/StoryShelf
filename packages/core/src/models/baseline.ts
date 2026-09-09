/* oxlint-disable typescript/promise-function-async -- map callbacks return promises from async helpers */
/** Per-branch baseline screenshots with default-branch fallback. */
import { and, eq } from "drizzle-orm";
import type { SQLWrapper, Table } from "drizzle-orm";
import type { StorageAdapter } from "../adapters/storage.ts";
import { emitWebhookEvent } from "../adapters/webhook-events.ts";
import type { DatabaseAdapter } from "../db/database.ts";
import type { Baseline } from "../schema/baseline.ts";
import { baselinePath } from "../utils/paths.ts";
import { ulid } from "../utils/ulid.ts";
import type { WebhookTables } from "./webhook.ts";

/** Tables required by {@link BaselineModel}. */
export interface BaselineTables {
  baselines: {
    projectId: SQLWrapper;
    storyId: SQLWrapper;
    viewportName: SQLWrapper;
    branch: SQLWrapper;
  } & Table & { $inferSelect: Baseline; $inferInsert: Baseline };
}

/** Data operations for baseline screenshots. */
export class BaselineModel {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly tables: BaselineTables,
    private readonly storage: StorageAdapter,
    private readonly secret?: string,
    private readonly webhookTables?: WebhookTables,
  ) {}

  async getFor(
    projectId: string,
    storyId: string,
    viewport: string,
    branch: string,
  ): Promise<Baseline | null> {
    const rows = await this.db.list(this.tables.baselines, {
      where: and(
        eq(this.tables.baselines.projectId, projectId),
        eq(this.tables.baselines.storyId, storyId),
        eq(this.tables.baselines.viewportName, viewport),
        eq(this.tables.baselines.branch, branch),
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
      baseline = await this.db.update(this.tables.baselines, existing.id, {
        snapshotId,
        screenshotPath,
        updatedAt: new Date().toISOString(),
      } as never);
      if (this.webhookTables) {
        await emitWebhookEvent(
          this.db,
          this.webhookTables,
          projectId,
          "baseline:updated",
          {
            baselineId: baseline.id,
            storyId,
            viewport,
            branch,
            snapshotId,
          },
          this.secret,
        );
      }
    } else {
      const now = new Date().toISOString();
      baseline = await this.db.insert(this.tables.baselines, {
        id: ulid(),
        projectId,
        storyId,
        viewportName: viewport,
        branch,
        snapshotId,
        screenshotPath,
        createdAt: now,
        updatedAt: now,
      } as never);
      if (this.webhookTables) {
        await emitWebhookEvent(
          this.db,
          this.webhookTables,
          projectId,
          "baseline:created",
          {
            baselineId: baseline.id,
            storyId,
            viewport,
            branch,
            snapshotId,
          },
          this.secret,
        );
      }
    }
    return baseline;
  }

  async list(projectId: string): Promise<Baseline[]> {
    return await this.db.list(this.tables.baselines, {
      where: eq(this.tables.baselines.projectId, projectId),
    });
  }

  async removeOrphans(projectId: string, validStoryIds: Set<string>): Promise<number> {
    const all = await this.list(projectId);
    const toRemove = all.filter((baseline) => !validStoryIds.has(baseline.storyId));
    await Promise.all(
      toRemove.map(async (baseline) => {
        try {
          await this.storage.delete(baseline.screenshotPath);
        } catch {
          // ignore missing file
        }
        await this.db.remove(this.tables.baselines, baseline.id);
      }),
    );
    return toRemove.length;
  }

  async removeForBranch(projectId: string, branch: string): Promise<number> {
    const all = await this.list(projectId);
    const toRemove = all.filter((baseline) => baseline.branch === branch);
    await Promise.all(
      toRemove.map(async (baseline) => {
        try {
          await this.storage.delete(baseline.screenshotPath);
        } catch {
          // ignore missing file
        }
        await this.db.remove(this.tables.baselines, baseline.id);
      }),
    );
    return toRemove.length;
  }

  // oxlint-disable-next-line eslint/require-await -- delegates to async removeForBranch via Promise.all
  async removeStaleBranches(
    projectId: string,
    staleBranches: ReadonlySet<string>,
  ): Promise<number> {
    if (staleBranches.size === 0) {
      return 0;
    }
    const results = await Promise.all(
      [...staleBranches].map((branch) => this.removeForBranch(projectId, branch)),
    );
    return results.reduce((sum, count) => sum + count, 0);
  }
}
