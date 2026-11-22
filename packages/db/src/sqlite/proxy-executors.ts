/**
 * The statement transport between Drizzle's `sqlite-proxy` driver and a `node:sqlite` connection.
 * Drizzle builds the SQL and params; only the transport is hand-written. Drizzle asks for each read
 * in a row mode (`array` for the queries it maps, `object` otherwise), and gets it; the connection
 * itself keeps returning arrays, which the adapter's own statements read.
 */
import { nodeSQLiteCodecs } from "drizzle-orm/node-sqlite";
import {
  drizzle,
  type SqliteProxyExecutors,
  type SqliteRemoteDatabase,
} from "drizzle-orm/sqlite-proxy";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

/** How long a statement waits for another connection's write lock (the old `busy_timeout`). */
export const BUSY_WAIT_MS = 5000;
const BUSY_POLL_MS = 10;

type Method = "run" | "get" | "all";
type RowMode = "array" | "object";

/**
 * Drizzle over a `node:sqlite` connection through the executors below. The proxy driver decodes
 * nothing by default, so it takes `node:sqlite`'s own codecs: the rows it reads are the rows that
 * connection hands over (booleans from `0`/`1`, as Drizzle 0.45's column mappers did).
 */
export function drizzleOver(sqlite: DatabaseSync, busyWaitMs = 0): SqliteRemoteDatabase {
  return drizzle(createExecutors(sqlite, busyWaitMs), { codecs: nodeSQLiteCodecs });
}

/**
 * The executors for `drizzle(executors)`. With `busyWaitMs` > 0 a statement that finds the file
 * locked by another connection waits with the event loop free, and tries again: SQLite's own
 * `busy_timeout` sleeps the thread, and the holder (the reference lifecycle's connection, whose
 * executors await) can only commit from this same loop, so a blocking wait could only end in
 * "database is locked".
 */
export function createExecutors(sqlite: DatabaseSync, busyWaitMs = 0): SqliteProxyExecutors {
  const execute = async (
    sql: string,
    params: unknown[],
    method: Method,
    rowMode?: RowMode,
  ): Promise<unknown> => {
    await Promise.resolve();
    const deadline = Date.now() + busyWaitMs;
    while (true) {
      try {
        return executeStatement(sqlite, { sql, params, method, rowMode });
      } catch (error) {
        if (!isBusy(error) || Date.now() >= deadline) throw error;
        // oxlint-disable-next-line eslint/no-await-in-loop -- wait for the competing writer to finish
        await delay(BUSY_POLL_MS);
      }
    }
  };
  // One contained cast: the executor types are overloaded per row mode, which one function serves.
  return {
    run: async (sql: string, params: unknown[]) => await execute(sql, params, "run"),
    get: async (sql: string, params: unknown[], rowMode?: RowMode) =>
      await execute(sql, params, "get", rowMode),
    all: async (sql: string, params: unknown[], rowMode?: RowMode) =>
      await execute(sql, params, "all", rowMode),
  } as SqliteProxyExecutors;
}

/** One statement as Drizzle hands it over. */
interface Statement {
  sql: string;
  params: unknown[];
  method: Method;
  rowMode: RowMode | undefined;
}

/**
 * Run one statement. `get` answers the single row (or `undefined` on a miss), `all` every row, each
 * in the row mode asked for (arrays when none is given); `run` answers the run result.
 */
function executeStatement(sqlite: DatabaseSync, statement: Statement): unknown {
  const stmt = sqlite.prepare(statement.sql);
  stmt.setReturnArrays(statement.rowMode !== "object");
  // Single contained cast: Drizzle's params are SQLite scalars by construction.
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- tsc requires the narrowing; the rule misfires on the variadic overloads
  const args = statement.params as SQLInputValue[];
  if (statement.method === "run") return stmt.run(...args);
  if (statement.method === "get") return stmt.get(...args);
  return stmt.all(...args);
}

function isBusy(error: unknown): boolean {
  return error instanceof Error && error.message.includes("database is locked");
}
