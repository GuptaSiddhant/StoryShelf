import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
/**
 * Bun preset for the SQLite database adapter.
 *
 * Same schema, DDL, and Drizzle factory as the `node:sqlite` default;
 * only the driver differs (`bun:sqlite`, synchronous builtin). Bun-only:
 * importing this module outside Bun throws when resolving `bun:sqlite`.
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { DDL, tableColumns } from "./ddl.ts";
import { createDrizzleAdapter, withManualTransactions } from "./drizzle-factory.ts";
import { ensureDbDir } from "./ensure-db-dir.ts";
import { schema } from "./schema/index.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Options for creating a Bun-backed DatabaseAdapter.
 *
 * When `client` is supplied, `path` is ignored and the caller owns the
 * lifecycle of the client (teardown is a no-op). This is the hook for
 * shared connections and hermetic tests.
 */
export interface BunSqliteDatabaseOptions {
  path?: string;
  readonly?: boolean;
  create?: boolean;
  readwrite?: boolean;
  client?: Database;
}

/**
 * Create a Bun-backed DatabaseAdapter using Drizzle ORM.
 *
 * @param options - Either a filesystem `path` (use `":memory:"` for an
 * ephemeral database) or a preconfigured `bun:sqlite` `client`.
 * @returns A DatabaseAdapter backed by the SQLite file (WAL mode).
 */
export function createBunSqliteDatabase(options: BunSqliteDatabaseOptions): DatabaseAdapter {
  if (!options.client && options.path === undefined) {
    throw new Error("createBunSqliteDatabase: provide `path` or a preconfigured `client`");
  }

  const owned = !options.client;
  const client = options.client ?? openDatabase(options);
  if (owned) {
    client.exec("PRAGMA journal_mode = WAL");
    client.exec("PRAGMA busy_timeout = 5000");
  }
  const db = drizzle(client, { schema });

  const adapter = createDrizzleAdapter(db, {
    metadata: {
      name: "Bun SQLite",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Bun SQLite database adapter (bun:sqlite + Drizzle)",
      kind: "bun-sqlite",
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
      client.query("SELECT 1").get();
    },
  });

  return withManualTransactions(adapter, (sql) => {
    client.exec(sql);
  });
}

const WEBHOOK_SECRET_DROP = "ALTER TABLE webhooks DROP COLUMN secret";

/** Bun ignores `undefined` options, but only defined keys are passed. */
function connectionOptions(options: BunSqliteDatabaseOptions): {
  readonly?: boolean;
  create?: boolean;
  readwrite?: boolean;
} {
  const result: { readonly?: boolean; create?: boolean; readwrite?: boolean } = {};
  if (options.readonly !== undefined) {
    result.readonly = options.readonly;
  }
  if (options.create !== undefined) {
    result.create = options.create;
  }
  if (options.readwrite !== undefined) {
    result.readwrite = options.readwrite;
  }
  return result;
}

function execIgnore(client: Database, sql: string): void {
  try {
    client.exec(sql);
  } catch {
    // idempotent — column already exists or other no-op
  }
}

function migrateCommentsTable(client: Database): void {
  const row = client
    .query("SELECT sql FROM sqlite_master WHERE type='table' AND name='comments'")
    .get() as {
    sql: string;
  } | null;
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
function ensureColumns(client: Database, ddl: string): void {
  for (const [table, columns] of tableColumns(ddl)) {
    const rows = client.query(`PRAGMA table_info(${table})`).all() as { name: unknown }[];
    const existing = new Set(rows.map((row) => String(row.name)));
    for (const column of columns) {
      const [name] = column.split(/\s+/u);
      if (name && !existing.has(name)) {
        execIgnore(client, `ALTER TABLE ${table} ADD COLUMN ${column}`);
      }
    }
  }
}

function runMigrations(client: Database): void {
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

/** Open the file-backed database, creating its directory first. */
function openDatabase(options: BunSqliteDatabaseOptions): InstanceType<typeof Database> {
  ensureDbDir(options.path ?? "");
  return new Database(options.path, connectionOptions(options));
}
