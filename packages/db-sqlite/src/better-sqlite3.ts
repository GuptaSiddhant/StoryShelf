import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
/**
 * better-sqlite3 preset for the SQLite database adapter.
 *
 * Same schema, DDL, and Drizzle factory as the `node:sqlite` default;
 * only the driver differs (synchronous, native). Requires the optional
 * `better-sqlite3` peer (`nub add better-sqlite3`).
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { DDL, tableColumns } from "./ddl.ts";
import { createDrizzleAdapter, withManualTransactions } from "./drizzle-factory.ts";
import { schema } from "./schema/index.ts";

declare const __PKG_VERSION__: string | undefined;

type BetterSqlite3Client = InstanceType<typeof Database>;

/**
 * Options for creating a better-sqlite3-backed DatabaseAdapter.
 *
 * When `client` is supplied, `path` is ignored and the caller owns the
 * lifecycle of the client (teardown is a no-op). This is the hook for
 * shared connections and hermetic tests.
 */
export interface BetterSqlite3DatabaseOptions {
  path?: string;
  readonly?: boolean;
  client?: BetterSqlite3Client;
}

/**
 * Create a better-sqlite3-backed DatabaseAdapter using Drizzle ORM.
 *
 * @param options - Either a filesystem `path` (use `":memory:"` for an
 * ephemeral database) or a preconfigured better-sqlite3 `client`.
 * @returns A DatabaseAdapter backed by the SQLite file (WAL mode).
 */
export function createBetterSqlite3Database(
  options: BetterSqlite3DatabaseOptions,
): DatabaseAdapter {
  if (!options.client && options.path === undefined) {
    throw new Error("createBetterSqlite3Database: provide `path` or a preconfigured `client`");
  }

  const owned = !options.client;
  const client = options.client ?? new Database(options.path, connectionOptions(options));
  if (owned) {
    client.exec("PRAGMA journal_mode = WAL");
    client.exec("PRAGMA busy_timeout = 5000");
  }
  const db = drizzle(client, { schema });

  const adapter = createDrizzleAdapter(db, {
    metadata: {
      name: "better-sqlite3",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "better-sqlite3 database adapter (native + Drizzle)",
      kind: "better-sqlite3",
      category: "database",
    },
    tables: schema,
    migrate: () => {
      runMigrations(client);
    },
    close: () => {
      if (owned) {
        client.close();
      }
    },
    ping: () => {
      client.prepare("SELECT 1").get();
    },
  });

  return withManualTransactions(adapter, (sql) => {
    client.exec(sql);
  });
}

const WEBHOOK_SECRET_DROP = "ALTER TABLE webhooks DROP COLUMN secret";

/** better-sqlite3 rejects `undefined` option values — pass only defined keys. */
function connectionOptions(options: BetterSqlite3DatabaseOptions): { readonly?: boolean } {
  return options.readonly === undefined ? {} : { readonly: options.readonly };
}

function execIgnore(client: BetterSqlite3Client, sql: string): void {
  try {
    client.exec(sql);
  } catch {
    // idempotent — column already exists or other no-op
  }
}

function migrateCommentsTable(client: BetterSqlite3Client): void {
  const row = client
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='comments'")
    .get() as { sql: string } | undefined;
  if (!row?.sql.includes("user_id TEXT NOT NULL REFERENCES users")) {
    return;
  }
  client.exec("PRAGMA foreign_keys = OFF");
  client.exec(`
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
  client.exec("INSERT INTO comments_new SELECT * FROM comments");
  client.exec("DROP TABLE comments");
  client.exec("ALTER TABLE comments_new RENAME TO comments");
  client.exec("CREATE INDEX IF NOT EXISTS comments_build_id_idx ON comments (build_id)");
  client.exec("PRAGMA foreign_keys = ON");
}

/** Add any DDL column missing from a volume created before it shipped. */
function ensureColumns(client: BetterSqlite3Client, ddl: string): void {
  for (const [table, columns] of tableColumns(ddl)) {
    const rows = client.prepare(`PRAGMA table_info(${table})`).all() as { name: unknown }[];
    const existing = new Set(rows.map((row) => String(row.name)));
    for (const column of columns) {
      const [name] = column.split(/\s+/u);
      if (name && !existing.has(name)) {
        execIgnore(client, `ALTER TABLE ${table} ADD COLUMN ${column}`);
      }
    }
  }
}

function runMigrations(client: BetterSqlite3Client): void {
  client.exec("PRAGMA foreign_keys = ON");
  client.exec(DDL);
  ensureColumns(client, DDL);
  try {
    client.exec(WEBHOOK_SECRET_DROP);
  } catch {
    // already migrated — ignore
  }
  try {
    migrateCommentsTable(client);
  } catch {
    execIgnore(client, "PRAGMA foreign_keys = ON");
  }
}
