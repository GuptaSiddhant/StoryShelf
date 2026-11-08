/**
 * Manual BEGIN/COMMIT transactions for the synchronous SQLite drivers (better-sqlite3, `bun:sqlite`).
 */
import type { DatabaseAdapter, TxStore } from "@storyshelf/core/adapter/database";
import { createNestingGuard } from "./nesting-guard.ts";
import { isolatePlainStatements } from "./statement-isolation.ts";
import { createTransactionMutex } from "./transaction-mutex.ts";

/**
 * Wrap an adapter with manual BEGIN/COMMIT transactions for synchronous
 * SQLite drivers (better-sqlite3, `bun:sqlite`), whose `transaction()`
 * rejects async callbacks. Statements run on the adapter's own connection,
 * so the open transaction covers them; rollback runs on throw. Overlapping calls queue, one
 * transaction at a time, and the adapter's plain statements take their turn in the same queue, so
 * none lands inside a transaction it does not belong to (see `transaction-mutex.ts`).
 *
 * @param adapter - Adapter built by {@link createDrizzleAdapter}.
 * @param exec - Synchronous statement runner on the same connection.
 * @returns The adapter with `transact` replaced.
 */
export function withManualTransactions(
  adapter: DatabaseAdapter,
  exec: (sql: string) => void,
): DatabaseAdapter {
  const mutex = createTransactionMutex(createNestingGuard());
  // `tx` calls the inner adapter below directly; only the outer one's plain methods take turns.
  return isolatePlainStatements(
    {
      ...adapter,
      transact: async <R>(fn: (tx: TxStore) => Promise<R>): Promise<R> =>
        await mutex.run(async () => await runManualTransaction(adapter, exec, fn)),
    },
    mutex,
  );
}

async function runManualTransaction<R>(
  adapter: DatabaseAdapter,
  exec: (sql: string) => void,
  fn: (tx: TxStore) => Promise<R>,
): Promise<R> {
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
}
