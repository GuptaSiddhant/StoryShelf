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
import { contentKey, isContentHash, publishedGzipPath } from "../utils/paths.ts";
import { ulid } from "../utils/ulid.ts";
import { manifestHashes } from "./build-deletion.ts";

/** How long a blob must stand without a use before it is collected. */
export const CONTENT_GRACE_MS = 7 * 86_400_000;

/** How long a claim belongs to its collector; an older one is a crashed pass's and is resumed. */
export const CLAIM_LEASE_MS = 30 * 60_000;

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
  const token = ulid();
  const claimed = await claimWellFormed(deps, token);
  if (claimed.length === 0) return 0;
  const free = new Set(claimed);
  await dropLiveHashes(deps, free);
  let removed = 0;
  for (const hash of claimed) {
    // oxlint-disable-next-line no-await-in-loop -- one blob at a time keeps a failure to that blob
    if (await settle(deps, hash, token, free.has(hash))) removed += 1;
  }
  return removed;
}

/** Delete the claimed blob, or give the claim back when a live build still serves it. */
async function settle(
  deps: ContentGcDeps,
  hash: string,
  token: string,
  unused: boolean,
): Promise<boolean> {
  return unused ? await removeBlob(deps, hash, token) : await giveBack(deps, hash, token);
}

/**
 * Claim idle content and set aside anything that is not a content hash: such a value is never
 * deleted (it could name another file), its claim goes back, and the pass logs it once, without
 * the value.
 */
async function claimWellFormed(deps: ContentGcDeps, token: string): Promise<string[]> {
  const claimed = await claimIdle(deps, token);
  const valid = claimed.filter((hash) => isContentHash(hash));
  const refused = claimed.filter((hash) => !isContentHash(hash));
  for (const hash of refused) {
    // oxlint-disable-next-line no-await-in-loop -- one claim at a time
    await giveBack(deps, hash, token);
  }
  if (refused.length > 0) {
    deps.logger?.warn(
      { reason: "invalid content hash", skipped: refused.length },
      "content collection skipped",
    );
  }
  return valid;
}

/** Claim, under this pass's token, what is idle past the grace and what a dead pass left claimed. */
async function claimIdle(deps: ContentGcDeps, token: string): Promise<string[]> {
  const now = deps.now?.() ?? Date.now();
  const before = (ms: number): string => new Date(now - ms).toISOString();
  return await deps.lifecycle.claimContent(token, before(CONTENT_GRACE_MS), before(CLAIM_LEASE_MS));
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
async function giveBack(deps: ContentGcDeps, hash: string, token: string): Promise<false> {
  try {
    await deps.lifecycle.abandonContentClaim(hash, token);
  } catch (error) {
    deps.logger?.warn({ err: error }, "content claim could not be given back");
  }
  return false;
}

/** Delete the blob, then end the claim; false when it failed, which leaves the claim to resume. */
async function removeBlob(deps: ContentGcDeps, hash: string, token: string): Promise<boolean> {
  try {
    // A pass that was taken over (its claim outlived the lease) must not delete: the blob may
    // have been collected and stored again since. The window left is this check to the delete.
    if (!(await deps.lifecycle.holdsContentClaim(hash, token))) return false;
    // The blob itself must go before the claim ends: if this throws, the claim stays and the next
    // pass resumes it.
    await deps.storage.delete(contentKey(hash));
    // Variants are disposable; never let their deletion affect authoritative data.
    await deps.storage.delete(publishedGzipPath(hash)).catch(() => {});
    await deps.lifecycle.finishContentCollection(hash, token);
    return true;
  } catch (error) {
    deps.logger?.warn({ err: error, hash }, "content collection failed");
    return false;
  }
}
