/**
 * Turso/libSQL preset for the SQLite database adapter.
 *
 * Same schema, DDL, and Drizzle factory as the `node:sqlite` default;
 * only the transport differs (`@libsql/client`: `file:`, `libsql://`,
 * `wss://`, or embedded replica via `syncUrl`). Requires the optional
 * `@libsql/client` peer (`nub add @libsql/client`).
 */
import { createClient } from "@libsql/client";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/libsql";
import { DDL, tableColumns } from "./ddl.ts";
import { createDrizzleAdapter } from "./drizzle-factory.ts";
import { schema } from "./schema/index.ts";

declare const __PKG_VERSION__: string | undefined;

type LibsqlClient = ReturnType<typeof createClient>;

/**
 * Options for creating a Turso-backed DatabaseAdapter.
 *
 * When `client` is supplied, all other connection options are ignored and
 * the caller owns the lifecycle of the client (teardown is a no-op). This
 * is the hook for embedded replicas with custom sync loops and hermetic
 * tests.
 */
export interface TursoDatabaseOptions {
  url?: string;
  authToken?: string;
  syncUrl?: string;
  syncInterval?: number;
  client?: LibsqlClient;
}

/**
 * Create a Turso/libSQL-backed DatabaseAdapter using Drizzle ORM.
 *
 * @param options - Either a connection `url` (plus `authToken`/`syncUrl`/
 * `syncInterval`) or a preconfigured libSQL `client`.
 * @returns A DatabaseAdapter backed by the Turso database.
 */
export function createTursoDatabase(options: TursoDatabaseOptions): DatabaseAdapter {
  const { client, owned } = resolveClient(options);
  const db = drizzle(client, { schema });

  return createDrizzleAdapter(db, {
    metadata: {
      name: "Turso",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Turso/libSQL database adapter",
      kind: "turso",
      category: "database",
    },
    tables: schema,
    migrate: async () => {
      await runMigrations(client);
    },
    close: () => {
      if (owned) {
        client.close();
      }
    },
    ping: async () => {
      await client.execute("SELECT 1");
    },
  });
}

const SUPPORTED_URL = /^(?<proto>libsql|https?|wss?):\/\/|^file:|^:memory:/u;

function isSupportedUrl(url: string): boolean {
  return SUPPORTED_URL.test(url);
}

/** Resolve the libSQL client, distinguishing caller-owned from owned. */
function resolveClient(options: TursoDatabaseOptions): { client: LibsqlClient; owned: boolean } {
  if (options.client) {
    return { client: options.client, owned: false };
  }
  const url = options.url?.trim();
  if (!url) {
    throw new Error(
      "createTursoDatabase: provide `url` (or `syncUrl` with a `file:` url) or a preconfigured `client`",
    );
  }
  if (!isSupportedUrl(url)) {
    throw new Error(
      `createTursoDatabase: unsupported url "${url}" (expected libsql://, https://, wss://, file:, or :memory:)`,
    );
  }
  return {
    client: createClient({
      url,
      authToken: options.authToken,
      syncUrl: options.syncUrl,
      syncInterval: options.syncInterval,
    }),
    owned: true,
  };
}

const WEBHOOK_SECRET_DROP = "ALTER TABLE webhooks DROP COLUMN secret";

async function runMigrations(client: LibsqlClient): Promise<void> {
  await client.executeMultiple(DDL);
  await ensureColumns(client, DDL);
  await execIgnore(client, WEBHOOK_SECRET_DROP);
  await migrateCommentsTable(client);
}

/** Add any DDL column missing from a volume created before it shipped. */
async function ensureColumns(client: LibsqlClient, ddl: string): Promise<void> {
  const inspected = await Promise.all(
    [...tableColumns(ddl)].map(async ([table, columns]) => {
      const result = await client.execute(`PRAGMA table_info(${table})`);
      const rows = result.rows as unknown as { name: unknown }[];
      const existing = new Set(rows.map((row) => String(row.name)));
      return { table, columns, existing };
    }),
  );
  const statements = inspected.flatMap(({ table, columns, existing }) =>
    columns
      .filter((column) => isMissing(column, existing))
      .map((column) => [table, column] as const),
  );
  await Promise.all(
    statements.map(async ([table, column]) => {
      await execIgnore(client, `ALTER TABLE ${table} ADD COLUMN ${column}`);
    }),
  );
}

function isMissing(column: string, existing: Set<string>): boolean {
  const [name] = column.split(/\s+/u);
  return name !== undefined && !existing.has(name);
}

async function execIgnore(client: LibsqlClient, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch {
    // idempotent — already migrated
  }
}

async function migrateCommentsTable(client: LibsqlClient): Promise<void> {
  try {
    const result = await client.execute(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='comments'",
    );
    const sql = (result.rows[0] as unknown as { sql: string } | undefined)?.sql;
    if (!sql?.includes("user_id TEXT NOT NULL REFERENCES users")) {
      return;
    }
    await recreateCommentsTable(client);
  } catch {
    await execIgnore(client, "PRAGMA foreign_keys = ON");
  }
}

async function recreateCommentsTable(client: LibsqlClient): Promise<void> {
  await client.execute("PRAGMA foreign_keys = OFF");
  await client.execute(`
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
  await client.execute("INSERT INTO comments_new SELECT * FROM comments");
  await client.execute("DROP TABLE comments");
  await client.execute("ALTER TABLE comments_new RENAME TO comments");
  await client.execute("CREATE INDEX IF NOT EXISTS comments_build_id_idx ON comments (build_id)");
  await client.execute("PRAGMA foreign_keys = ON");
}
