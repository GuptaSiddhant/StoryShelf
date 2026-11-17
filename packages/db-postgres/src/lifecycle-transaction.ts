/** The transaction every lifecycle operation runs in: raw locking SQL beside the domain TxStore. */
import type { TxStore } from "@storyshelf/core/adapter/database";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { transactionStore } from "./drizzle-factory-pg.ts";

/** One row, keyed by column name. */
export type Row = Record<string, unknown>;

/** What the lifecycle needs of a Drizzle Postgres database: a transaction with `execute`. */
export interface LifecycleDatabase {
  transaction<R>(fn: (tx: unknown) => Promise<R>): Promise<R>;
}

/** A transaction: `query` runs SQL in it, `store` is the handle domain writes use. */
export interface LifecycleTx {
  query: (statement: SQL) => Promise<Row[]>;
  store: TxStore;
}

/** postgres.js returns the rows; PGlite returns `{ rows }`. */
export function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return (result as { rows?: Row[] } | undefined)?.rows ?? [];
}

/** Run `fn` in one transaction: it commits when `fn` resolves and rolls back when it throws. */
export async function inTransaction<R>(
  db: LifecycleDatabase,
  fn: (tx: LifecycleTx) => Promise<R>,
): Promise<R> {
  return await db.transaction(async (handle) => {
    const executor = handle as { execute(statement: SQL): Promise<unknown> };
    return await fn({
      query: async (statement) => rowsOf(await executor.execute(statement)),
      store: transactionStore(handle),
    });
  });
}

/** `(a, b, c)` as bound parameters, for an `IN` list; callers never pass an empty list. */
export function valueList(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

/**
 * The strings as rows of one bound JSON parameter, for `IN (SELECT * FROM ...)` or `FROM ...`. One
 * parameter whatever the count, so a build with tens of thousands of files stays under the
 * protocol's limit of 65535 parameters per statement.
 */
export function textRows(values: readonly string[]): SQL {
  return sql`jsonb_array_elements_text(${JSON.stringify(values)}::jsonb)`;
}

/**
 * The strings as one `text[]`, for `column = ANY(...)`. The array is an init plan, built once per
 * statement, so the planner cannot re-expand it per row. `IN (SELECT * FROM jsonb_array_elements_text(...))`
 * can fall back to a nested loop that parses the whole parameter again for every row of the table:
 * quadratic, and minutes for tens of thousands of hashes (#1067). Still one bound parameter.
 */
export function textArray(values: readonly string[]): SQL {
  return sql`ARRAY(SELECT ${textRows(values)})`;
}

/** An ISO instant as a bound `timestamptz`. */
export function instant(iso: string): SQL {
  return sql`${iso}::timestamptz`;
}

/** Read a timestamp column back as the ISO string the capability speaks. */
export function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value as string | number).toISOString();
}
