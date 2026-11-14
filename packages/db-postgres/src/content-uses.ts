import type { ContentUsage } from "@storyshelf/core/adapter/database";
/**
 * Build uses of shared content and its claim for collection (ADR 0039). A use and a collector's
 * claim of one blob must end in exactly one outcome, so both take a transaction-scoped advisory
 * lock first (see {@link lockHashes}), and re-read what they decide on after it.
 */
import { sql, type SQL } from "drizzle-orm";
import {
  inTransaction,
  instant,
  textRows,
  type LifecycleDatabase,
  type LifecycleTx,
} from "./lifecycle-transaction.ts";

/** How many advisory locks a transaction can hold for hashes, however many hashes it touches. */
const STRIPES = 64;
/** The first key of those locks, so they cannot collide with another feature's advisory locks. */
const LOCK_CLASS = 39;

/**
 * Hold, until the transaction ends, an advisory lock on every stripe the hashes fall in, taken in
 * stripe order so two transactions never deadlock. A lock per hash would put one entry in the
 * shared lock table for each file of a build (thousands) and can exhaust it; striping bounds that
 * to {@link STRIPES}. Two hashes of one stripe only wait for each other, which costs time, never
 * correctness: a use and a claim of the same hash always share a stripe.
 */
async function lockHashes(tx: LifecycleTx, hashes: readonly string[]): Promise<void> {
  if (hashes.length === 0) return;
  const mask = sql.raw(String(STRIPES - 1));
  const stripes =
    await tx.query(sql`SELECT DISTINCT (hashtextextended(h, 0) & ${mask})::int AS stripe
    FROM ${textRows(hashes)} AS h ORDER BY stripe`);
  for (const row of stripes) {
    // oxlint-disable-next-line no-await-in-loop -- at most STRIPES locks, one at a time, in stripe order
    await tx.query(
      sql`SELECT pg_advisory_xact_lock(${LOCK_CLASS}::int, ${Number(row["stripe"])}::int)`,
    );
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
  sizes?: ReadonlyMap<string, number>,
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
    const uses = JSON.stringify(distinct.map((hash) => ({ hash, size: sizes?.get(hash) ?? null })));
    // A blob of unknown size takes the size another use of it recorded. That is one aggregate joined
    // once, never a subquery per row: a per-row subquery is planned from the table's statistics, and
    // when an analyze saw only a few rows (a hash shared by several builds) it scans the whole table
    // for each of tens of thousands of hashes, which ran for minutes in `postgres-lifecycle` (#1067).
    await tx.query(sql`WITH incoming AS MATERIALIZED (
        SELECT use->>'hash' AS hash, (use->>'size')::bigint AS size
        FROM jsonb_array_elements(${uses}::jsonb) AS use),
      known AS (
        SELECT content_hash, MAX(size_bytes) AS size FROM content_uses
        WHERE size_bytes IS NOT NULL AND content_hash IN (SELECT hash FROM incoming)
        GROUP BY content_hash)
      INSERT INTO content_uses (build_id, content_hash, project_id, created_at, size_bytes)
      SELECT ${buildId}, incoming.hash, ${projectId}, ${instant(now)}, COALESCE(incoming.size, known.size)
      FROM incoming LEFT JOIN known ON known.content_hash = incoming.hash
      ON CONFLICT DO NOTHING`);
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
    WHERE content_hash IN (SELECT * FROM ${textRows(hashes)}) AND collecting_at IS NOT NULL AND ${live}`);
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
    WHERE content_hash IN (SELECT * FROM ${textRows(hashes)}) AND collecting_at IS NOT NULL
      AND collecting_at < ${instant(staleBefore)}`);
}

/**
 * Claim every idle hash (see the capability) under the pass's token, taking over the hashes whose
 * earlier claim is stale. Re-stamping with the new token fences the old collector out.
 *
 * The candidates are read first, only to know which stripes to lock. Under those locks one
 * statement decides again which are claimable (a use recorded in between has either not happened
 * or is visible) and stamps them, so the locks are held for a fixed number of statements however
 * many hashes the pass covers, and a concurrent upload waits for a moment, not a round trip per hash.
 */
export async function claimContent(
  db: LifecycleDatabase,
  token: string,
  idleBefore: string,
  staleBefore: string,
): Promise<string[]> {
  return await inTransaction(db, async (tx) => {
    const candidates = await tx.query(sql`SELECT content_hash FROM content_uses
      GROUP BY content_hash HAVING ${claimable(idleBefore, staleBefore)}`);
    const hashes = candidates.map((row) => String(row["content_hash"]));
    if (hashes.length === 0) return [];
    await lockHashes(tx, hashes);
    const stamped = await tx.query(sql`UPDATE content_uses
      SET collecting_at = ${instant(new Date().toISOString())}, claim_token = ${token}
      WHERE content_hash IN (
        SELECT content_hash FROM content_uses
        WHERE content_hash IN (SELECT * FROM ${textRows(hashes)})
        GROUP BY content_hash HAVING ${claimable(idleBefore, staleBefore)})
      RETURNING content_hash`);
    return [...new Set(stamped.map((row) => String(row["content_hash"])))].toSorted();
  });
}

/** Whether a hash may be claimed: its claim is stale, or it is idle and was released long enough ago. */
function claimable(idleBefore: string, staleBefore: string): SQL {
  return sql`(COUNT(*) FILTER (WHERE collecting_at IS NOT NULL AND collecting_at < ${instant(staleBefore)}) > 0
    OR (COUNT(*) FILTER (WHERE released_at IS NULL) = 0
      AND COUNT(*) FILTER (WHERE collecting_at IS NOT NULL) = 0
      AND MAX(released_at) < ${instant(idleBefore)}))`;
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

/**
 * What the project's live content weighs (see the capability): one row per distinct hash with an
 * unreleased use, its size the largest recorded for it (the same blob has one size; a null never
 * wins over a recorded one).
 */
export async function contentUsage(
  db: LifecycleDatabase,
  projectId: string,
): Promise<ContentUsage> {
  return await inTransaction(db, async (tx) => {
    const rows = await tx.query(sql`SELECT
        COALESCE(SUM(size), 0)::float8 AS bytes,
        COUNT(size) AS blobs,
        COUNT(*) - COUNT(size) AS unsized
      FROM (
        SELECT content_hash, MAX(size_bytes) AS size FROM content_uses
        WHERE project_id = ${projectId} AND released_at IS NULL GROUP BY content_hash
      ) AS live`);
    const [row] = rows;
    return {
      bytes: Number(row?.["bytes"] ?? 0),
      blobs: Number(row?.["blobs"] ?? 0),
      unsized: Number(row?.["unsized"] ?? 0),
    };
  });
}
