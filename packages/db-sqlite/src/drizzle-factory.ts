/**
 * SQLite Drizzle adapter factory.
 *
 * Builds a {@link DatabaseAdapter} over any SQLite-compatible Drizzle dialect.
 */

import type {
  DatabaseAdapter,
  DrizzleAdapterOptions,
  ListOptions,
  TxStore,
} from "@storyshelf/core/adapter/database";
import type { SQL, Table } from "drizzle-orm";
import { eq, getTableColumns } from "drizzle-orm";
import type { AnySQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * Wrap an adapter with manual BEGIN/COMMIT transactions for synchronous
 * SQLite drivers (better-sqlite3, `bun:sqlite`), whose `transaction()`
 * rejects async callbacks. Statements run on the adapter's own connection,
 * so the open transaction covers them; rollback runs on throw.
 *
 * @param adapter - Adapter built by {@link createDrizzleAdapter}.
 * @param exec - Synchronous statement runner on the same connection.
 * @returns The adapter with `transact` replaced.
 */
export function withManualTransactions(
  adapter: DatabaseAdapter,
  exec: (sql: string) => void,
): DatabaseAdapter {
  return {
    ...adapter,
    transact: async <R>(fn: (tx: TxStore) => Promise<R>): Promise<R> => {
      const tx: TxStore = {
        insert: async (table, values) => await adapter.insert(table, values),
        update: async (table, id, values) => await adapter.update(table, id, values),
        get: async (table, id) => await adapter.get(table, id),
        remove: async (table, id) => {
          await adapter.remove(table, id);
        },
        list: async (table, opts) => await adapter.list(table, opts),
        count: async (table, where) => await adapter.count(table, where),
      };
      exec("BEGIN");
      try {
        const result = await fn(tx);
        exec("COMMIT");
        return result;
      } catch (error) {
        try {
          exec("ROLLBACK");
        } catch {
          // already rolled back (e.g. constraint abort) — report the cause
        }
        throw error;
      }
    },
  };
}
export function createDrizzleAdapter(db: unknown, options: DrizzleAdapterOptions): DatabaseAdapter {
  const drizzle = db as DrizzleLike;
  let closed = false;
  return {
    metadata: options.metadata,
    tables: options.tables,
    lifecycle: {
      setup: async () => {
        await options.migrate();
      },
      teardown: async () => {
        if (closed) {
          return;
        }
        closed = true;
        await options.close();
      },
      health: async () => {
        if (closed) {
          return { ok: false, detail: "database closed" };
        }
        if (options.ping) {
          await options.ping();
        }
        return { ok: true };
      },
    },
    insert: async <T extends AnySQLiteTable>(
      table: T,
      values: T["$inferInsert"],
    ): Promise<T["$inferSelect"]> => await insertOne(drizzle, table, values),
    update: async <T extends AnySQLiteTable>(
      table: T,
      id: string,
      // Homomorphic equivalent of Partial<T["$inferInsert"]>; written out so
      // the type stays deferred instead of resolving to `{}` under generics.
      values: { [K in keyof T["$inferInsert"]]?: T["$inferInsert"][K] },
    ): Promise<T["$inferSelect"]> => await updateOne(drizzle, table, id, values),
    get: async <T extends AnySQLiteTable>(
      table: T,
      id: string,
    ): Promise<T["$inferSelect"] | null> => await getOne(drizzle, table, id),
    remove: async (table: AnySQLiteTable, id: string): Promise<void> => {
      await removeOne(drizzle, table, id);
    },
    list: async <T extends AnySQLiteTable>(
      table: T,
      opts: ListOptions = {},
    ): Promise<T["$inferSelect"][]> => await listMany(drizzle, table, opts),
    count: async (table: AnySQLiteTable, where?: SQL): Promise<number> =>
      await drizzle.$count(table, where),
    all: async <T>(query: SQL): Promise<T[]> => await drizzle.all(query),
    transact: async <R>(fn: (tx: TxStore) => Promise<R>): Promise<R> =>
      await drizzle.transaction(async (tx) => await fn(buildTxStore(tx as DrizzleLike))),
  };
}

async function insertOne<T extends Table>(
  drizzle: DrizzleLike,
  table: T,
  values: T["$inferInsert"],
): Promise<T["$inferSelect"]> {
  return (await drizzle
    .insert(table as AnySQLiteTable)
    .values(values)
    .returning()
    .get()) as T["$inferSelect"];
}

async function updateOne<T extends Table>(
  drizzle: DrizzleLike,
  table: T,
  id: string,
  values: Partial<T["$inferInsert"]>,
): Promise<T["$inferSelect"]> {
  return (await drizzle
    .update(table as AnySQLiteTable)
    .set(values)
    .where(eq(idOf(table as AnySQLiteTable), id))
    .returning()
    .get()) as T["$inferSelect"];
}

async function getOne<T extends Table>(
  drizzle: DrizzleLike,
  table: T,
  id: string,
): Promise<T["$inferSelect"] | null> {
  return (
    ((await drizzle
      .select()
      .from(table as AnySQLiteTable)
      .where(eq(idOf(table as AnySQLiteTable), id))
      .limit(1)
      .get()) as T["$inferSelect"] | undefined) ?? null
  );
}

async function removeOne(drizzle: DrizzleLike, table: Table, id: string): Promise<void> {
  await drizzle
    .delete(table as AnySQLiteTable)
    .where(eq(idOf(table as AnySQLiteTable), id))
    .run();
}

async function listMany<T extends Table>(
  drizzle: DrizzleLike,
  table: T,
  opts: ListOptions = {},
): Promise<T["$inferSelect"][]> {
  let query = drizzle.select().from(table as AnySQLiteTable) as DrizzleSelectChain;
  if (opts.where) {
    query = query.where(opts.where);
  }
  if (opts.orderBy) {
    query = query.orderBy(opts.orderBy);
  }
  if (opts.limit !== undefined) {
    query = query.limit(opts.limit);
  }
  if (opts.offset !== undefined) {
    query = query.offset(opts.offset);
  }
  const rows: unknown = await query.all();
  return rows as T["$inferSelect"][];
}

/** CRUD subset bound to a transaction handle. */
function buildTxStore(drizzle: DrizzleLike): TxStore {
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
interface DrizzleLike {
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
