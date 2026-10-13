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
  /** Called for each baseline left out of the archive because its image is missing or too large. */
  onSkipped?: (baseline: BaselineSkipped) => void;
  /** Clock override for `exportedAt` (tests). */
  now?: () => Date;
}

/**
 * Prepare a baseline archive for `rows`. Validation (the entry limit) runs
 * eagerly so callers can fail the request before streaming; images are then
 * read one at a time while the returned iterable is consumed, and the
 * manifest is written last so it can carry each image's SHA-256. Baselines
 * whose image is missing (or over the per-image limit) are listed under
 * `skipped` and reported through `onSkipped`. Storage errors on an image that
 * exists abort the stream, as does outgrowing the archive size limit, so a
 * truncated stream is never mistaken for a complete backup.
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
  return zipStream(archiveSources(storage, selected, manifest, options.onSkipped));
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
  onSkipped?: (baseline: BaselineSkipped) => void,
): AsyncGenerator<ZipSource> {
  const state = { names: new Set<string>(), budget: new ArchiveBudget() };
  for (const row of rows) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one image in memory at a time
    const source = await rowSource(storage, row, manifest, state, onSkipped);
    if (source) {
      yield source;
    }
  }
  const json = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  yield { name: BASELINE_MANIFEST_NAME, data: json };
}

/** The zip entry for one baseline, or null (after recording it as skipped) when its image is unavailable. */
async function rowSource(
  storage: StorageAdapter,
  row: Baseline,
  manifest: BaselineManifest,
  state: { names: Set<string>; budget: ArchiveBudget },
  onSkipped?: (baseline: BaselineSkipped) => void,
): Promise<ZipSource | null> {
  const data = await readImage(storage, row);
  if (!data) {
    const identity = identityOf(row);
    manifest.skipped?.push(identity);
    onSkipped?.(identity);
    return null;
  }
  const entry = manifestEntry(row, data, state.names);
  state.budget.add(entry.file, data.length);
  manifest.baselines.push(entry);
  return { name: entry.file, data };
}

/** Tracks the streamed size so an export never outgrows what an import accepts. */
class ArchiveBudget {
  /** Zip local + central header bytes per entry, excluding the (twice-stored) name. */
  private static readonly ENTRY_OVERHEAD = 76;
  private used = BASELINE_ARCHIVE_LIMITS.maxManifestBytes;

  add(name: string, bytes: number): void {
    this.used += ArchiveBudget.ENTRY_OVERHEAD + Buffer.byteLength(name) * 2 + bytes;
    if (this.used > BASELINE_ARCHIVE_LIMITS.maxArchiveBytes) {
      throw new BaselineArchiveError(
        `Export exceeds ${BASELINE_ARCHIVE_LIMITS.maxArchiveBytes} bytes (the import limit); export one branch at a time`,
      );
    }
  }
}

/** Read a baseline image; null when it is missing or too large, throws on other storage errors. */
async function readImage(storage: StorageAdapter, row: Baseline): Promise<Buffer | null> {
  try {
    const data = await storage.read(row.screenshotPath);
    return data.length <= BASELINE_ARCHIVE_LIMITS.maxImageBytes ? data : null;
  } catch (error) {
    if (await storage.exists(row.screenshotPath).catch(() => false)) {
      throw error;
    }
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

function manifestEntry(row: Baseline, data: Buffer, names: Set<string>): BaselineManifestEntry {
  const identity = identityOf(row);
  return {
    ...identity,
    mode: row.mode ?? null,
    infraHash: row.infraHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    file: uniqueName(
      archiveFileName(identity.branch, identity.storyId, identity.viewport, identity.browser),
      names,
    ),
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

/**
 * `modeSegment` can map two identities to one name (`a~firefox` on chromium vs
 * `a` on firefox). Names are only lookup keys, so disambiguate with a suffix.
 */
function uniqueName(name: string, names: Set<string>): string {
  let candidate = name;
  for (let n = 2; names.has(candidate); n += 1) {
    candidate = name.replace(/\.png$/u, `.${n}.png`);
  }
  names.add(candidate);
  return candidate;
}
