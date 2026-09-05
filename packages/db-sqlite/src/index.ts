import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createDrizzleAdapter } from "@storyshelf/core/adapter/database";
import { DDL } from "@storyshelf/core/ddl";
import { schema } from "@storyshelf/core/schema";
import { drizzle, type AsyncRemoteCallback } from "drizzle-orm/sqlite-proxy";

declare const __PKG_VERSION__: string | undefined;

const STORYBOOK_META_ALTER = "ALTER TABLE projects ADD COLUMN storybook_meta TEXT";

type ProxyMethod = "run" | "all" | "values" | "get";

/**
 * Execute one Drizzle statement against DatabaseSync, returning proxy-shaped rows.
 * Drizzle builds the SQL and params; only the transport is hand-written.
 * `values` shares the `all` shape (array rows); the factory never emits it.
 * Note: for `get`, the proxy passes `result.rows` straight to the row mapper,
 * so `rows` is the single row (or undefined on a miss) — not a one-row array.
 */
function executeStatement(
  sqlite: DatabaseSync,
  sql: string,
  params: unknown[],
  method: ProxyMethod,
): { rows: unknown } {
  const stmt = sqlite.prepare(sql);
  // Single contained cast: Drizzle's params are SQLite scalars by construction.
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- tsc requires the narrowing; the rule misfires on the variadic overloads
  const args = params as SQLInputValue[];
  if (method === "run") {
    stmt.run(...args);
    return { rows: [] };
  }
  if (method === "get") {
    return { rows: stmt.get(...args) };
  }
  return { rows: stmt.all(...args) };
}

/**
 * Create a SQLite-backed DatabaseAdapter using node:sqlite and Drizzle ORM.
 *
 * @param path - Filesystem path to the SQLite database file.
 * @returns A DatabaseAdapter backed by the given SQLite file (WAL mode).
 */
export function createSqliteDatabase(path: string): DatabaseAdapter {
  const sqlite = new DatabaseSync(path, { returnArrays: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  // The declared callback type claims `{ rows: any[] }`, but the session
  // passes `result.rows` straight to the row mapper for `get` — so `rows`
  // must be the single row (or undefined), not a one-row array. The cast
  // quarantines drizzle's inaccurate declaration at this boundary.
  const callback = (async (sql: string, params: unknown[], method: ProxyMethod) => {
    await Promise.resolve();
    return executeStatement(sqlite, sql, params, method);
  }) as AsyncRemoteCallback;
  const db = drizzle(callback, { schema });

  return createDrizzleAdapter(db, {
    metadata: {
      name: "SQLite",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "SQLite database adapter (node:sqlite + Drizzle)",
      kind: "sqlite",
    },
    migrate: () => {
      sqlite.exec(DDL);
      try {
        sqlite.exec(STORYBOOK_META_ALTER);
      } catch {
        // Column already exists or other error — ignore for idempotency
      }
    },
    close: () => {
      sqlite.close();
    },
  });
}
