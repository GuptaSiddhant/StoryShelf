/* oxlint-disable typescript/promise-function-async -- map callbacks return promises from async helpers */
/** Per-branch baseline screenshots with default-branch fallback. */
import { and, eq } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import { DEFAULT_BROWSER } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { emitWebhookEvent } from "../adapters/webhook-events.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import type { SecretInput } from "../utils/encrypt.ts";
import { isContentPath } from "../utils/paths.ts";
import { storeScreenshot, withContentClaim } from "../utils/screenshot-store.ts";
import { ulid } from "../utils/ulid.ts";
import { col } from "./columns.ts";
import type { WebhookTables } from "./webhook.ts";

/** Extra identity/metadata for {@link BaselineModel.upsert}. */
export interface BaselineUpsertOptions {
  /** Engine the baseline belongs to (default chromium). */
  browser?: string;
  /** Resolved mode definition as JSON (display only). */
  mode?: string | null;
  /** JSON `Fingerprint` behind the `infraHash` being written. */
  fingerprint?: string | null;
}

/** Tables required by {@link BaselineModel}. */
export interface BaselineTables {
  baselines: Table;
}

/** Data operations for baseline screenshots. */
export class BaselineModel {
  private readonly tables: BaselineTables;
  private readonly storage: StorageAdapter;
  private readonly secret?: SecretInput;
  private readonly webhookTables?: WebhookTables;
  private readonly db: DatabaseAdapter;

  constructor(
    db: DatabaseAdapter,
    tables?: BaselineTables,
    storage?: StorageAdapter,
    secret?: SecretInput,
    webhookTables?: WebhookTables,
  ) {
    this.db = db;
    this.tables = tables ?? { baselines: db.tables.baselines };
    this.storage = storage as StorageAdapter;
    this.secret = secret;
    this.webhookTables = webhookTables;
  }

  async getFor(
    projectId: string,
    storyId: string,
    viewport: string,
    branch: string,
    browser: string = DEFAULT_BROWSER,
  ): Promise<Baseline | null> {
    const rows = (await this.db.list(this.tables.baselines, {
      where: and(
        eq(col(this.tables.baselines, "projectId"), projectId),
        eq(col(this.tables.baselines, "storyId"), storyId),
        eq(col(this.tables.baselines, "viewportName"), viewport),
        eq(col(this.tables.baselines, "branch"), branch),
        eq(col(this.tables.baselines, "browser"), browser),
      ),
      limit: 1,
    })) as unknown as Baseline[];
    return rows[0] ?? null;
  }

  async resolve(
    projectId: string,
    storyId: string,
    viewport: string,
    branch: string,
    defaultBranch: string,
    browser: string = DEFAULT_BROWSER,
  ): Promise<Baseline | null> {
    if (branch !== defaultBranch) {
      const own = await this.getFor(projectId, storyId, viewport, branch, browser);
      if (own) {
        return own;
      }
    }
    return this.getFor(projectId, storyId, viewport, defaultBranch, browser);
  }

  /** Whether the project has any baseline captured on this engine. */
  async hasAny(projectId: string, browser: string): Promise<boolean> {
    const rows = (await this.db.list(this.tables.baselines, {
      where: and(
        eq(col(this.tables.baselines, "projectId"), projectId),
        eq(col(this.tables.baselines, "browser"), browser),
      ),
      limit: 1,
    })) as unknown as Baseline[];
    return rows.length > 0;
  }

  /**
   * Record the fingerprint of a baseline that predates fingerprints, without touching its
   * screenshot. Lets the next environment change be detected instead of diffing as a regression.
   */
  async backfillFingerprint(
    baseline: Baseline,
    infraHash: string,
    fingerprint: string,
  ): Promise<void> {
    await this.db.update(this.tables.baselines, baseline.id, { infraHash, fingerprint });
  }

  /**
   * The content-addressed object a baseline should point at. A source that already is one is
   * reused as is (no copy); a legacy per-build path is stored once by content.
   */
  private async contentFor(projectId: string, sourcePath: string): Promise<string> {
    if (isContentPath(projectId, sourcePath)) {
      return sourcePath;
    }
    return await storeScreenshot(this.storage, projectId, await this.storage.read(sourcePath));
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
    infraHash?: string | null,
    options: BaselineUpsertOptions = {},
  ): Promise<Baseline> {
    const sourceBuildId = await this.sourceBuildId(
      projectId,
      storyId,
      viewport,
      snapshotId,
      sourcePath,
      options.browser,
    );
    const write = async (): Promise<Baseline> =>
      await this.#upsertAt(
        projectId,
        storyId,
        viewport,
        branch,
        snapshotId,
        sourceBuildId,
        await this.contentFor(projectId, sourcePath),
        infraHash,
        options,
      );
    // Storing a legacy source may reuse an object the sweep is about to delete: claim it until the
    // row points at it. A content source is already referenced by its snapshot row.
    return isContentPath(projectId, sourcePath)
      ? await write()
      : await withContentClaim(this.storage, projectId, write);
  }

  private async sourceBuildId(
    projectId: string,
    storyId: string,
    viewport: string,
    snapshotId: string,
    sourcePath: string,
    browser: string = DEFAULT_BROWSER,
  ): Promise<string | null> {
    const snapshot = (await this.db.get(
      this.db.tables.snapshots,
      snapshotId,
    )) as unknown as Snapshot | null;
    if (
      !snapshot ||
      snapshot.projectId !== projectId ||
      snapshot.storyId !== storyId ||
      snapshot.viewportName !== viewport ||
      (snapshot.browser ?? DEFAULT_BROWSER) !== browser ||
      snapshot.screenshotPath !== sourcePath
    )
      return null;
    return snapshot.inherited ? (snapshot.sourceBuildId ?? null) : snapshot.buildId;
  }

  async #upsertAt(
    projectId: string,
    storyId: string,
    viewport: string,
    branch: string,
    snapshotId: string,
    sourceBuildId: string | null,
    screenshotPath: string,
    infraHash: string | null | undefined,
    options: BaselineUpsertOptions,
  ): Promise<Baseline> {
    const browser = options.browser ?? DEFAULT_BROWSER;

    const existing = await this.getFor(projectId, storyId, viewport, branch, browser);
    let baseline: Baseline;
    if (existing) {
      baseline = (await this.db.update(this.tables.baselines, existing.id, {
        snapshotId,
        sourceBuildId,
        screenshotPath,
        infraHash: infraHash ?? existing.infraHash ?? null,
        fingerprint: options.fingerprint ?? existing.fingerprint ?? null,
        mode: options.mode ?? existing.mode ?? null,
        updatedAt: new Date().toISOString(),
      })) as unknown as Baseline;
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
            browser,
            mode: options.mode ?? null,
            branch,
            snapshotId,
          },
          this.secret,
        );
      }
    } else {
      const now = new Date().toISOString();
      baseline = (await this.db.insert(this.tables.baselines, {
        id: ulid(),
        projectId,
        storyId,
        viewportName: viewport,
        branch,
        snapshotId,
        sourceBuildId,
        screenshotPath,
        infraHash: infraHash ?? null,
        fingerprint: options.fingerprint ?? null,
        mode: options.mode ?? null,
        browser,
        createdAt: now,
        updatedAt: now,
      })) as unknown as Baseline;
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
            browser,
            mode: options.mode ?? null,
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
    return (await this.db.list(this.tables.baselines, {
      where: eq(col(this.tables.baselines, "projectId"), projectId),
    })) as unknown as Baseline[];
  }

  /**
   * Delete a baseline's own file. A content-addressed screenshot is shared with snapshots and other
   * baselines, so it is left for the retention sweep instead.
   */
  private async discardFile(baseline: Baseline): Promise<void> {
    if (isContentPath(baseline.projectId, baseline.screenshotPath)) {
      return;
    }
    try {
      await this.storage.delete(baseline.screenshotPath);
    } catch {
      // ignore missing file
    }
  }

  async removeOrphans(projectId: string, validStoryIds: Set<string>): Promise<number> {
    const all = await this.list(projectId);
    const toRemove = all.filter((baseline) => !validStoryIds.has(baseline.storyId));
    await Promise.all(
      toRemove.map(async (baseline) => {
        await this.discardFile(baseline);
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
        await this.discardFile(baseline);
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
