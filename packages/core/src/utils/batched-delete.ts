import type { SQL, Table } from "drizzle-orm";
import type { DatabaseAdapter } from "../adapters/database.ts";

/** Rows deleted per batch: each batch is one bounded read plus bounded removes. */
export const DELETE_BATCH_SIZE = 500;

/** Batches per pass, so one sweep never holds the database for an unbounded time. */
export const MAX_DELETE_BATCHES = 40;

/**
 * Delete the rows of `table` matching `where` in bounded batches, oldest id first.
 *
 * Reads at most `batchSize` ids per round, removes them, and repeats until a round returns fewer
 * rows than the batch size or `maxBatches` rounds ran (the next pass continues). Never issues one
 * unbounded DELETE.
 *
 * @param db - Database adapter
 * @param table - Table to delete from (its `id` column is the primary key)
 * @param where - Condition selecting the expired rows
 * @param orderBy - Order for stable batches (the table's id column)
 * @returns Number of rows removed
 */
export async function deleteInBatches(
  db: DatabaseAdapter,
  table: Table,
  where: SQL,
  orderBy: SQL,
  batchSize: number = DELETE_BATCH_SIZE,
  maxBatches: number = MAX_DELETE_BATCHES,
): Promise<number> {
  let removed = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- batches are sequential by design
    const rows = (await db.list(table, { where, orderBy, limit: batchSize })) as {
      id: string;
    }[];
    // oxlint-disable-next-line eslint/no-await-in-loop -- one batch at a time
    await Promise.all(
      rows.map(async (row) => {
        await db.remove(table, row.id);
      }),
    );
    removed += rows.length;
    if (rows.length < batchSize) break;
  }
  return removed;
}
