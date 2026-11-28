/**
 * The snapshot-image half of the storage check: for every `available` build, the images its
 * snapshots reference (current screenshot, baseline copy, diff) must exist in storage. Read-only and
 * bounded: builds and snapshots are read one page at a time, never all at once.
 */
import { desc, eq } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { col } from "../models/columns.ts";

/** Rows read per page, for builds and for one build's snapshots. */
export const IMAGE_CHECK_PAGE = 200;

/** What the image check needs. */
export interface SnapshotImageDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
}

/** Counts of the image check; a result never names a storage path. */
export interface SnapshotImageResult {
  snapshotsChecked: number;
  /** Distinct referenced images (current, baseline copy, diff) storage lacks, per snapshot. */
  missingSnapshotImages: number;
  /** Ids of the builds that have at least one missing snapshot image. */
  buildsMissingImages: string[];
}

interface SnapshotImages {
  screenshotPath?: string | null;
  comparisonImagePath?: string | null;
  diffPath?: string | null;
}

const IMAGE_COLUMNS = ["screenshotPath", "comparisonImagePath", "diffPath"] as const;

/** Check the snapshot images of `available` builds, newest first, at most `sample` builds when given. */
export async function checkSnapshotImages(
  deps: SnapshotImageDeps,
  sample?: number,
): Promise<SnapshotImageResult> {
  const result: SnapshotImageResult = {
    snapshotsChecked: 0,
    missingSnapshotImages: 0,
    buildsMissingImages: [],
  };
  const limit = sample ?? Infinity;
  for (let seen = 0; seen < limit;) {
    // oxlint-disable-next-line no-await-in-loop -- one page of builds at a time keeps memory flat
    const page = await buildPage(deps, seen, Math.min(IMAGE_CHECK_PAGE, limit - seen));
    // oxlint-disable-next-line no-await-in-loop -- one page at a time
    await checkPage(deps, page, result);
    seen += page.length;
    if (page.length < IMAGE_CHECK_PAGE) break;
  }
  return result;
}

type BuildPageRow = { id: string; retentionState?: string };

async function buildPage(
  deps: SnapshotImageDeps,
  offset: number,
  limit: number,
): Promise<BuildPageRow[]> {
  const builds = deps.db.tables.builds;
  return (await deps.db.list(builds, {
    orderBy: desc(col(builds, "id")),
    limit,
    offset,
  })) as unknown as BuildPageRow[];
}

async function checkPage(
  deps: SnapshotImageDeps,
  page: BuildPageRow[],
  result: SnapshotImageResult,
): Promise<void> {
  for (const build of page) {
    if ((build.retentionState ?? "available") !== "available") continue;
    // oxlint-disable-next-line no-await-in-loop -- one build at a time keeps storage load flat
    await checkBuildImages(deps, build.id, result);
  }
}

async function checkBuildImages(
  deps: SnapshotImageDeps,
  buildId: string,
  result: SnapshotImageResult,
): Promise<void> {
  const snapshots = deps.db.tables.snapshots;
  let missing = 0;
  for (let offset = 0; ; offset += IMAGE_CHECK_PAGE) {
    // oxlint-disable-next-line no-await-in-loop -- one page of snapshots at a time
    const page = (await deps.db.list(snapshots, {
      where: eq(col(snapshots, "buildId"), buildId),
      limit: IMAGE_CHECK_PAGE,
      offset,
      columns: IMAGE_COLUMNS,
    })) as unknown as SnapshotImages[];
    // oxlint-disable-next-line no-await-in-loop -- bounded by the page
    missing += await countMissing(deps.storage, page);
    result.snapshotsChecked += page.length;
    if (page.length < IMAGE_CHECK_PAGE) break;
  }
  result.missingSnapshotImages += missing;
  if (missing > 0) result.buildsMissingImages.push(buildId);
}

async function countMissing(storage: StorageAdapter, rows: SnapshotImages[]): Promise<number> {
  const paths = rows.flatMap((row) =>
    [row.screenshotPath, row.comparisonImagePath, row.diffPath].filter((path): path is string =>
      Boolean(path),
    ),
  );
  const present = await Promise.all(paths.map(async (path) => await imageExists(storage, path)));
  return present.filter((ok) => !ok).length;
}

/** An unreadable existence answer counts as missing: nothing could serve the image. */
async function imageExists(storage: StorageAdapter, path: string): Promise<boolean> {
  try {
    return await storage.exists(path);
  } catch {
    return false;
  }
}
