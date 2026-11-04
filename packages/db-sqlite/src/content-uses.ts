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
 * Claim every idle hash (see the capability) under the pass's token, taking over the hashes whose
 * earlier claim is stale. Re-stamping with the new token fences the old collector out.
 */
export async function claimContent(
  path: string,
  token: string,
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
    const claim = db.prepare(
      "UPDATE content_uses SET collecting_at = ?, claim_token = ? WHERE content_hash = ?",
    );
    const hashes = [...stale, ...idle].map(([hash]) => hash);
    for (const hash of hashes) claim.run(now, token, hash);
    return await Promise.resolve(hashes);
  });
}

/** Whether the token still holds the hash's claim and no use of it is unreleased. */
export async function holdsContentClaim(
  path: string,
  hash: string,
  token: string,
): Promise<boolean> {
  return await inTransaction(path, async (db) => {
    const row = db
      .prepare(
        `SELECT SUM(claim_token = ?), SUM(released_at IS NULL)
         FROM content_uses WHERE content_hash = ?`,
      )
      .get(token, hash) as unknown as [number | null, number | null];
    const [held, open] = row;
    return await Promise.resolve((held ?? 0) > 0 && (open ?? 0) === 0);
  });
}

/** Clear the claim of a hash if the token holds it; its uses stay released. */
export async function abandonContentClaim(
  path: string,
  hash: string,
  token: string,
): Promise<void> {
  await inTransaction(path, async (db) => {
    db.prepare(
      "UPDATE content_uses SET collecting_at = NULL, claim_token = NULL WHERE content_hash = ? AND claim_token = ?",
    ).run(hash, token);
    await Promise.resolve();
  });
}

/** Drop the rows of a collected hash, if the token still holds its claim. */
export async function finishContentCollection(
  path: string,
  hash: string,
  token: string,
): Promise<void> {
  await inTransaction(path, async (db) => {
    db.prepare("DELETE FROM content_uses WHERE content_hash = ? AND claim_token = ?").run(
      hash,
      token,
    );
    await Promise.resolve();
  });
}
