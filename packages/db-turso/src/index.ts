import { createClient } from "@libsql/client";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { DDL, tableColumns } from "@storyshelf/db-sqlite/ddl";
import { createDrizzleAdapter } from "@storyshelf/db-sqlite/drizzle-factory";
import { schema } from "@storyshelf/db-sqlite/schema";
import { drizzle } from "drizzle-orm/libsql";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create a Turso/libSQL-backed DatabaseAdapter using Drizzle ORM.
 *
 * @param options - Connection options: the database `url` and an optional `authToken`.
 * @returns A DatabaseAdapter backed by the Turso database.
 */
export function createTursoDatabase(options: { url: string; authToken?: string }): DatabaseAdapter {
  const client = createClient({ url: options.url, authToken: options.authToken });
  const db = drizzle(client, { schema });

  return createDrizzleAdapter(db, {
    metadata: {
      name: "Turso",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Turso/libSQL database adapter",
      kind: "turso",
      category: "database",
    },
    migrate: async () => {
      await runMigrations(client);
    },
    close: () => {
      client.close();
    },
    ping: async () => {
      await client.execute("SELECT 1");
    },
  });
}

const WEBHOOK_SECRET_DROP = "ALTER TABLE webhooks DROP COLUMN secret";

async function runMigrations(client: ReturnType<typeof createClient>): Promise<void> {
  await client.executeMultiple(DDL);
  await ensureColumns(client, DDL);
  await execIgnore(client, WEBHOOK_SECRET_DROP);
  await migrateCommentsTable(client);
}

/** Add any DDL column missing from a volume created before it shipped. */
async function ensureColumns(client: ReturnType<typeof createClient>, ddl: string): Promise<void> {
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

async function execIgnore(client: ReturnType<typeof createClient>, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch {
    // idempotent — already migrated
  }
}

async function migrateCommentsTable(client: ReturnType<typeof createClient>): Promise<void> {
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

async function recreateCommentsTable(client: ReturnType<typeof createClient>): Promise<void> {
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
