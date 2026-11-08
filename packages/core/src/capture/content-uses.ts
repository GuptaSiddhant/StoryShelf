/**
 * Record which shared `content/<hash>` blobs a build uses (ADR 0039), so retention knows when the
 * last build releasing one has gone. The write belongs to the `buildReferenceLifecycle`
 * capability; without it nothing is recorded and nothing is ever collected (fail closed).
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Logger } from "../logger.ts";
import { CLAIM_LEASE_MS } from "../retention/content-gc.ts";
import { mapLimit } from "../utils/map-limit.ts";
import { contentKey, isContentHash } from "../utils/paths.ts";

/** A collector has claimed a blob the build uses; the content must be stored again. */
export class ContentCollectingError extends Error {
  readonly hashes: readonly string[];

  constructor(hashes: readonly string[]) {
    super(`content is being collected, store it again and retry: ${hashes.join(", ")}`);
    this.name = "ContentCollectingError";
    this.hashes = hashes;
  }
}

/** Blobs checked at once after a record. */
const EXISTS_CONCURRENCY = 8;

/**
 * Record the build's use of each distinct hash. Call it after the blobs are stored and before the
 * manifest that names them is written.
 *
 * A recorded use cannot be claimed, so the blobs are checked once it is recorded: a collector may
 * have claimed, deleted and finished a hash between the caller's own existence check or write and
 * this call, which would leave the use pointing at a deleted blob.
 *
 * A value that is not a content hash is never recorded and never looked up in storage: it is
 * skipped, counted, and logged once without the value.
 *
 * @returns How many distinct values were skipped as malformed.
 * @throws {ContentCollectingError} When a collector claimed some hash first (nothing was
 *   recorded), or a recorded hash's blob is gone; either way the caller stores the content again.
 */
export async function recordContentUses(
  db: DatabaseAdapter | undefined,
  storage: Pick<StorageAdapter, "exists">,
  target: { projectId: string; buildId: string },
  hashes: Iterable<string>,
  logger?: Logger,
): Promise<number> {
  const lifecycle = db?.buildReferenceLifecycle;
  if (lifecycle === undefined) return 0;
  const { distinct, skipped } = wellFormed(hashes, target.buildId, logger);
  if (distinct.length === 0) return skipped;
  const staleBefore = new Date(Date.now() - CLAIM_LEASE_MS).toISOString();
  const refused = await lifecycle.recordContentUses(
    target.projectId,
    target.buildId,
    distinct,
    staleBefore,
  );
  if (refused.length > 0) throw new ContentCollectingError(refused);
  const missing = await missingBlobs(storage, distinct);
  if (missing.length > 0) throw new ContentCollectingError(missing);
  return skipped;
}

/** Split off the values that are not content hashes; they are counted and logged once, unnamed. */
function wellFormed(
  hashes: Iterable<string>,
  buildId: string,
  logger?: Logger,
): { distinct: string[]; skipped: number } {
  const all = [...new Set(hashes)];
  const distinct = all.filter((hash) => isContentHash(hash));
  const skipped = all.length - distinct.length;
  if (skipped > 0) {
    logger?.warn({ reason: "invalid content hash", skipped, buildId }, "content use skipped");
  }
  return { distinct, skipped };
}

/** The hashes whose shared blob is not in storage. */
async function missingBlobs(
  storage: Pick<StorageAdapter, "exists">,
  hashes: readonly string[],
): Promise<string[]> {
  const present = await mapLimit(hashes, EXISTS_CONCURRENCY, async (hash) => ({
    hash,
    found: await storage.exists(contentKey(hash)),
  }));
  return present.filter((blob) => !blob.found).map((blob) => blob.hash);
}
