/**
 * Reclaim the per-build Storybook copies kept before published files were stored once (#849).
 * A build published between #301 and #849 holds `storybook/<rel>` for every file next to its
 * `manifest.json`, while the same bytes are in `content/<hash>`. For a build with a readable
 * manifest, each copy whose manifest entry's blob exists is deleted. The manifest stays, a copy
 * whose blob is missing stays, and a build without a manifest is a legacy build served from those
 * files and is never touched (ADR 0039).
 *
 * The work is one page of builds per call, with a cursor (then a done flag) in `site_settings`, so
 * a restart or another instance resumes it and a repeat deletes nothing more. It is run by the
 * `statics-reclaim` job (ADR 0040), never at boot (ADR 0053). Logs carry build ids and counts,
 * never paths.
 */
import { asc, gte } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Logger } from "../logger.ts";
import { col } from "../models/columns.ts";
import { SiteSettingsModel } from "../models/site-settings.ts";
import { mapLimit } from "../utils/map-limit.ts";
import { contentKey, isContentHash, storybookDir } from "../utils/paths.ts";
import { CLAIM_LEASE_MS } from "./content-gc.ts";

/** The `site_settings` key holding the sweep's progress. */
export const RECLAIM_COPIES_KEY = "retention.statics-reclaim";

/** Builds visited per call; the cursor is saved after the page. */
export const RECLAIM_COPIES_PAGE = 50;

const IO_CONCURRENCY = 8;

/** What the sweep needs; `signal` stops it between builds. */
export interface ReclaimCopiesDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  logger?: Logger;
  signal?: AbortSignal;
}

/** Counts only: what one call did. `done` is true once every build has been visited. */
export interface ReclaimCopiesResult {
  done: boolean;
  builds: number;
  /** Per-build copies deleted. */
  reclaimed: number;
  /** Copies kept because their blob is missing or their manifest entry is unusable. */
  kept: number;
  /** Builds skipped whole: unreadable manifest, or a collector holds one of their blobs. */
  skipped: number;
}

interface BuildRow {
  id: string;
  projectId: string;
  retentionState?: string;
}

type Progress = { done: true } | { done?: false; after?: string };

/** Visit the next page of builds; resolves with counts only. */
export async function reclaimBuildCopies(deps: ReclaimCopiesDeps): Promise<ReclaimCopiesResult> {
  const settings = new SiteSettingsModel(deps.db);
  const result: ReclaimCopiesResult = { done: false, builds: 0, reclaimed: 0, kept: 0, skipped: 0 };
  const progress = parseProgress(await settings.get(RECLAIM_COPIES_KEY));
  if (progress.done) return { ...result, done: true };
  const page = await listPage(deps.db, progress.after);
  const visited = await visitPage(deps, settings, page, result);
  result.done = visited && page.length < RECLAIM_COPIES_PAGE;
  if (result.done) await settings.set(RECLAIM_COPIES_KEY, JSON.stringify({ done: true }));
  deps.logger?.info({ ...result }, "build copy reclaim ran");
  return result;
}

/** Visit the page's builds in order, saving the cursor after each; false when aborted part-way. */
async function visitPage(
  deps: ReclaimCopiesDeps,
  settings: SiteSettingsModel,
  page: readonly BuildRow[],
  result: ReclaimCopiesResult,
): Promise<boolean> {
  for (const build of page) {
    if (deps.signal?.aborted) return false;
    // oxlint-disable-next-line no-await-in-loop -- one build at a time keeps the storage load bounded
    await reclaimBuild(deps, build, result);
    result.builds += 1;
    // oxlint-disable-next-line no-await-in-loop -- progress is saved per build, so an abort loses none
    await settings.set(RECLAIM_COPIES_KEY, JSON.stringify({ after: build.id }));
  }
  return true;
}

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

async function listPage(db: DatabaseAdapter, after: string | undefined): Promise<BuildRow[]> {
  const id = col(db.tables.builds, "id");
  const rows = await db.list(db.tables.builds, {
    ...(after === undefined ? {} : { where: gte(id, after) }),
    orderBy: asc(id),
    limit: RECLAIM_COPIES_PAGE + 1,
  });
  return (rows as unknown as BuildRow[])
    .filter((row) => after === undefined || row.id > after)
    .slice(0, RECLAIM_COPIES_PAGE);
}

/** One build: delete each copy whose manifest entry's blob exists. */
async function reclaimBuild(
  deps: ReclaimCopiesDeps,
  build: BuildRow,
  result: ReclaimCopiesResult,
): Promise<void> {
  if (build.retentionState === "deleting") return;
  const prefix = `${storybookDir(build.projectId, build.id)}/`;
  const manifest = await readManifest(deps.storage, prefix);
  if (manifest === undefined) return;
  if (manifest === null) {
    result.skipped += 1;
    return;
  }
  await reclaimCopies(deps, build, { prefix, manifest }, result);
}

/** Delete the build's copies that its manifest names and whose blob is stored. */
async function reclaimCopies(
  deps: ReclaimCopiesDeps,
  build: BuildRow,
  source: { prefix: string; manifest: Record<string, string> },
  result: ReclaimCopiesResult,
): Promise<void> {
  const { prefix, manifest } = source;
  const copies = await storedCopies(deps.storage, prefix, manifest);
  if (copies.length === 0) return;
  if (!(await recorded(deps, build, copies))) {
    result.skipped += 1;
    return;
  }
  const blobs = await blobsPresent(deps.storage, copies);
  const deletable = copies.filter(([, hash]) => blobs.has(hash));
  await mapLimit(deletable, IO_CONCURRENCY, async ([rel]) => {
    await deps.storage.delete(`${prefix}${rel}`);
  });
  tally(deps, build, result, { deleted: deletable.length, kept: copies.length - deletable.length });
}

/** The manifest's entries that still have a per-build copy; never `manifest.json` itself. */
async function storedCopies(
  storage: StorageAdapter,
  prefix: string,
  manifest: Record<string, string>,
): Promise<[string, string][]> {
  const present = new Set((await storage.list(prefix)).map((key) => key.slice(prefix.length)));
  return Object.entries(manifest).filter(([rel]) => rel !== "manifest.json" && present.has(rel));
}

/** Add one build's counts to the result; the log names the build and the count, never a path. */
function tally(
  deps: ReclaimCopiesDeps,
  build: BuildRow,
  result: ReclaimCopiesResult,
  counts: { deleted: number; kept: number },
): void {
  result.reclaimed += counts.deleted;
  result.kept += counts.kept;
  if (counts.kept > 0) deps.logger?.info({ buildId: build.id, kept: counts.kept }, "copies kept");
}

/** The manifest's usable entries; undefined with no manifest (legacy build), null when unreadable. */
async function readManifest(
  storage: StorageAdapter,
  prefix: string,
): Promise<Record<string, string> | null | undefined> {
  const path = `${prefix}manifest.json`;
  if (!(await storage.exists(path))) return undefined;
  try {
    const parsed: unknown = JSON.parse((await storage.read(path)).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && safeRel(entry[0]),
    );
    return Object.fromEntries(entries);
  } catch {
    return null;
  }
}

/** A relative path that stays inside the build's `storybook/` directory. */
function safeRel(rel: string): boolean {
  return (
    rel.length > 0 &&
    !rel.startsWith("/") &&
    !rel.includes("\\") &&
    !rel.split("/").some((part) => part === ".." || part === "." || part === "")
  );
}

/**
 * With the lifecycle capability, record the build's uses first, so a collector cannot free a blob
 * the build now serves from. False when a collector holds one. Without the capability nothing is
 * ever collected (ADR 0039), so deleting a copy is safe.
 */
async function recorded(
  deps: ReclaimCopiesDeps,
  build: BuildRow,
  copies: readonly (readonly [string, string])[],
): Promise<boolean> {
  const lifecycle = deps.db.buildReferenceLifecycle;
  if (lifecycle === undefined) return true;
  const hashes = [...new Set(copies.map(([, hash]) => hash))].filter((hash) => isContentHash(hash));
  const staleBefore = new Date(Date.now() - CLAIM_LEASE_MS).toISOString();
  const refused = await lifecycle.recordContentUses(build.projectId, build.id, hashes, staleBefore);
  return refused.length === 0;
}

/** The hashes whose blob is in storage right now. */
async function blobsPresent(
  storage: StorageAdapter,
  copies: readonly (readonly [string, string])[],
): Promise<Set<string>> {
  const hashes = [...new Set(copies.map(([, hash]) => hash))].filter((hash) => isContentHash(hash));
  const found = await mapLimit(hashes, IO_CONCURRENCY, async (hash) => ({
    hash,
    ok: await storage.exists(contentKey(hash)),
  }));
  return new Set(found.filter((entry) => entry.ok).map((entry) => entry.hash));
}
