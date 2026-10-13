/**
 * Baseline portability: export a project's baselines as a zip archive and
 * import (upsert) them from the same format. Format and limits live in
 * `baseline-archive.ts`; see the portability guide in the docs site.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Baseline } from "../schema/baseline.ts";
import { ulid } from "../utils/ulid.ts";
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
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly storage: StorageAdapter,
    tables?: BaselineTables,
  ) {
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
   * validated before anything is written. Imported rows keep their original
   * timestamps; `snapshotId` is cleared because snapshots are not portable.
   *
   * @throws {BaselineArchiveError} On a malformed, unsafe, or inconsistent archive.
   */
  async import(projectId: string, archive: Buffer): Promise<BaselineImportResult> {
    const plan = planBaselineImport(archive, projectId);
    let created = 0;
    for (const planned of plan) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential writes bound memory and storage load
      created += (await this.apply(projectId, planned)) ? 1 : 0;
    }
    return { imported: plan.length, created, updated: plan.length - created };
  }

  /** Write one planned baseline; resolves true when the row was created. */
  private async apply(projectId: string, planned: PlannedBaseline): Promise<boolean> {
    const { entry, storagePath } = planned;
    await writePlannedImage(this.storage, planned);
    const fields = {
      snapshotId: null,
      screenshotPath: storagePath,
      infraHash: entry.infraHash,
      mode: entry.mode,
      updatedAt: entry.updatedAt,
    } satisfies Partial<Baseline>;
    const existing = await this.baselines.getFor(
      projectId,
      entry.storyId,
      entry.viewport,
      entry.branch,
      entry.browser,
    );
    if (existing) {
      await this.db.update(this.tables.baselines, existing.id, fields);
      return false;
    }
    await this.db.insert(this.tables.baselines, {
      ...fields,
      id: ulid(),
      projectId,
      storyId: entry.storyId,
      viewportName: entry.viewport,
      branch: entry.branch,
      browser: entry.browser,
      createdAt: entry.createdAt,
    });
    return true;
  }
}
