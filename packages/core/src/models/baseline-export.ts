/** Stream a project's baselines as a portable zip archive (format v1). */
import { createHash } from "node:crypto";
import { DEFAULT_BROWSER } from "../adapters/capture-runner.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Baseline } from "../schema/baseline.ts";
import { zipStream, type ZipSource } from "../utils/zip-write.ts";
import {
  archiveFileName,
  BASELINE_ARCHIVE_FORMAT,
  BASELINE_ARCHIVE_LIMITS,
  BASELINE_ARCHIVE_VERSION,
  BASELINE_MANIFEST_NAME,
  BaselineArchiveError,
  type BaselineManifest,
  type BaselineManifestEntry,
  type BaselineSkipped,
} from "./baseline-archive.ts";

/** Options for {@link exportBaselineArchive}. */
export interface BaselineExportOptions {
  /** Export only this branch; omit (or null) for every branch. */
  branch?: string | null;
  /** Source project slug recorded in the manifest. */
  project?: string | null;
  /** Clock override for `exportedAt` (tests). */
  now?: () => Date;
}

/**
 * Prepare a baseline archive for `rows`. Validation (the entry limit) runs
 * eagerly so callers can fail the request before streaming; images are then
 * read one at a time while the returned iterable is consumed, and the
 * manifest is written last so it can carry each image's SHA-256. Baselines
 * whose image cannot be read are listed under `skipped` instead of failing.
 *
 * @throws {BaselineArchiveError} When there are more baselines than an archive may hold.
 */
export function exportBaselineArchive(
  storage: StorageAdapter,
  rows: Baseline[],
  options: BaselineExportOptions = {},
): AsyncIterable<Buffer> {
  const branch = options.branch ?? null;
  const selected = rows
    .filter((row) => branch === null || row.branch === branch)
    .toSorted((a, b) => compareKeys(sortKey(a), sortKey(b)));
  if (selected.length > BASELINE_ARCHIVE_LIMITS.maxBaselines) {
    throw new BaselineArchiveError(
      `Too many baselines to export (${selected.length} > ${BASELINE_ARCHIVE_LIMITS.maxBaselines}); filter by branch`,
    );
  }
  const manifest: BaselineManifest = {
    format: BASELINE_ARCHIVE_FORMAT,
    version: BASELINE_ARCHIVE_VERSION,
    exportedAt: (options.now?.() ?? new Date()).toISOString(),
    project: options.project ?? null,
    branch,
    baselines: [],
    skipped: [],
  };
  return zipStream(archiveSources(storage, selected, manifest));
}

function sortKey(row: Baseline): string[] {
  return [row.branch, row.storyId, row.viewportName, row.browser ?? DEFAULT_BROWSER];
}

function compareKeys(a: string[], b: string[]): number {
  const index = a.findIndex((part, at) => part !== b[at]);
  if (index === -1) {
    return 0;
  }
  // Code-unit order, not locale order, so archives are reproducible across hosts.
  return (a[index] ?? "") < (b[index] ?? "") ? -1 : 1;
}

async function* archiveSources(
  storage: StorageAdapter,
  rows: Baseline[],
  manifest: BaselineManifest,
): AsyncGenerator<ZipSource> {
  for (const row of rows) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one image in memory at a time
    const data = await readImage(storage, row);
    if (data) {
      const entry = manifestEntry(row, data);
      manifest.baselines.push(entry);
      yield { name: entry.file, data: async (): Promise<Buffer> => await Promise.resolve(data) };
    } else {
      manifest.skipped?.push(identityOf(row));
    }
  }
  const json = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  yield {
    name: BASELINE_MANIFEST_NAME,
    data: async (): Promise<Buffer> => await Promise.resolve(json),
  };
}

async function readImage(storage: StorageAdapter, row: Baseline): Promise<Buffer | null> {
  try {
    const data = await storage.read(row.screenshotPath);
    return data.length <= BASELINE_ARCHIVE_LIMITS.maxImageBytes ? data : null;
  } catch {
    return null;
  }
}

function identityOf(row: Baseline): BaselineSkipped {
  return {
    storyId: row.storyId,
    viewport: row.viewportName,
    browser: row.browser ?? DEFAULT_BROWSER,
    branch: row.branch,
  };
}

function manifestEntry(row: Baseline, data: Buffer): BaselineManifestEntry {
  const identity = identityOf(row);
  return {
    ...identity,
    mode: row.mode ?? null,
    infraHash: row.infraHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    file: archiveFileName(identity.branch, identity.storyId, identity.viewport, identity.browser),
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}
