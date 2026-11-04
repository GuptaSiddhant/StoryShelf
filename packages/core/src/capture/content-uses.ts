/**
 * Record which shared `content/<hash>` blobs a build uses (ADR 0039), so retention knows when the
 * last build releasing one has gone. The write belongs to the `buildReferenceLifecycle`
 * capability; without it nothing is recorded and nothing is ever collected (fail closed).
 */
import type { DatabaseAdapter } from "../adapters/database.ts";

/** A collector has claimed a blob the build uses; the content must be stored again. */
export class ContentCollectingError extends Error {
  readonly hashes: readonly string[];

  constructor(hashes: readonly string[]) {
    super(`content is being collected, store it again and retry: ${hashes.join(", ")}`);
    this.name = "ContentCollectingError";
    this.hashes = hashes;
  }
}

/**
 * Record the build's use of each distinct hash. Call it after the blobs are stored and before the
 * manifest that names them is written.
 *
 * @throws {ContentCollectingError} When a collector claimed some hash first; nothing was recorded.
 */
export async function recordContentUses(
  db: DatabaseAdapter | undefined,
  target: { projectId: string; buildId: string },
  hashes: Iterable<string>,
): Promise<void> {
  const lifecycle = db?.buildReferenceLifecycle;
  if (lifecycle === undefined) return;
  const distinct = [...new Set(hashes)];
  if (distinct.length === 0) return;
  const refused = await lifecycle.recordContentUses(target.projectId, target.buildId, distinct);
  if (refused.length > 0) throw new ContentCollectingError(refused);
}
