/**
 * SQLite Drizzle adapter factory.
 *
 * Builds a {@link DatabaseAdapter} over any SQLite-compatible Drizzle dialect. The row operations
 * live in `drizzle-crud.ts`, the lifecycle in `drizzle-lifecycle.ts` and the manual-transaction
 * wrapper in `manual-transactions.ts`; this file composes them and stays the package entry.
 */

import type {
  DatabaseAdapter,
  DrizzleAdapterOptions,
  ListOptions,
  TxStore,
} from "@storyshelf/core/adapter/database";
import type { SQL } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import {
  buildTxStore,
  getOne,
  insertOne,
  listMany,
  removeOne,
  updateOne,
  updateWhereOne,
  type DrizzleLike,
} from "./drizzle-crud.ts";
import { buildLifecycle } from "./drizzle-lifecycle.ts";
import { createNestingGuard } from "./nesting-guard.ts";
import { isolatePlainStatements } from "./statement-isolation.ts";
import { createTransactionMutex } from "./transaction-mutex.ts";

export { withManualTransactions } from "./manual-transactions.ts";

/** What differs between the drivers sharing {@link createDrizzleAdapter}. */
export interface DrizzleAdapterBehavior {
  /**
   * Plain statements take their turn in the transaction queue (`node:sqlite`, on one connection).
   * Off for drivers with a connection per transaction (Turso, D1) and for lifecycle transaction handles.
   */
  isolateStatements?: boolean;
}

export function createDrizzleAdapter(
  db: unknown,
  options: DrizzleAdapterOptions,
  behavior: DrizzleAdapterBehavior = {},
): DatabaseAdapter {
  const drizzle = db as DrizzleLike;
  // The shared connection (or, for a libSQL file, its connection per transaction) cannot overlap
  // transactions: they queue (see `transaction-mutex.ts`).
  const mutex = createTransactionMutex(createNestingGuard());
  const adapter: DatabaseAdapter = {
    metadata: options.metadata,
    tables: options.tables,
    lifecycle: buildLifecycle(options),
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
    updateWhere: async <T extends AnySQLiteTable>(
      table: T,
      id: string,
      values: { [K in keyof T["$inferInsert"]]?: T["$inferInsert"][K] },
      where: SQL,
    ): Promise<T["$inferSelect"] | null> => await updateWhereOne(drizzle, table, id, values, where),
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
      await mutex.run(
        async () =>
          await drizzle.transaction(async (tx) => await fn(buildTxStore(tx as DrizzleLike))),
      ),
  };
  return behavior.isolateStatements === true ? isolatePlainStatements(adapter, mutex) : adapter;
}
