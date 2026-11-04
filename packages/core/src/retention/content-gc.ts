/**
 * Collect shared content nothing uses any more (ADR 0039). A blob goes only when every build use of
 * it was released and the grace period passed, a collector claimed it in the lifecycle capability's
 * concurrency domain (so a new use racing the delete ends in exactly one outcome), and no live
 * build's manifest names it. A wrong use record can leak storage but never delete a file a live
 * build serves.
 */
import type { BuildReferenceLifecycle, DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Logger } from "../logger.ts";
import { publishedGzipPath } from "../utils/paths.ts";
import { manifestHashes } from "./build-deletion.ts";

/** How long a blob must stand without a use before it is collected. */
export const CONTENT_GRACE_MS = 7 * 86_400_000;

/** What the collector needs. */
export interface ContentGcDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  lifecycle: BuildReferenceLifecycle;
  logger?: Logger;
  now?: () => number;
}

/** Collect unused content; resolves to how many blobs were removed. */
export async function collectUnreferencedContent(deps: ContentGcDeps): Promise<number> {
  const cutoff = new Date((deps.now?.() ?? Date.now()) - CONTENT_GRACE_MS).toISOString();
  const claimed = await deps.lifecycle.claimContent(cutoff);
  if (claimed.length === 0) return 0;
  const free = new Set(claimed);
  await dropLiveHashes(deps, free);
  let removed = 0;
  for (const hash of claimed) {
    // oxlint-disable-next-line no-await-in-loop -- one blob at a time keeps a failure to that blob
    if (free.has(hash) ? await removeBlob(deps, hash) : await giveBack(deps, hash)) removed += 1;
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

/** A live build serves the blob: give the claim back and count nothing removed. */
async function giveBack(deps: ContentGcDeps, hash: string): Promise<false> {
  try {
    await deps.lifecycle.abandonContentClaim(hash);
  } catch (error) {
    deps.logger?.warn({ err: error, hash }, "content claim could not be given back");
  }
  return false;
}

/** Delete the blob, then end the claim; false when it failed, which leaves the claim to resume. */
async function removeBlob(deps: ContentGcDeps, hash: string): Promise<boolean> {
  try {
    // The blob itself must go before the claim ends: if this throws, the claim stays and the next
    // pass resumes it.
    await deps.storage.delete(`content/${hash}`);
    // Variants are disposable; never let their deletion affect authoritative data.
    if (/^[a-f0-9]{64}$/u.test(hash))
      await deps.storage.delete(publishedGzipPath(hash)).catch(() => {});
    await deps.lifecycle.finishContentCollection(hash);
    return true;
  } catch (error) {
    deps.logger?.warn({ err: error, hash }, "content collection failed");
    return false;
  }
}
