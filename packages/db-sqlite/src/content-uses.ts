/** Build uses of shared content and its claim for collection (ADR 0039), in SQLite's write lock. */
import { inTransaction } from "./lifecycle-transaction.ts";

/**
 * Record the build's use of each hash. A hash a collector claimed refuses the whole call, so a use
 * and the collection of the same blob end in exactly one outcome: the refused hashes are returned
 * and nothing is written.
 */
export async function recordContentUses(
  path: string,
  projectId: string,
  buildId: string,
  hashes: readonly string[],
): Promise<string[]> {
  return await inTransaction(path, async (db) => {
    const claimed = db.prepare(
      "SELECT 1 FROM content_uses WHERE content_hash = ? AND collecting_at IS NOT NULL LIMIT 1",
    );
    const refused = [...new Set(hashes)].filter((hash) => claimed.get(hash) !== undefined);
    if (refused.length > 0) return await Promise.resolve(refused);
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO content_uses (build_id, content_hash, project_id, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    for (const hash of new Set(hashes)) insert.run(buildId, hash, projectId, now);
    return await Promise.resolve([]);
  });
}

/**
 * Claim every idle hash (see the capability) and return it with the hashes whose earlier claim is
 * stale, which are stamped again so a second collector does not resume them too.
 */
export async function claimContent(
  path: string,
  idleBefore: string,
  staleBefore: string,
): Promise<string[]> {
  return await inTransaction(path, async (db) => {
    const now = new Date().toISOString();
    const stale = db
      .prepare(
        "SELECT DISTINCT content_hash FROM content_uses WHERE collecting_at IS NOT NULL AND collecting_at < ?",
      )
      .all(staleBefore) as unknown as [string][];
    const idle = db
      .prepare(
        `SELECT content_hash FROM content_uses GROUP BY content_hash
         HAVING SUM(released_at IS NULL) = 0
           AND SUM(collecting_at IS NOT NULL) = 0
           AND MAX(released_at) < ?`,
      )
      .all(idleBefore) as unknown as [string][];
    const claim = db.prepare("UPDATE content_uses SET collecting_at = ? WHERE content_hash = ?");
    const hashes = [...stale, ...idle].map(([hash]) => hash);
    for (const hash of hashes) claim.run(now, hash);
    return await Promise.resolve(hashes);
  });
}

/** Clear the claim of a hash; its uses stay released. */
export async function abandonContentClaim(path: string, hash: string): Promise<void> {
  await inTransaction(path, async (db) => {
    db.prepare("UPDATE content_uses SET collecting_at = NULL WHERE content_hash = ?").run(hash);
    await Promise.resolve();
  });
}

/** Drop the rows of a collected hash. */
export async function finishContentCollection(path: string, hash: string): Promise<void> {
  await inTransaction(path, async (db) => {
    db.prepare("DELETE FROM content_uses WHERE content_hash = ? AND collecting_at IS NOT NULL").run(
      hash,
    );
    await Promise.resolve();
  });
}
