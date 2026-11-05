/**
 * Build uses of shared content and its claim for collection (ADR 0039). A use and a collector's
 * claim of one blob must end in exactly one outcome, so both take a transaction-scoped advisory
 * lock on the hash first, in sorted order (no deadlock), and re-read what they decide on after it.
 */
import { sql, type SQL } from "drizzle-orm";
import {
  inTransaction,
  instant,
  valueList,
  type LifecycleDatabase,
  type LifecycleTx,
} from "./lifecycle-transaction.ts";

/** Hold the hash's lock until the transaction ends; a 64-bit key, so a clash only serializes more. */
async function lockHash(tx: LifecycleTx, hash: string): Promise<void> {
  await tx.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${hash}, 0))`);
}

async function lockHashes(tx: LifecycleTx, hashes: readonly string[]): Promise<void> {
  for (const hash of hashes.toSorted()) {
    // oxlint-disable-next-line no-await-in-loop -- locks are taken one at a time, in hash order
    await lockHash(tx, hash);
  }
}

/**
 * Record the build's use of each hash. A hash a collector claimed refuses the whole call: the
 * refused hashes are returned and nothing is written. A claim taken before `staleBefore` belongs
 * to a collector that stopped; it is cleared here and the use goes ahead. A build that is gone or
 * not `available` records nothing (every hash is refused): a late use would pin the blobs for good.
 */
export async function recordContentUses(
  db: LifecycleDatabase,
  projectId: string,
  buildId: string,
  hashes: readonly string[],
  staleBefore?: string,
): Promise<string[]> {
  const distinct = [...new Set(hashes)];
  return await inTransaction(db, async (tx) => {
    // Shared: the tombstone (FOR UPDATE) waits for this use, or this use sees the tombstone.
    const build = await tx.query(sql`SELECT retention_state FROM builds
      WHERE id = ${buildId} AND project_id = ${projectId} FOR SHARE`);
    if (build[0]?.["retention_state"] !== "available" || distinct.length === 0) return distinct;
    await lockHashes(tx, distinct);
    const claimed = await claimedHashes(tx, distinct, staleBefore);
    if (claimed.size > 0) return distinct.filter((hash) => claimed.has(hash));
    await clearAbandonedClaims(tx, distinct, staleBefore);
    const now = new Date().toISOString();
    for (const hash of distinct) {
      // oxlint-disable-next-line no-await-in-loop -- one use row per hash
      await tx.query(sql`INSERT INTO content_uses (build_id, content_hash, project_id, created_at)
        VALUES (${buildId}, ${hash}, ${projectId}, ${instant(now)}) ON CONFLICT DO NOTHING`);
    }
    return [];
  });
}

/** The hashes a collector holds a live claim on: any claim, or only those taken since `staleBefore`. */
async function claimedHashes(
  tx: LifecycleTx,
  hashes: readonly string[],
  staleBefore: string | undefined,
): Promise<Set<string>> {
  const live: SQL =
    staleBefore === undefined ? sql`true` : sql`collecting_at >= ${instant(staleBefore)}`;
  const rows = await tx.query(sql`SELECT DISTINCT content_hash FROM content_uses
    WHERE content_hash IN (${valueList(hashes)}) AND collecting_at IS NOT NULL AND ${live}`);
  return new Set(rows.map((row) => String(row["content_hash"])));
}

/** Drop the claims on `hashes` that were taken before `staleBefore`; their uses stay released. */
async function clearAbandonedClaims(
  tx: LifecycleTx,
  hashes: readonly string[],
  staleBefore: string | undefined,
): Promise<void> {
  if (staleBefore === undefined) return;
  await tx.query(sql`UPDATE content_uses SET collecting_at = NULL, claim_token = NULL
    WHERE content_hash IN (${valueList(hashes)}) AND collecting_at IS NOT NULL
      AND collecting_at < ${instant(staleBefore)}`);
}

/** Whether the hash may be claimed now: its claim is stale, or it is idle and released long enough. */
async function claimable(
  tx: LifecycleTx,
  hash: string,
  idleBefore: string,
  staleBefore: string,
): Promise<boolean> {
  const rows = await tx.query(sql`SELECT
      COUNT(*) FILTER (WHERE collecting_at IS NOT NULL AND collecting_at < ${instant(staleBefore)}) AS stale_n,
      COUNT(*) FILTER (WHERE released_at IS NULL) AS open_n,
      COUNT(*) FILTER (WHERE collecting_at IS NOT NULL) AS claimed_n,
      COALESCE(MAX(released_at) < ${instant(idleBefore)}, false) AS old_enough
    FROM content_uses WHERE content_hash = ${hash}`);
  const row = rows[0] ?? {};
  if (Number(row["stale_n"]) > 0) return true;
  return (
    Number(row["open_n"]) === 0 && Number(row["claimed_n"]) === 0 && row["old_enough"] === true
  );
}

/**
 * Claim every idle hash (see the capability) under the pass's token, taking over the hashes whose
 * earlier claim is stale. Re-stamping with the new token fences the old collector out. Candidates
 * are read first, then each is locked and re-checked, so a use recorded in between wins.
 */
export async function claimContent(
  db: LifecycleDatabase,
  token: string,
  idleBefore: string,
  staleBefore: string,
): Promise<string[]> {
  return await inTransaction(db, async (tx) => {
    const candidates = await tx.query(sql`SELECT content_hash FROM content_uses
      GROUP BY content_hash
      HAVING COUNT(*) FILTER (WHERE collecting_at IS NOT NULL AND collecting_at < ${instant(staleBefore)}) > 0
        OR (COUNT(*) FILTER (WHERE released_at IS NULL) = 0
          AND COUNT(*) FILTER (WHERE collecting_at IS NOT NULL) = 0
          AND MAX(released_at) < ${instant(idleBefore)})`);
    const claimed: string[] = [];
    const now = new Date().toISOString();
    for (const hash of candidates.map((row) => String(row["content_hash"])).toSorted()) {
      // oxlint-disable-next-line no-await-in-loop -- lock, re-check and stamp one hash at a time
      await lockHash(tx, hash);
      // oxlint-disable-next-line no-await-in-loop -- the check must follow the lock
      if (!(await claimable(tx, hash, idleBefore, staleBefore))) continue;
      // oxlint-disable-next-line no-await-in-loop -- stamp under the lock just taken
      await tx.query(sql`UPDATE content_uses SET collecting_at = ${instant(now)}, claim_token = ${token}
        WHERE content_hash = ${hash}`);
      claimed.push(hash);
    }
    return claimed;
  });
}

/** Whether the token still holds the hash's claim and no use of it is unreleased. */
export async function holdsContentClaim(
  db: LifecycleDatabase,
  hash: string,
  token: string,
): Promise<boolean> {
  return await inTransaction(db, async ({ query }) => {
    const rows = await query(sql`SELECT
        COUNT(*) FILTER (WHERE claim_token = ${token}) AS held,
        COUNT(*) FILTER (WHERE released_at IS NULL) AS open_n
      FROM content_uses WHERE content_hash = ${hash}`);
    return Number(rows[0]?.["held"]) > 0 && Number(rows[0]?.["open_n"]) === 0;
  });
}

/** Clear the claim of a hash if the token holds it; its uses stay released. */
export async function abandonContentClaim(
  db: LifecycleDatabase,
  hash: string,
  token: string,
): Promise<void> {
  await inTransaction(db, async ({ query }) => {
    await query(sql`UPDATE content_uses SET collecting_at = NULL, claim_token = NULL
      WHERE content_hash = ${hash} AND claim_token = ${token}`);
  });
}

/** Drop the rows of a collected hash, if the token still holds its claim. */
export async function finishContentCollection(
  db: LifecycleDatabase,
  hash: string,
  token: string,
): Promise<void> {
  await inTransaction(db, async ({ query }) => {
    await query(
      sql`DELETE FROM content_uses WHERE content_hash = ${hash} AND claim_token = ${token}`,
    );
  });
}
