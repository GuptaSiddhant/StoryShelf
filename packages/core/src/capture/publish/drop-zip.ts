/**
 * Delete a build's `storybook.zip` once its statics are in the content store (issue #850). After
 * that, capture, shards and retries build their scratch directory from `manifest.json` and
 * `content/<hash>` (`prepareStorybook`), so the upload is a second copy of every byte.
 *
 * The zip stays until the manifest is committed (it is written last, after the content uses are
 * recorded), so a failed or partial publish can still be retried from it.
 */
import type { DatabaseAdapter } from "../../adapters/database.ts";
import type { StorageAdapter } from "../../adapters/storage.ts";
import type { Logger } from "../../logger.ts";
import { mapLimit } from "../../utils/map-limit.ts";
import { contentKey, isContentHash, storybookDir, storybookZipPath } from "../../utils/paths.ts";
import { parseManifest } from "../catalog/manifest-cache.ts";
import { ContentCollectingError, recordContentUses } from "../content-uses.ts";

/** What {@link dropUploadZip} works with. */
export interface DropZipDeps {
  storage: StorageAdapter;
  /** With the lifecycle capability, the build's content uses are (re)recorded before the delete. */
  db?: DatabaseAdapter | undefined;
  logger?: Logger | undefined;
}

/** How a call ended: `dropped` only when a zip was there and is now deleted. */
export type DropZipResult = "dropped" | "no-zip" | "no-manifest" | "kept";

/**
 * Delete the build's zip when it has a committed, readable manifest whose content uses are recorded
 * and whose blobs are all stored. Idempotent: a repeat finds no zip. Never throws for a build that
 * is not ready; a storage failure propagates so the caller can retry later.
 */
export async function dropUploadZip(
  deps: DropZipDeps,
  target: { projectId: string; buildId: string },
): Promise<DropZipResult> {
  const zip = storybookZipPath(target.projectId, target.buildId);
  if (!(await deps.storage.exists(zip))) return "no-zip";
  const ready = await checkReady(deps, target);
  if (ready !== "ready") return ready;
  await deps.storage.delete(zip);
  return "dropped";
}

/** Whether the statics are stored once: a readable manifest, every blob present, the uses recorded. */
async function checkReady(
  deps: DropZipDeps,
  target: { projectId: string; buildId: string },
): Promise<"ready" | "no-manifest" | "kept"> {
  const hashes = await manifestHashes(deps.storage, target);
  if (hashes === null) return "no-manifest";
  if (!(await blobsStored(deps.storage, hashes))) {
    deps.logger?.warn({ buildId: target.buildId }, "upload zip kept: a content blob is missing");
    return "kept";
  }
  return await recordUses(deps, target, hashes);
}

/** Record the build's uses so a collector cannot free a blob it now relies on; kept when one holds it. */
async function recordUses(
  deps: DropZipDeps,
  target: { projectId: string; buildId: string },
  hashes: readonly string[],
): Promise<"ready" | "kept"> {
  try {
    await recordContentUses(deps.db, deps.storage, target, hashes);
    return "ready";
  } catch (error) {
    if (!(error instanceof ContentCollectingError)) throw error;
    deps.logger?.warn(
      { buildId: target.buildId },
      "upload zip kept: content is not safe to rely on",
    );
    return "kept";
  }
}

/** Whether every distinct hash has its blob: the zip is then the only copy of a lost one. */
async function blobsStored(storage: StorageAdapter, hashes: readonly string[]): Promise<boolean> {
  const found = await mapLimit([...new Set(hashes)], 8, async (hash) => {
    return isContentHash(hash) && (await storage.exists(contentKey(hash)));
  });
  return found.every(Boolean);
}

/** The manifest's hashes, or null when the build has no readable manifest. */
async function manifestHashes(
  storage: StorageAdapter,
  target: { projectId: string; buildId: string },
): Promise<string[] | null> {
  const key = `${storybookDir(target.projectId, target.buildId)}/manifest.json`;
  if (!(await storage.exists(key))) return null;
  try {
    const manifest = parseManifest(await storage.read(key));
    return manifest === null ? null : [...manifest.values()];
  } catch {
    return null;
  }
}
