/**
 * Record which shared `content/<hash>` blobs a build uses (ADR 0039), so retention knows when the
 * last build releasing one has gone. The write belongs to the `buildReferenceLifecycle`
 * capability; without it nothing is recorded and nothing is ever collected (fail closed).
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { mapLimit } from "../utils/map-limit.ts";

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
 * @throws {ContentCollectingError} When a collector claimed some hash first (nothing was
 *   recorded), or a recorded hash's blob is gone; either way the caller stores the content again.
 */
export async function recordContentUses(
  db: DatabaseAdapter | undefined,
  storage: Pick<StorageAdapter, "exists">,
  target: { projectId: string; buildId: string },
  hashes: Iterable<string>,
): Promise<void> {
  const lifecycle = db?.buildReferenceLifecycle;
  if (lifecycle === undefined) return;
  const distinct = [...new Set(hashes)];
  if (distinct.length === 0) return;
  const refused = await lifecycle.recordContentUses(target.projectId, target.buildId, distinct);
  if (refused.length > 0) throw new ContentCollectingError(refused);
  const present = await mapLimit(distinct, EXISTS_CONCURRENCY, async (hash) => ({
    hash,
    found: await storage.exists(`content/${hash}`),
  }));
  const missing = present.filter((blob) => !blob.found).map((blob) => blob.hash);
  if (missing.length > 0) throw new ContentCollectingError(missing);
}
