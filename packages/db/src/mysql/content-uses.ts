/**
 * Build uses of shared content and its claim for collection (ADR 0039). A use and a collector's
 * claim of one blob must end in exactly one outcome. Postgres serializes them with transaction-scoped
 * advisory locks; MySQL's named locks (`GET_LOCK`) belong to the session instead, so each operation
 * takes them on its borrowed connection before its transaction starts and gives them back only after
 * the commit (see {@link withHashLocks}): the other side, waiting on the lock, then reads what was
 * committed. A row lock cannot do this job at READ COMMITTED: there is no row to lock before a
 * hash's first use exists.
 */
import type { ContentUsage } from "@storyshelf/core/adapter/database";
import {
  chunks,
  inTransaction,
  instant,
  nowInstant,
  onConnection,
  retryingDeadlocks,
  statementsOn,
  transaction,
  type LifecycleConnection,
  type LifecyclePool,
  type LifecycleTx,
} from "./lifecycle-transaction.ts";

/** How many named locks an operation can hold for hashes, however many hashes it touches. */
const STRIPES = 64;
/** Keeps {@link stripeOf} exact in a double: a prime well below 2^53 / 31. */
const HASH_MODULUS = 2_147_483_647;
/** How long an operation waits for one stripe before it fails (seconds). */
const LOCK_WAIT_SECONDS = 60;
/**
 * The lock name of a stripe. Named locks are server-wide, so the name carries the database: two
 * deployments on one server never wait for each other.
 */
const LOCK_NAME = "CONCAT('shelf:', LEFT(SHA1(DATABASE()), 16), ':content:', ?)";

/** The stripe a hash falls in: the same in every process, so a use and a claim of one hash meet. */
export function stripeOf(hash: string): number {
  let value = 0;
  for (const char of hash) {
    value = (value * 31 + (char.codePointAt(0) ?? 0)) % HASH_MODULUS;
  }
  return value % STRIPES;
}

/**
 * Run `fn` on one connection while it holds the named lock of every stripe the hashes fall in, taken
 * in stripe order so two operations never deadlock on them. A lock per hash would hold thousands for
 * a large build; striping bounds that to {@link STRIPES}. Two hashes of one stripe only wait for each
 * other, which costs time, never correctness. No row lock is held while waiting for a stripe (the
 * transaction has not started), so a stripe and a row lock cannot form an undetected cycle.
 */
async function withHashLocks<R>(
  pool: LifecyclePool,
  hashes: readonly string[],
  fn: (connection: LifecycleConnection, broken: () => void) => Promise<R>,
): Promise<R> {
  const stripes = [...new Set(hashes.map((hash) => stripeOf(hash)))].toSorted(
    (left, right) => left - right,
  );
  return await onConnection(pool, async (connection, broken) => {
    const { query } = statementsOn(connection);
    const held: number[] = [];
    try {
      for (const stripe of stripes) {
        // oxlint-disable-next-line no-await-in-loop -- one lock at a time, in stripe order
        const rows = await query(`SELECT GET_LOCK(${LOCK_NAME}, ?) AS got`, [
          stripe,
          LOCK_WAIT_SECONDS,
        ]);
        if (Number(rows[0]?.["got"]) !== 1) throw new Error("Timed out waiting for a content lock");
        held.push(stripe);
      }
      return await fn(connection, broken);
    } finally {
      for (const stripe of held) {
        // oxlint-disable-next-line no-await-in-loop -- give each back; a dead session drops them anyway
        await query(`DO RELEASE_LOCK(${LOCK_NAME})`, [stripe]).catch(broken);
      }
    }
  });
}

/**
 * Record the build's use of each hash. A hash a collector claimed refuses the whole call: the
 * refused hashes are returned and nothing is written. A claim taken before `staleBefore` belongs
 * to a collector that stopped; it is cleared here and the use goes ahead. A build that is gone or
 * not `available` records nothing (every hash is refused): a late use would pin the blobs for good.
 */
export async function recordContentUses(
  pool: LifecyclePool,
  projectId: string,
  buildId: string,
  hashes: readonly string[],
  staleBefore?: string,
  sizes?: ReadonlyMap<string, number>,
): Promise<string[]> {
  const distinct = [...new Set(hashes)];
  return await withHashLocks(pool, distinct, async (connection, broken) => {
    const record = async (): Promise<string[]> =>
      await transaction(connection, broken, async (tx) => {
        // Shared: the tombstone (FOR UPDATE) waits for this use, or this use sees the tombstone.
        const build = await tx.query(
          "SELECT retention_state FROM builds WHERE id = ? AND project_id = ? FOR SHARE",
          [buildId, projectId],
        );
        if (build[0]?.["retention_state"] !== "available" || distinct.length === 0) return distinct;
        const claimed = await claimedHashes(tx, distinct, staleBefore);
        if (claimed.size > 0) return distinct.filter((hash) => claimed.has(hash));
        await clearAbandonedClaims(tx, distinct, staleBefore);
        await insertUses(tx, projectId, buildId, distinct, sizes);
        return [];
      });
    return await retryingDeadlocks(record);
  });
}

/** Insert the uses; a blob of unknown size takes the size another use of it recorded. */
async function insertUses(
  tx: LifecycleTx,
  projectId: string,
  buildId: string,
  hashes: readonly string[],
  sizes: ReadonlyMap<string, number> | undefined,
): Promise<void> {
  const known = await knownSizes(
    tx,
    hashes.filter((hash) => sizes?.get(hash) === undefined),
  );
  const now = nowInstant();
  for (const slice of chunks(hashes)) {
    const rows = slice.map((hash) => [
      buildId,
      hash,
      projectId,
      now,
      sizes?.get(hash) ?? known.get(hash) ?? null,
    ]);
    // oxlint-disable-next-line no-await-in-loop -- bounded statements, in order
    await tx.run(
      `INSERT INTO content_uses (build_id, content_hash, project_id, created_at, size_bytes)
        VALUES ? ON DUPLICATE KEY UPDATE build_id = build_id`,
      [rows],
    );
  }
}

/** The largest size recorded for each hash that has one. */
async function knownSizes(
  tx: LifecycleTx,
  hashes: readonly string[],
): Promise<Map<string, number>> {
  const known = new Map<string, number>();
  for (const slice of chunks(hashes)) {
    // oxlint-disable-next-line no-await-in-loop -- bounded statements, in order
    const rows = await tx.query(
      `SELECT content_hash, MAX(size_bytes) AS size FROM content_uses
        WHERE size_bytes IS NOT NULL AND content_hash IN (?) GROUP BY content_hash`,
      [slice],
    );
    for (const row of rows) known.set(String(row["content_hash"]), Number(row["size"]));
  }
  return known;
}

/** The hashes a collector holds a live claim on: any claim, or only those taken since `staleBefore`. */
async function claimedHashes(
  tx: LifecycleTx,
  hashes: readonly string[],
  staleBefore: string | undefined,
): Promise<Set<string>> {
  const claimed = new Set<string>();
  const live = staleBefore === undefined ? "" : "AND collecting_at >= ?";
  const since = staleBefore === undefined ? [] : [instant(staleBefore)];
  for (const slice of chunks(hashes)) {
    // oxlint-disable-next-line no-await-in-loop -- bounded statements, in order
    const rows = await tx.query(
      `SELECT DISTINCT content_hash FROM content_uses
        WHERE content_hash IN (?) AND collecting_at IS NOT NULL ${live}`,
      [slice, ...since],
    );
    for (const row of rows) claimed.add(String(row["content_hash"]));
  }
  return claimed;
}

/** Drop the claims on `hashes` that were taken before `staleBefore`; their uses stay released. */
async function clearAbandonedClaims(
  tx: LifecycleTx,
  hashes: readonly string[],
  staleBefore: string | undefined,
): Promise<void> {
  if (staleBefore === undefined) return;
  for (const slice of chunks(hashes)) {
    // oxlint-disable-next-line no-await-in-loop -- bounded statements, in order
    await tx.run(
      `UPDATE content_uses SET collecting_at = NULL, claim_token = NULL
        WHERE content_hash IN (?) AND collecting_at IS NOT NULL AND collecting_at < ?`,
      [slice, instant(staleBefore)],
    );
  }
}

/** Whether a hash may be claimed: its claim is stale, or it is idle and was released long enough ago. */
const CLAIMABLE = `SUM(collecting_at IS NOT NULL AND collecting_at < ?) > 0
  OR (SUM(released_at IS NULL) = 0 AND SUM(collecting_at IS NOT NULL) = 0 AND MAX(released_at) < ?)`;

/**
 * Claim every idle hash (see the capability) under the pass's token, taking over the hashes whose
 * earlier claim is stale. Re-stamping with the new token fences the old collector out.
 *
 * The candidates are read first, only to know which stripes to lock. Under those locks a transaction
 * decides again which are claimable (a use recorded in between is visible) and stamps them, so the
 * locks are held for a few statements however many hashes the pass covers.
 */
export async function claimContent(
  pool: LifecyclePool,
  token: string,
  idleBefore: string,
  staleBefore: string,
): Promise<string[]> {
  const bounds = [instant(staleBefore), instant(idleBefore)];
  const candidates = await onConnection(pool, async (connection) => {
    const rows = await statementsOn(connection).query(
      `SELECT content_hash FROM content_uses GROUP BY content_hash HAVING ${CLAIMABLE}`,
      bounds,
    );
    return rows.map((row) => String(row["content_hash"]));
  });
  if (candidates.length === 0) return [];
  return await withHashLocks(pool, candidates, async (connection, broken) => {
    const stamp = async (): Promise<string[]> =>
      await transaction(
        connection,
        broken,
        async (tx) => await stampClaims(tx, token, candidates, bounds),
      );
    return await retryingDeadlocks(stamp);
  });
}

/** Under the stripes: decide again, stamp the claimable ones, and answer what the token now holds. */
async function stampClaims(
  tx: LifecycleTx,
  token: string,
  candidates: readonly string[],
  bounds: readonly string[],
): Promise<string[]> {
  const held = new Set<string>();
  const now = nowInstant();
  for (const slice of chunks(candidates)) {
    // oxlint-disable-next-line no-await-in-loop -- bounded statements, in order
    const decided = await tx.query(
      `SELECT content_hash FROM content_uses WHERE content_hash IN (?)
        GROUP BY content_hash HAVING ${CLAIMABLE}`,
      [slice, ...bounds],
    );
    const claimable = decided.map((row) => String(row["content_hash"]));
    if (claimable.length === 0) continue;
    // oxlint-disable-next-line no-await-in-loop -- bounded statements, in order
    await tx.run(
      "UPDATE content_uses SET collecting_at = ?, claim_token = ? WHERE content_hash IN (?)",
      [now, token, claimable],
    );
    // oxlint-disable-next-line no-await-in-loop -- bounded statements, in order
    const stamped = await tx.query(
      "SELECT DISTINCT content_hash FROM content_uses WHERE claim_token = ? AND content_hash IN (?)",
      [token, claimable],
    );
    for (const row of stamped) held.add(String(row["content_hash"]));
  }
  return [...held].toSorted();
}

/** Whether the token still holds the hash's claim and no use of it is unreleased. */
export async function holdsContentClaim(
  pool: LifecyclePool,
  hash: string,
  token: string,
): Promise<boolean> {
  return await inTransaction(pool, async ({ query }) => {
    const rows = await query(
      `SELECT COALESCE(SUM(claim_token <=> ?), 0) AS held, COALESCE(SUM(released_at IS NULL), 0) AS open_n
        FROM content_uses WHERE content_hash = ?`,
      [token, hash],
    );
    return Number(rows[0]?.["held"]) > 0 && Number(rows[0]?.["open_n"]) === 0;
  });
}

/** Clear the claim of a hash if the token holds it; its uses stay released. */
export async function abandonContentClaim(
  pool: LifecyclePool,
  hash: string,
  token: string,
): Promise<void> {
  await inTransaction(pool, async ({ run }) => {
    await run(
      `UPDATE content_uses SET collecting_at = NULL, claim_token = NULL
        WHERE content_hash = ? AND claim_token = ?`,
      [hash, token],
    );
  });
}

/** Drop the rows of a collected hash, if the token still holds its claim. */
export async function finishContentCollection(
  pool: LifecyclePool,
  hash: string,
  token: string,
): Promise<void> {
  await inTransaction(pool, async ({ run }) => {
    await run("DELETE FROM content_uses WHERE content_hash = ? AND claim_token = ?", [hash, token]);
  });
}

/**
 * What the project's live content weighs (see the capability): one row per distinct hash with an
 * unreleased use, its size the largest recorded for it (a null never wins over a recorded one).
 */
export async function contentUsage(pool: LifecyclePool, projectId: string): Promise<ContentUsage> {
  return await inTransaction(pool, async ({ query }) => {
    const rows = await query(
      `SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(size) AS blobs, COUNT(*) - COUNT(size) AS unsized
        FROM (
          SELECT content_hash, MAX(size_bytes) AS size FROM content_uses
          WHERE project_id = ? AND released_at IS NULL GROUP BY content_hash
        ) AS live`,
      [projectId],
    );
    const [row] = rows;
    return {
      bytes: Number(row?.["bytes"] ?? 0),
      blobs: Number(row?.["blobs"] ?? 0),
      unsized: Number(row?.["unsized"] ?? 0),
    };
  });
}
