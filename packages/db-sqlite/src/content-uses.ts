/** Build uses of shared content and its claim for collection (ADR 0039), in SQLite's write lock. */
import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./lifecycle-transaction.ts";

/**
 * Record the build's use of each hash. A hash a collector claimed refuses the whole call, so a use
 * and the collection of the same blob end in exactly one outcome: the refused hashes are returned
 * and nothing is written. A claim taken before `staleBefore` (an ISO instant) belongs to a
 * collector that stopped: the record clears it in the same transaction and goes ahead, and the
 * stalled collector's `holdsContentClaim` check, just before its delete, then fails, so it deletes
 * nothing. A build that is gone or being deleted records nothing either (every hash is refused):
 * its content was or is being released, so a late use would pin the blobs for good.
 */
export async function recordContentUses(
  path: string,
  projectId: string,
  buildId: string,
  hashes: readonly string[],
  staleBefore?: string,
): Promise<string[]> {
  return await inTransaction(path, async (db) => {
    const distinct = [...new Set(hashes)];
    const build = db
      .prepare("SELECT retention_state FROM builds WHERE id = ? AND project_id = ?")
      .get(buildId, projectId) as unknown as [string] | undefined;
    if (build?.[0] !== "available") return await Promise.resolve(distinct);
    const refused = claimedHashes(db, distinct, staleBefore);
    if (refused.length > 0) return await Promise.resolve(refused);
    clearAbandonedClaims(db, distinct, staleBefore);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO content_uses (build_id, content_hash, project_id, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    for (const hash of distinct) insert.run(buildId, hash, projectId, now);
    return await Promise.resolve([]);
  });
}

/** The hashes a collector holds a live claim on: any claim, or only those taken since `staleBefore`. */
function claimedHashes(
  db: DatabaseSync,
  hashes: readonly string[],
  staleBefore: string | undefined,
): string[] {
  const claimed = db.prepare(
    "SELECT 1 FROM content_uses WHERE content_hash = ? AND collecting_at IS NOT NULL AND (? IS NULL OR collecting_at >= ?) LIMIT 1",
  );
  const cutoff = staleBefore ?? null;
  return hashes.filter((hash) => claimed.get(hash, cutoff, cutoff) !== undefined);
}

/** Drop the claims on `hashes` that were taken before `staleBefore`; their uses stay released. */
function clearAbandonedClaims(
  db: DatabaseSync,
  hashes: readonly string[],
  staleBefore: string | undefined,
): void {
  if (staleBefore === undefined) return;
  const clear = db.prepare(
    "UPDATE content_uses SET collecting_at = NULL, claim_token = NULL WHERE content_hash = ? AND collecting_at IS NOT NULL AND collecting_at < ?",
  );
  for (const hash of hashes) clear.run(hash, staleBefore);
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
