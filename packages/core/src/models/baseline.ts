/* oxlint-disable typescript/promise-function-async -- map callbacks return promises from async helpers */
/** Per-branch baseline screenshots with default-branch fallback. */
import { and, eq, inArray } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import { DEFAULT_BROWSER } from "../adapters/capture-runner.ts";
import type { BuildReferenceLifecycle, DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { emitWebhookEvent } from "../adapters/webhook-events.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import type { SecretInput } from "../utils/encrypt.ts";
import { isContentPath } from "../utils/paths.ts";
import { storeScreenshot, withContentClaim } from "../utils/screenshot-store.ts";
import { ulid } from "../utils/ulid.ts";
import { approveInTransaction, type AtomicBaselineApproval } from "./baseline-approval.ts";
import { upsertAtomicBaseline } from "./baseline-atomic.ts";
import { BaselineWriteConflict } from "./baseline-conflict.ts";
import { BaselineMap } from "./baseline-map.ts";
import { assertBuildLive, assertBuildLiveInTx, type CapturingBuild } from "./baseline-promotion.ts";
import { col } from "./columns.ts";
import type { WebhookTables } from "./webhook.ts";

/** Extra identity/metadata for {@link BaselineModel.upsert}. */
export interface BaselineUpsertOptions {
  approval?: AtomicBaselineApproval;
  /**
   * The build whose capture promotes this baseline. The write is refused with
   * `BaselinePromotionRefused` (`baseline-conflict.ts`) when that build is `cancelled` or a retry has moved it to
   * another capture generation. With the reference lifecycle the check runs inside the same
   * transaction as the write; without it, immediately before the write.
   */
  capturingBuild?: CapturingBuild;
  /** Engine the baseline belongs to (default chromium). */
  browser?: string;
  /** Resolved mode definition as JSON (display only). */
  mode?: string | null;
  /** JSON `Fingerprint` behind the `infraHash` being written. */
  fingerprint?: string | null;
}

/** What one baseline write needs, resolved: the story, where it comes from, and the caller's options. */
interface UpsertInput {
  projectId: string;
  storyId: string;
  viewport: string;
  branch: string;
  snapshotId: string;
  sourceBuildId: string | null;
  originalPath: string;
  screenshotPath: string;
  infraHash: string | null | undefined;
  browser: string;
  options: BaselineUpsertOptions;
}

/** Tables required by {@link BaselineModel}. */
export interface BaselineTables {
  baselines: Table;
}

/** Data operations for baseline screenshots. */
export class BaselineModel {
  private readonly tables: BaselineTables;
  private readonly storage: StorageAdapter | undefined;
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
    this.storage = storage;
    this.secret = secret;
    this.webhookTables = webhookTables;
  }

  /** The storage adapter: a model built without one can still resolve baselines, but not read or store files. */
  #files(): StorageAdapter {
    if (!this.storage) {
      throw new Error("BaselineModel was created without a storage adapter");
    }
    return this.storage;
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

  /**
   * Every baseline a pass can compare against, in one query: the branch's own rows first, the default
   * branch's otherwise, for the given engines. Same answer as {@link resolve} per key.
   */
  async loadFor(
    projectId: string,
    branch: string,
    defaultBranch: string,
    browsers: readonly string[],
  ): Promise<BaselineMap> {
    const map = new BaselineMap();
    if (browsers.length === 0) return map;
    const rows = (await this.db.list(this.tables.baselines, {
      where: and(
        eq(col(this.tables.baselines, "projectId"), projectId),
        inArray(col(this.tables.baselines, "branch"), [...new Set([branch, defaultBranch])]),
        inArray(col(this.tables.baselines, "browser"), [...browsers]),
      ),
    })) as unknown as Baseline[];
    for (const row of rows.filter((candidate) => candidate.branch === branch)) map.add(row);
    for (const row of rows.filter((candidate) => candidate.branch !== branch)) map.add(row);
    return map;
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
    const lifecycle = this.db.buildReferenceLifecycle;
    if (lifecycle) {
      const owner = { type: "baseline" as const, id: baseline.id, projectId: baseline.projectId };
      const generation = await lifecycle.referenceGeneration(owner);
      await lifecycle.replaceFencedReferences(
        owner,
        generation,
        baseline.sourceBuildId ? [baseline.sourceBuildId] : [],
        async (tx) => {
          const current = (await tx.get(
            this.tables.baselines,
            baseline.id,
          )) as unknown as Baseline | null;
          if (
            !current ||
            current.projectId !== baseline.projectId ||
            current.updatedAt !== baseline.updatedAt ||
            current.sourceBuildId !== baseline.sourceBuildId ||
            current.screenshotPath !== baseline.screenshotPath ||
            current.fingerprint !== baseline.fingerprint
          )
            throw new BaselineWriteConflict("Baseline changed during fingerprint backfill; retry");
          await tx.update(this.tables.baselines, baseline.id, { infraHash, fingerprint });
        },
      );
      return;
    }
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
    const storage = this.#files();
    return await storeScreenshot(storage, projectId, await storage.read(sourcePath));
  }

  async read(baseline: Baseline): Promise<Buffer> {
    return await this.#files().read(baseline.screenshotPath);
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
        sourcePath,
        await this.contentFor(projectId, sourcePath),
        infraHash,
        options,
      );
    // Storing a legacy source may reuse an object the sweep is about to delete: claim it until the
    // row points at it. A content source is already referenced by its snapshot row.
    return isContentPath(projectId, sourcePath)
      ? await write()
      : await withContentClaim(this.#files(), projectId, write);
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
    originalPath: string,
    screenshotPath: string,
    infraHash: string | null | undefined,
    options: BaselineUpsertOptions,
  ): Promise<Baseline> {
    const input: UpsertInput = {
      projectId,
      storyId,
      viewport,
      branch,
      snapshotId,
      sourceBuildId,
      originalPath,
      screenshotPath,
      infraHash,
      browser: options.browser ?? DEFAULT_BROWSER,
      options,
    };
    const existing = await this.getFor(projectId, storyId, viewport, branch, input.browser);
    const lifecycle = this.db.buildReferenceLifecycle;
    if (!lifecycle && options.capturingBuild) {
      // No transaction to fence in: the narrowest window is a check right before the write.
      await assertBuildLive(this.db, options.capturingBuild);
    }
    const baseline = lifecycle
      ? await this.#upsertFenced(lifecycle, input, existing)
      : await this.#upsertUnfenced(input, existing);
    await this.#emitUpserted(baseline, input, existing !== null);
    return baseline;
  }

  /** Write through the lifecycle capability: the row, its references and the checks in one transaction. */
  async #upsertFenced(
    lifecycle: BuildReferenceLifecycle,
    input: UpsertInput,
    existing: Baseline | null,
  ): Promise<Baseline> {
    const { options } = input;
    const approval = options.approval;
    return await upsertAtomicBaseline(
      lifecycle,
      { baselines: this.tables.baselines, snapshots: this.db.tables.snapshots },
      {
        id: existing?.id ?? ulid(),
        existingId: existing?.id ?? null,
        existingVersion: existing?.updatedAt ?? null,
        projectId: input.projectId,
        storyId: input.storyId,
        viewport: input.viewport,
        branch: input.branch,
        browser: input.browser,
        snapshotId: input.snapshotId,
        sourceBuildId: input.sourceBuildId,
        originalPath: input.originalPath,
        screenshotPath: input.screenshotPath,
        infraHash: input.infraHash,
        fingerprint: options.fingerprint,
        mode: options.mode,
        beforeWrite: async (tx): Promise<void> => {
          if (options.capturingBuild) {
            await assertBuildLiveInTx(tx, this.db.tables.builds, options.capturingBuild);
          }
          if (approval) {
            await approveInTransaction(tx, this.db.tables, approval);
          }
        },
      },
    );
  }

  /** Write without the capability: update the existing row, or insert a new one. */
  async #upsertUnfenced(input: UpsertInput, existing: Baseline | null): Promise<Baseline> {
    const { options } = input;
    if (existing) {
      return (await this.db.update(this.tables.baselines, existing.id, {
        snapshotId: input.snapshotId,
        sourceBuildId: input.sourceBuildId,
        screenshotPath: input.screenshotPath,
        infraHash: input.infraHash ?? existing.infraHash ?? null,
        fingerprint: options.fingerprint ?? existing.fingerprint ?? null,
        mode: options.mode ?? existing.mode ?? null,
        updatedAt: new Date().toISOString(),
      })) as unknown as Baseline;
    }
    const now = new Date().toISOString();
    return (await this.db.insert(this.tables.baselines, {
      id: ulid(),
      projectId: input.projectId,
      storyId: input.storyId,
      viewportName: input.viewport,
      branch: input.branch,
      snapshotId: input.snapshotId,
      sourceBuildId: input.sourceBuildId,
      screenshotPath: input.screenshotPath,
      infraHash: input.infraHash ?? null,
      fingerprint: options.fingerprint ?? null,
      mode: options.mode ?? null,
      browser: input.browser,
      createdAt: now,
      updatedAt: now,
    })) as unknown as Baseline;
  }

  /** Tell the project's webhooks that a baseline was created or updated, when webhooks are wired. */
  async #emitUpserted(baseline: Baseline, input: UpsertInput, existed: boolean): Promise<void> {
    if (!this.webhookTables) {
      return;
    }
    await emitWebhookEvent(
      this.db,
      this.webhookTables,
      input.projectId,
      existed ? "baseline:updated" : "baseline:created",
      {
        baselineId: baseline.id,
        storyId: input.storyId,
        viewport: input.viewport,
        browser: input.browser,
        mode: input.options.mode ?? null,
        branch: input.branch,
        snapshotId: input.snapshotId,
      },
      this.secret,
    );
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
      await this.#files().delete(baseline.screenshotPath);
    } catch {
      // ignore missing file
    }
  }

  /** Drop the reference and row together when the adapter supports lifecycle protection. */
  private async removeRecord(baseline: Baseline): Promise<void> {
    const lifecycle = this.db.buildReferenceLifecycle;
    if (lifecycle) {
      const owner = { type: "baseline" as const, projectId: baseline.projectId, id: baseline.id };
      const generation = await lifecycle.referenceGeneration(owner);
      await lifecycle.replaceFencedReferences(owner, generation, [], async (tx) => {
        const current = (await tx.get(
          this.tables.baselines,
          baseline.id,
        )) as unknown as Baseline | null;
        if (!current) return;
        if (
          current.updatedAt !== baseline.updatedAt ||
          current.snapshotId !== baseline.snapshotId ||
          current.sourceBuildId !== baseline.sourceBuildId ||
          current.screenshotPath !== baseline.screenshotPath
        ) {
          throw new BaselineWriteConflict("Baseline changed during removal; retry");
        }
        await tx.remove(this.tables.baselines, baseline.id);
      });
      await this.discardFile(baseline);
      return;
    }
    await this.discardFile(baseline);
    await this.db.remove(this.tables.baselines, baseline.id);
  }

  async removeOrphans(projectId: string, validStoryIds: Set<string>): Promise<number> {
    const all = await this.list(projectId);
    const toRemove = all.filter((baseline) => !validStoryIds.has(baseline.storyId));
    await Promise.all(
      toRemove.map(async (baseline) => {
        await this.removeRecord(baseline);
      }),
    );
    return toRemove.length;
  }

  async removeForBranch(projectId: string, branch: string): Promise<number> {
    const all = await this.list(projectId);
    const toRemove = all.filter((baseline) => baseline.branch === branch);
    await Promise.all(
      toRemove.map(async (baseline) => {
        await this.removeRecord(baseline);
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
