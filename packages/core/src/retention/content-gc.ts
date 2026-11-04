/**
 * Collect shared content nothing uses any more (ADR 0003 decision 2). A blob goes only when its
 * count is 0, the grace period has passed, and no live build's manifest names it, so a wrong
 * count can leak storage but never delete a file a live build serves.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Logger } from "../logger.ts";
import { ContentRefModel } from "../models/content-ref.ts";
import { publishedGzipPath } from "../utils/paths.ts";
import { manifestHashes } from "./build-deletion.ts";

/** How long a count of 0 must stand before its content is collected. */
export const CONTENT_GRACE_MS = 7 * 86_400_000;

/** What the collector needs. */
export interface ContentGcDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  logger?: Logger;
  now?: () => number;
}

/** Collect unreferenced content; resolves to how many blobs were removed. */
export async function collectUnreferencedContent(deps: ContentGcDeps): Promise<number> {
  const cutoff = new Date((deps.now?.() ?? Date.now()) - CONTENT_GRACE_MS).toISOString();
  const refs = new ContentRefModel(deps.db);
  const candidates = new Set((await refs.listStale(cutoff)).map((ref) => ref.hash));
  if (candidates.size === 0) return 0;
  await dropLiveHashes(deps, candidates);
  let removed = 0;
  for (const hash of candidates) {
    // oxlint-disable-next-line no-await-in-loop -- one blob at a time keeps a failure to that blob
    if (await removeBlob(deps, refs, hash, cutoff)) removed += 1;
  }
  return removed;
}

/** Take out of `candidates` every hash a live build's manifest names; stops once none is left. */
async function dropLiveHashes(deps: ContentGcDeps, candidates: Set<string>): Promise<void> {
  const builds = (await deps.db.list(deps.db.tables.builds)) as unknown as {
    id: string;
    projectId: string;
    retentionState?: string;
  }[];
  for (const build of builds) {
    if (candidates.size === 0) return;
    if (build.retentionState === "deleting") continue;
    // oxlint-disable-next-line no-await-in-loop -- manifests are read one at a time
    for (const hash of await manifestHashes(deps, build.projectId, build.id)) {
      candidates.delete(hash);
    }
  }
}

/** Re-check the count, delete the blob, then its row; false when it is in use again. */
async function removeBlob(
  deps: ContentGcDeps,
  refs: ContentRefModel,
  hash: string,
  cutoff: string,
): Promise<boolean> {
  const current = await refs.get(hash);
  if (current === null || current.refCount > 0 || current.lastSeenAt >= cutoff) return false;
  try {
    // The blob itself must go before its row: if this throws, the row stays and the next pass retries.
    await deps.storage.delete(`content/${hash}`);
    // Variants are disposable; never let their deletion affect authoritative data.
    if (/^[a-f0-9]{64}$/u.test(hash))
      await deps.storage.delete(publishedGzipPath(hash)).catch(() => {});
    await refs.forget(hash);
    return true;
  } catch (error) {
    deps.logger?.warn({ err: error, hash }, "content collection failed");
    return false;
  }
}
