import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createDrizzleAdapter } from "@storyshelf/core/adapter/database";
import { DDL } from "@storyshelf/core/ddl";
import { schema } from "@storyshelf/core/schema";
import { drizzle, type AsyncRemoteCallback } from "drizzle-orm/sqlite-proxy";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

declare const __PKG_VERSION__: string | undefined;

const STORYBOOK_META_ALTER = "ALTER TABLE projects ADD COLUMN storybook_meta TEXT";
const WEBHOOK_SECRET_ALTER =
  "ALTER TABLE webhooks ADD COLUMN secret_encrypted TEXT NOT NULL DEFAULT ''";
const WEBHOOK_SECRET_DROP = "ALTER TABLE webhooks DROP COLUMN secret";

type ProxyMethod = "run" | "all" | "values" | "get";

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
  const callback = createCallback(sqlite);
  const db = drizzle(callback, { schema });

  return createDrizzleAdapter(db, {
    metadata: {
      name: "SQLite",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "SQLite database adapter (node:sqlite + Drizzle)",
      kind: "sqlite",
      category: "database",
    },
    migrate: () => {
      runMigrations(sqlite);
    },
    close: () => {
      sqlite.close();
    },
  });
}

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

function createCallback(sqlite: DatabaseSync): AsyncRemoteCallback {
  const callback = (async (sql: string, params: unknown[], method: ProxyMethod) => {
    await Promise.resolve();
    return executeStatement(sqlite, sql, params, method);
  }) as AsyncRemoteCallback;
  return callback;
}

function execIgnore(sqlite: DatabaseSync, sql: string): void {
  try {
    sqlite.exec(sql);
  } catch {
    // idempotent — column already exists or other no-op
  }
}

function migrateCommentsTable(sqlite: DatabaseSync): void {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='comments'")
    .get() as { sql: string } | undefined;
  if (!row?.sql.includes("user_id TEXT NOT NULL REFERENCES users")) {
    return;
  }
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec(`
    CREATE TABLE comments_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
      snapshot_id TEXT REFERENCES snapshots(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      parent_id TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  sqlite.exec("INSERT INTO comments_new SELECT * FROM comments");
  sqlite.exec("DROP TABLE comments");
  sqlite.exec("ALTER TABLE comments_new RENAME TO comments");
  sqlite.exec("CREATE INDEX IF NOT EXISTS comments_build_id_idx ON comments (build_id)");
  sqlite.exec("PRAGMA foreign_keys = ON");
}

function runMigrations(sqlite: DatabaseSync): void {
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(DDL);
  execIgnore(sqlite, STORYBOOK_META_ALTER);
  try {
    sqlite.exec(WEBHOOK_SECRET_ALTER);
    sqlite.exec(WEBHOOK_SECRET_DROP);
  } catch {
    // already migrated — ignore
  }
  try {
    migrateCommentsTable(sqlite);
  } catch {
    execIgnore(sqlite, "PRAGMA foreign_keys = ON");
  }
}
