/**
 * One-off backfill of build uses of shared content (ADR 0039). Deployments that predate
 * `content_uses` kept per-hash counters, which cannot become per-build uses, so their shared blobs
 * had no use rows and were never collected. The backfill reads each live build's manifest and
 * records its hashes through the lifecycle capability, which is idempotent, so a re-run adds
 * nothing. It deletes nothing, skips any value that is not a content hash, and keeps its progress
 * (a build id cursor, then a done flag) in `site_settings`, so a restart resumes where it stopped.
 */
import { asc, gte } from "drizzle-orm";
import type { BuildReferenceLifecycle, DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Logger } from "../logger.ts";
import { col } from "../models/columns.ts";
import { SiteSettingsModel } from "../models/site-settings.ts";
import { mapLimit } from "../utils/map-limit.ts";
import { isContentHash } from "../utils/paths.ts";
import { readManifestHashes } from "./build-deletion.ts";

/** The `site_settings` key holding the backfill's progress. */
export const CONTENT_BACKFILL_KEY = "retention.content-uses-backfill";

/** Builds read and recorded per page; the cursor is saved after each page. */
export const CONTENT_BACKFILL_PAGE = 200;

/** Manifests read at once within a page. */
const READ_CONCURRENCY = 8;

/** What the backfill needs; `signal` stops it between pages (shutdown). */
export interface ContentBackfillDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  lifecycle: BuildReferenceLifecycle;
  logger?: Logger;
  signal?: AbortSignal;
}

/** Counts only: what one run did. `done` is true once every build has been visited. */
export interface ContentBackfillResult {
  done: boolean;
  builds: number;
  uses: number;
  skippedHashes: number;
  unreadable: number;
  refused: number;
}

interface BuildRow {
  id: string;
  projectId: string;
  retentionState?: string;
}

/** Progress as stored: a finished marker, or the last build id handled. */
type Progress = { done: true } | { done?: false; after?: string };

/** Backfill the uses of every live build that has not been visited; resolves with counts only. */
export async function backfillContentUses(
  deps: ContentBackfillDeps,
): Promise<ContentBackfillResult> {
  const settings = new SiteSettingsModel(deps.db);
  const result = emptyResult();
  const progress = parseProgress(await settings.get(CONTENT_BACKFILL_KEY));
  if (progress.done) return { ...result, done: true };
  result.done = await visitPages(deps, settings, progress.after, result);
  deps.logger?.info({ ...result }, "content uses backfill ran");
  return result;
}

function emptyResult(): ContentBackfillResult {
  return { done: false, builds: 0, uses: 0, skippedHashes: 0, unreadable: 0, refused: 0 };
}

/**
 * Page through the builds after `cursor`, saving progress after each; true once all were visited.
 * A page with a hash a collector has claimed is not saved as visited: the run stops there and the
 * next boot repeats that page (recording is idempotent), once the claim has ended.
 */
async function visitPages(
  deps: ContentBackfillDeps,
  settings: SiteSettingsModel,
  start: string | undefined,
  result: ContentBackfillResult,
): Promise<boolean> {
  let cursor = start;
  while (!deps.signal?.aborted) {
    // oxlint-disable-next-line no-await-in-loop -- a page is recorded and saved before the next
    const page = await visitPage(deps, settings, cursor, result);
    if (page.blocked) return false;
    if (page.cursor === null) return true;
    cursor = page.cursor;
  }
  return false;
}

/** What one page left: the cursor after it (null when no builds remain), or that it must be repeated. */
interface PageOutcome {
  cursor: string | null;
  blocked: boolean;
}

/** One page: record it and save the cursor, or mark the backfill done when nothing is left. */
async function visitPage(
  deps: ContentBackfillDeps,
  settings: SiteSettingsModel,
  cursor: string | undefined,
  result: ContentBackfillResult,
): Promise<PageOutcome> {
  const page = await listPage(deps.db, cursor);
  const last = page.at(-1);
  if (last === undefined) {
    await settings.set(CONTENT_BACKFILL_KEY, JSON.stringify({ done: true }));
    return { cursor: null, blocked: false };
  }
  const refusedBefore = result.refused;
  await backfillPage(deps, page, result);
  if (result.refused > refusedBefore) return { cursor: last.id, blocked: true };
  await settings.set(CONTENT_BACKFILL_KEY, JSON.stringify({ after: last.id }));
  return { cursor: last.id, blocked: false };
}

/** The stored progress; anything unreadable starts over, which is safe because recording is idempotent. */
function parseProgress(raw: string | null): Progress {
  if (raw === null) return {};
  try {
    const value = JSON.parse(raw) as { done?: unknown; after?: unknown };
    if (value.done === true) return { done: true };
    return typeof value.after === "string" ? { after: value.after } : {};
  } catch {
    return {};
  }
}

/** The next page of builds after the cursor, oldest id first. */
async function listPage(db: DatabaseAdapter, after: string | undefined): Promise<BuildRow[]> {
  const id = col(db.tables.builds, "id");
  const rows = await db.list(db.tables.builds, {
    ...(after === undefined ? {} : { where: gte(id, after) }),
    orderBy: asc(id),
    limit: CONTENT_BACKFILL_PAGE,
  });
  // The query is inclusive of the cursor (every driver supports it); the cursor row was handled by
  // the previous page, so it is dropped here, which also keeps a page that does not advance from
  // looping forever on an adapter that ignores the condition.
  return (rows as unknown as BuildRow[]).filter((row) => after === undefined || row.id > after);
}

/** Record the uses of the page's live builds, a few manifests at a time. */
async function backfillPage(
  deps: ContentBackfillDeps,
  page: readonly BuildRow[],
  result: ContentBackfillResult,
): Promise<void> {
  const live = page.filter((build) => build.retentionState !== "deleting");
  await mapLimit(live, READ_CONCURRENCY, async (build) => {
    await backfillBuild(deps, build, result);
  });
}

/** One build: read its manifest, drop what is not a content hash, record the rest. */
async function backfillBuild(
  deps: ContentBackfillDeps,
  build: BuildRow,
  result: ContentBackfillResult,
): Promise<void> {
  const hashes = await readManifestHashes(deps, build.projectId, build.id);
  result.builds += 1;
  if (hashes === null) {
    result.unreadable += 1;
    return;
  }
  const valid = hashes.filter((hash) => isContentHash(hash));
  result.skippedHashes += hashes.length - valid.length;
  await recordValid(deps, build, valid, result);
}

/**
 * Record the build's hashes. The capability refuses a whole call when a collector has claimed any
 * hash in it, so the others are recorded in a second call and the refused ones are counted: the
 * page is then repeated on the next run instead of being saved as visited.
 */
async function recordValid(
  deps: ContentBackfillDeps,
  build: BuildRow,
  valid: readonly string[],
  result: ContentBackfillResult,
): Promise<void> {
  if (valid.length === 0) return;
  const record = async (hashes: readonly string[]): Promise<string[]> =>
    await deps.lifecycle.recordContentUses(build.projectId, build.id, hashes);
  const refused = await record(valid);
  result.refused += refused.length;
  const rest = valid.filter((hash) => !refused.includes(hash));
  const again = refused.length > 0 && rest.length > 0 ? await record(rest) : [];
  result.refused += again.length;
  result.uses += refused.length === 0 ? valid.length : rest.length - again.length;
}
