/**
 * The row operations of the SQLite Drizzle adapter, written against the minimal Drizzle surface the
 * sync and async dialects share. Used by {@link createDrizzleAdapter} and, bound to a transaction
 * handle, as its `tx` store.
 */
import type { ListOptions, TxStore } from "@storyshelf/core/adapter/database";
import type { SQL, Table } from "drizzle-orm";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import type { AnySQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";

export async function updateWhereOne<T extends AnySQLiteTable>(
  drizzle: DrizzleLike,
  table: T,
  id: string,
  values: { [K in keyof T["$inferInsert"]]?: T["$inferInsert"][K] },
  where: SQL,
): Promise<T["$inferSelect"] | null> {
  const updated = (await drizzle
    .update(table)
    .set(values)
    .where(and(eq(idOf(table), id), where) ?? where)
    .returning()
    .get()) as T["$inferSelect"] | undefined;
  return updated ?? (await getOne(drizzle, table, id));
}

export async function insertOne<T extends Table>(
  drizzle: DrizzleLike,
  table: T,
  values: T["$inferInsert"],
): Promise<T["$inferSelect"]> {
  return (await drizzle.insert(table).values(values).returning().get()) as T["$inferSelect"];
}

export async function updateOne<T extends Table>(
  drizzle: DrizzleLike,
  table: T,
  id: string,
  values: Partial<T["$inferInsert"]>,
): Promise<T["$inferSelect"]> {
  return (await drizzle
    .update(table)
    .set(values)
    .where(eq(idOf(table as AnySQLiteTable), id))
    .returning()
    .get()) as T["$inferSelect"];
}

export async function getOne<T extends Table>(
  drizzle: DrizzleLike,
  table: T,
  id: string,
): Promise<T["$inferSelect"] | null> {
  return (
    ((await drizzle
      .select()
      .from(table)
      .where(eq(idOf(table as AnySQLiteTable), id))
      .limit(1)
      .get()) as T["$inferSelect"] | undefined) ?? null
  );
}

export async function removeOne(drizzle: DrizzleLike, table: Table, id: string): Promise<void> {
  await drizzle
    .delete(table)
    .where(eq(idOf(table as AnySQLiteTable), id))
    .run();
}

export async function listMany<T extends Table>(
  drizzle: DrizzleLike,
  table: T,
  opts: ListOptions = {},
): Promise<T["$inferSelect"][]> {
  const query = applyListOptions(drizzle.select().from(table), opts, idOf(table));
  const rows: unknown = await query.all();
  return rows as T["$inferSelect"][];
}

/** The `where`, `orderBy` (with an `id` tie-break), `limit` and `offset`, in that order. */
function applyListOptions(
  query: DrizzleSelectChain,
  opts: ListOptions,
  id: SQLiteColumn,
): DrizzleSelectChain {
  let next = query;
  if (opts.where) {
    next = next.where(opts.where);
  }
  next = next.orderBy(opts.orderBy ? sql`${opts.orderBy}, ${id}` : sql`${id}`);
  if (opts.limit !== undefined) {
    next = next.limit(opts.limit);
  }
  if (opts.offset !== undefined) {
    next = next.offset(opts.offset);
  }
  return next;
}

/** CRUD subset bound to a transaction handle. */
export function buildTxStore(drizzle: DrizzleLike): TxStore {
  return {
    insert: async (table, values) => await insertOne(drizzle, table, values as never),
    update: async (table, id, values) => await updateOne(drizzle, table, id, values as never),
    get: async (table, id) => await getOne(drizzle, table, id),
    remove: async (table, id) => {
      await removeOne(drizzle, table, id);
    },
    list: async (table, opts) => await listMany(drizzle, table, opts),
    count: async (table, where) => await drizzle.$count(table as AnySQLiteTable, where),
  };
}

/** A value or a promise of one (sync node:sqlite vs async libSQL drivers). */
type MaybePromise<T> = T | Promise<T>;

/** Chainable select surface shared by the sync and async Drizzle dialects. */
interface DrizzleSelectChain {
  where(where: SQL): DrizzleSelectChain;
  orderBy(order: SQL): DrizzleSelectChain;
  limit(n: number): DrizzleSelectChain;
  offset(n: number): DrizzleSelectChain;
  get(): MaybePromise<unknown>;
  all(): MaybePromise<unknown[]>;
}

/**
 * Minimal Drizzle surface consumed by {@link createDrizzleAdapter}. Drivers
 * pass their dialect instance as `unknown`; the cast lives here, once, so
 * driver packages stay fully typed. Covered by the adapter contract tests.
 */
export interface DrizzleLike {
  insert(table: AnySQLiteTable): {
    values(values: unknown): { returning(): { get(): MaybePromise<unknown> } };
  };
  update(table: AnySQLiteTable): {
    set(values: unknown): { where(where: SQL): { returning(): { get(): MaybePromise<unknown> } } };
  };
  select(): { from(table: AnySQLiteTable): DrizzleSelectChain };
  delete(table: AnySQLiteTable): { where(where: SQL): { run(): MaybePromise<unknown> } };
  $count(table: AnySQLiteTable, where?: SQL): MaybePromise<number>;
  all<T>(query: SQL): MaybePromise<T[]>;
  transaction<R>(fn: (tx: unknown) => Promise<R>): Promise<R>;
}

function idOf(table: AnySQLiteTable): SQLiteColumn {
  const id = getTableColumns(table)["id"];
  if (!id) {
    throw new Error("Table has no id column");
  }
  return id;
}
