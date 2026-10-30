/**
 * Baseline portability: export a project's baselines as a zip archive and
 * import (upsert) them from the same format. Format and limits live in
 * `baseline-archive.ts`; see the portability guide in the docs site.
 */
import { DEFAULT_BROWSER } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter, TxStore } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Baseline } from "../schema/baseline.ts";
import { withContentClaim } from "../utils/screenshot-store.ts";
import { ulid } from "../utils/ulid.ts";
import { baselineIdentity } from "./baseline-archive.ts";
import { exportBaselineArchive, type BaselineExportOptions } from "./baseline-export.ts";
import { planBaselineImport, writePlannedImage, type PlannedBaseline } from "./baseline-import.ts";
import { BaselineModel, type BaselineTables } from "./baseline.ts";

/** Outcome of {@link BaselineTransferModel.import}. */
export interface BaselineImportResult {
  /** Baselines in the archive (all applied). */
  imported: number;
  /** Baselines that did not exist before. */
  created: number;
  /** Existing baselines that were overwritten. */
  updated: number;
}

/** Export/import of baselines between StoryShelf instances (or for backup). */
export class BaselineTransferModel {
  private readonly tables: BaselineTables;
  private readonly baselines: BaselineModel;
  private readonly db: DatabaseAdapter;
  private readonly storage: StorageAdapter;

  constructor(db: DatabaseAdapter, storage: StorageAdapter, tables?: BaselineTables) {
    this.db = db;
    this.storage = storage;
    this.tables = tables ?? { baselines: db.tables.baselines };
    this.baselines = new BaselineModel(db, this.tables, storage);
  }

  /**
   * Stream the project's baselines (optionally one branch) as a zip archive.
   *
   * @throws {BaselineArchiveError} Before streaming, when over the archive entry limit.
   */
  async export(
    projectId: string,
    options: BaselineExportOptions = {},
  ): Promise<AsyncIterable<Buffer>> {
    return exportBaselineArchive(this.storage, await this.baselines.list(projectId), options);
  }

  /**
   * Upsert every baseline in `archive` into the project. The whole archive is
   * validated before anything is written; images are then stored (idempotent,
   * safe to retry) and all rows are applied in one transaction when the driver
   * supports it, so a failure leaves the rows untouched. Imports into the same
   * project run one at a time. Imported rows keep their original timestamps;
   * `snapshotId` is cleared because snapshots are not portable.
   *
   * @throws {BaselineArchiveError} On a malformed, unsafe, or inconsistent archive.
   */
  async import(projectId: string, archive: Buffer): Promise<BaselineImportResult> {
    const plan = await planBaselineImport(archive, projectId);
    // Images that already exist are reused, not written: claim the project's content so the
    // screenshot sweep cannot delete one before the rows pointing at it are committed.
    return await serialized(
      projectId,
      async () =>
        await withContentClaim(this.storage, projectId, async () => {
          for (const planned of plan) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- sequential writes bound storage load
            await writePlannedImage(this.storage, planned);
          }
          const existing = await this.existingByIdentity(projectId);
          const created = await this.applyRows(projectId, plan, existing);
          return { imported: plan.length, created, updated: plan.length - created };
        }),
    );
  }

  private async existingByIdentity(projectId: string): Promise<Map<string, Baseline>> {
    const rows = await this.baselines.list(projectId);
    return new Map(
      rows.map((row) => [
        baselineIdentity({
          storyId: row.storyId,
          viewport: row.viewportName,
          browser: row.browser ?? DEFAULT_BROWSER,
          branch: row.branch,
        }),
        row,
      ]),
    );
  }

  /** Apply every row, in a transaction when available; returns how many were created. */
  private async applyRows(
    projectId: string,
    plan: PlannedBaseline[],
    existing: Map<string, Baseline>,
  ): Promise<number> {
    const run = async (store: TxStore): Promise<number> => {
      let created = 0;
      for (const planned of plan) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- rows are applied in order within one transaction
        created += (await this.applyRow(store, projectId, planned, existing)) ? 1 : 0;
      }
      return created;
    };
    return this.db.transact ? await this.db.transact(run) : await run(this.db);
  }

  /** Write one planned row; resolves true when it was created. */
  private async applyRow(
    store: TxStore,
    projectId: string,
    planned: PlannedBaseline,
    existing: Map<string, Baseline>,
  ): Promise<boolean> {
    const { entry, storagePath } = planned;
    const fields = {
      snapshotId: null,
      sourceBuildId: null,
      screenshotPath: storagePath,
      infraHash: entry.infraHash,
      fingerprint: entry.fingerprint ?? null,
      mode: entry.mode,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    } satisfies Partial<Baseline>;
    const current = existing.get(baselineIdentity(entry));
    if (current) {
      await store.update(this.tables.baselines, current.id, fields);
      return false;
    }
    await store.insert(this.tables.baselines, {
      ...fields,
      id: ulid(),
      projectId,
      storyId: entry.storyId,
      viewportName: entry.viewport,
      branch: entry.branch,
      browser: entry.browser,
    });
    return true;
  }
}

const importQueues = new Map<string, Promise<unknown>>();

/** Run `task` after earlier work for the same key settles (in-process serialization). */
async function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (importQueues.get(key) ?? Promise.resolve()).then(task, task);
  importQueues.set(key, run);
  try {
    return await run;
  } finally {
    if (importQueues.get(key) === run) {
      importQueues.delete(key);
    }
  }
}
