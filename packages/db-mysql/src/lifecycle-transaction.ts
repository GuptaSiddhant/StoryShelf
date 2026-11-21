/**
 * The connection and transaction every MySQL lifecycle operation runs on (ADR 0039).
 *
 * Each operation borrows one connection from the pool for its whole length, so a session-level lock
 * (`GET_LOCK`, see `content-uses.ts`) can be held across the transaction's commit, and runs its
 * transaction at READ COMMITTED: like Postgres, every statement sees what other sessions committed
 * before it, which is what a domain write that reads after taking the fence expects. InnoDB's default
 * REPEATABLE READ would answer a plain read from a snapshot taken at the first read instead.
 */
import type { TxStore } from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/mysql2";
import { transactionStore } from "./drizzle-factory-mysql.ts";
import { toMySqlDateTime } from "./schema/datetime.ts";
import { schema } from "./schema/index.ts";

/** One row, keyed by column name. */
export type Row = Record<string, unknown>;

/** A connection the pool lends out (mysql2/promise `PoolConnection`). */
export interface LifecycleConnection {
  query(statement: string, values?: unknown): Promise<unknown>;
  release(): void;
  destroy(): void;
}

/** What the lifecycle needs of a mysql2/promise pool: a connection of its own per operation. */
export interface LifecyclePool {
  getConnection(): Promise<LifecycleConnection>;
}

/** A transaction: `query` reads rows, `run` writes and counts the rows changed, `store` is for domain writes. */
export interface LifecycleTx {
  query: (statement: string, values?: readonly unknown[]) => Promise<Row[]>;
  run: (statement: string, values?: readonly unknown[]) => Promise<number>;
  store: TxStore;
}

/** InnoDB chose this transaction as a deadlock victim and rolled it back whole. */
const DEADLOCK = 1213;
/** How often an operation without a caller callback is retried after a deadlock. */
const DEADLOCK_ATTEMPTS = 5;

/** The rows of a mysql2 `query` answer (`[rows, fields]`), or none for a write. */
export function rowsOf(result: unknown): Row[] {
  const [rows] = Array.isArray(result) ? (result as unknown[]) : [];
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

/** The `affectedRows` of a mysql2 write answer (`[ResultSetHeader, undefined]`). */
function changedOf(result: unknown): number {
  const [header] = Array.isArray(result) ? (result as unknown[]) : [];
  return (header as { affectedRows?: number } | undefined)?.affectedRows ?? 0;
}

/** Statements on one borrowed connection, outside or inside a transaction. */
export function statementsOn(connection: LifecycleConnection): Omit<LifecycleTx, "store"> {
  return {
    query: async (statement, values) => rowsOf(await connection.query(statement, values)),
    run: async (statement, values) => changedOf(await connection.query(statement, values)),
  };
}

/**
 * Borrow a connection for `fn`. A connection whose transaction could not be rolled back is in an
 * unknown state, so it is destroyed instead of going back to the pool.
 */
export async function onConnection<R>(
  pool: LifecyclePool,
  fn: (connection: LifecycleConnection, broken: () => void) => Promise<R>,
): Promise<R> {
  const connection = await pool.getConnection();
  let healthy = true;
  try {
    return await fn(connection, () => {
      healthy = false;
    });
  } finally {
    if (healthy) connection.release();
    else connection.destroy();
  }
}

/** Run `fn` in one READ COMMITTED transaction on the connection: commit when it resolves, roll back when it throws. */
export async function transaction<R>(
  connection: LifecycleConnection,
  broken: () => void,
  fn: (tx: LifecycleTx) => Promise<R>,
): Promise<R> {
  await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
  await connection.query("START TRANSACTION");
  try {
    const result = await fn({
      ...statementsOn(connection),
      store: transactionStore(drizzle(connection as never, { schema, mode: "default" })),
    });
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    await connection.query("ROLLBACK").catch(broken);
    throw error;
  }
}

/** Whether InnoDB rolled the transaction back to break a deadlock. */
export function isDeadlock(error: unknown): boolean {
  const { errno, code } = (error ?? {}) as { errno?: unknown; code?: unknown };
  return errno === DEADLOCK || code === "ER_LOCK_DEADLOCK";
}

/**
 * Run `fn` again while InnoDB picks it as a deadlock victim. Only for operations whose whole work is
 * the transaction's own SQL: the victim was rolled back entirely, so running it again is the same
 * as running it once. A caller's domain callback is never repeated; its deadlock reaches the caller.
 */
export async function retryingDeadlocks<R>(fn: () => Promise<R>): Promise<R> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one attempt at a time
      return await fn();
    } catch (error) {
      if (!isDeadlock(error) || attempt >= DEADLOCK_ATTEMPTS) throw error;
    }
  }
}

/** One transaction on its own connection; `retry` repeats it after a deadlock (see {@link retryingDeadlocks}). */
export async function inTransaction<R>(
  pool: LifecyclePool,
  fn: (tx: LifecycleTx) => Promise<R>,
  retry = true,
): Promise<R> {
  return await onConnection(pool, async (connection, broken) => {
    const once = async (): Promise<R> => await transaction(connection, broken, fn);
    return retry ? await retryingDeadlocks(once) : await once();
  });
}

/** An ISO instant as the `DATETIME(3)` text the columns hold (UTC, no zone). */
export function instant(iso: string): string {
  return toMySqlDateTime(iso);
}

/** The current instant, as {@link instant}. */
export function nowInstant(): string {
  return instant(new Date().toISOString());
}

/** `values` in slices of `size`, for statements whose text grows with the list. */
export function chunks<T>(values: readonly T[], size = 5000): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    out.push(values.slice(start, start + size));
  }
  return out;
}
