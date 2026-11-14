/**
 * Second pass of the build-copy reclaim (#850): delete `storybook.zip` of builds that already hold a
 * committed manifest and content, as `PublishCompleter.complete` now does for new ones. A build
 * without a manifest keeps its zip (a retry of its publish extracts from it), and so does one still
 * `pending` (its publish may be running). A build is only touched when its content uses are recorded
 * and its blobs are stored (`dropUploadZip`).
 *
 * One page of builds per call with a cursor, then a done flag, in `site_settings` under its own key,
 * so a deployment that finished the first pass still runs this one. Idempotent, never at boot, no
 * job kind (ADR 0053). Logs carry counts and build ids, never paths.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { dropUploadZip } from "../capture/publish/drop-zip.ts";
import type { Logger } from "../logger.ts";
import { SiteSettingsModel } from "../models/site-settings.ts";
import {
  RECLAIM_COPIES_PAGE,
  listPage,
  parseProgress,
  type BuildRow,
} from "./reclaim-build-copies.ts";

/** The `site_settings` key holding this pass's progress. */
export const RECLAIM_ZIPS_KEY = "retention.zip-reclaim";

/** What the pass needs; `signal` stops it between builds. */
export interface ReclaimZipsDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  logger?: Logger;
  signal?: AbortSignal;
}

/** Counts only. `done` is true once every build has been visited. */
export interface ReclaimZipsResult {
  done: boolean;
  builds: number;
  /** Zips deleted. */
  dropped: number;
  /** Zips kept: no manifest yet, content not safe to rely on, or a failed storage call. */
  kept: number;
}

/** Visit the next page of builds; resolves with counts only. */
export async function reclaimUploadZips(deps: ReclaimZipsDeps): Promise<ReclaimZipsResult> {
  const settings = new SiteSettingsModel(deps.db);
  const result: ReclaimZipsResult = { done: false, builds: 0, dropped: 0, kept: 0 };
  const progress = parseProgress(await settings.get(RECLAIM_ZIPS_KEY));
  if (progress.done) return { ...result, done: true };
  const page = await listPage(deps.db, progress.after);
  const completed = await visitPage(deps, settings, page, result);
  result.done = completed && page.length < RECLAIM_COPIES_PAGE;
  if (result.done) await settings.set(RECLAIM_ZIPS_KEY, JSON.stringify({ done: true }));
  deps.logger?.info({ ...result }, "upload zip reclaim ran");
  return result;
}

/** Visit the page's builds in order, saving the cursor after each; false when aborted part-way. */
async function visitPage(
  deps: ReclaimZipsDeps,
  settings: SiteSettingsModel,
  page: readonly BuildRow[],
  result: ReclaimZipsResult,
): Promise<boolean> {
  for (const build of page) {
    if (deps.signal?.aborted) return false;
    // oxlint-disable-next-line no-await-in-loop -- one build at a time keeps the storage load bounded
    await visit(deps, build, result);
    result.builds += 1;
    // oxlint-disable-next-line no-await-in-loop -- progress is saved per build, so an abort loses none
    await settings.set(RECLAIM_ZIPS_KEY, JSON.stringify({ after: build.id }));
  }
  return true;
}

async function visit(
  deps: ReclaimZipsDeps,
  build: BuildRow,
  result: ReclaimZipsResult,
): Promise<void> {
  if (build.retentionState === "deleting" || build.status === "pending") return;
  try {
    const outcome = await dropUploadZip(
      { storage: deps.storage, db: deps.db, logger: deps.logger },
      { projectId: build.projectId, buildId: build.id },
    );
    if (outcome === "dropped") result.dropped += 1;
    else if (outcome !== "no-zip") result.kept += 1;
  } catch (error) {
    // One build's storage failure must not stall the pass: the zip is only kept longer.
    result.kept += 1;
    deps.logger?.warn({ err: error, buildId: build.id }, "upload zip not deleted");
  }
}
