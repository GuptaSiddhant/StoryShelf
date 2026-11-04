import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";
/**
 * Bun preset for the SQLite database adapter.
 *
 * Same schema, DDL, and Drizzle factory as the `node:sqlite` default;
 * only the driver differs (`bun:sqlite`, synchronous builtin). Bun-only:
 * importing this module outside Bun throws when resolving `bun:sqlite`.
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { CAPTURE_JOB_BACKFILL } from "./capture-job-backfill.ts";
import { commentsRebuildStatements } from "./comments-rebuild.ts";
import { DDL, IDENTITY_STATEMENTS, tableColumns } from "./ddl.ts";
import { createDrizzleAdapter, withManualTransactions } from "./drizzle-factory.ts";
import { ensureDbDir } from "./ensure-db-dir.ts";
import {
  execUnless,
  isDuplicateColumn,
  isMissingColumn,
  reportSkippedIndex,
  toleratedFor,
} from "./migration-errors.ts";
import { assertReviewSchema } from "./review-schema-check.ts";
import { schema } from "./schema/index.ts";
import { parseTableInfo } from "./table-info.ts";

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
      version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
      description: "Bun SQLite database adapter (bun:sqlite + Drizzle)",
      kind: "bun-sqlite",
      category: "database",
    },
    tables: schema,
    migrate: async ({ logger }) => {
      await assertReviewSchema(
        async (table) =>
          await Promise.resolve(parseTableInfo(client.query(`PRAGMA table_info(${table})`).all())),
      );
      runMigrations(client, logger);
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

function migrateCommentsTable(client: Database): void {
  const row = client
    .query("SELECT sql FROM sqlite_master WHERE type='table' AND name='comments'")
    .get() as {
    sql: string;
  } | null;
  if (!row?.sql.includes("user_id TEXT NOT NULL REFERENCES users")) {
    return;
  }
  swapCommentsTable(client);
}

/** Swap `comments` for a rebuilt table in one transaction, with foreign keys off for the swap. */
function swapCommentsTable(client: Database): void {
  client.exec("PRAGMA foreign_keys = OFF");
  try {
    client.exec("BEGIN");
    rebuildComments(client);
    client.exec("COMMIT");
  } catch (error) {
    try {
      client.exec("ROLLBACK");
    } catch {
      // The transaction has already ended; the real failure is rethrown below.
    }
    throw error;
  } finally {
    client.exec("PRAGMA foreign_keys = ON");
  }
}

/** Swap `comments` for the current table, whose `user_id` may be null (inside one transaction). */
function rebuildComments(client: Database): void {
  for (const statement of commentsRebuildStatements()) {
    client.exec(statement);
  }
}

/** Add any DDL column missing from a volume created before it shipped. */
function ensureColumns(client: Database, ddl: string): void {
  for (const [table, columns] of tableColumns(ddl)) {
    const rows = client.query(`PRAGMA table_info(${table})`).all() as { name: unknown }[];
    const existing = new Set(rows.map((row) => String(row.name)));
    for (const column of columns) {
      const [name] = column.split(/\s+/u);
      if (name && !existing.has(name)) {
        execUnless(client, `ALTER TABLE ${table} ADD COLUMN ${column}`, isDuplicateColumn);
      }
    }
  }
}

/** Swap in the browser-aware unique indexes (after `ensureColumns` added the column). */
function applyIdentityStatements(client: Database, logger: Logger | undefined): void {
  for (const statement of IDENTITY_STATEMENTS) {
    if (execUnless(client, statement, toleratedFor(statement))) {
      reportSkippedIndex(
        statement,
        (sql) =>
          Number(
            (client.query(sql).get() as { duplicate_groups: number | bigint })["duplicate_groups"],
          ),
        logger,
      );
    }
  }
}

function runMigrations(client: Database, logger: Logger | undefined): void {
  client.exec("PRAGMA foreign_keys = ON");
  client.exec(DDL);
  ensureColumns(client, DDL);
  applyIdentityStatements(client, logger);
  client.exec(CAPTURE_JOB_BACKFILL); // not ignored: see its doc
  execUnless(client, WEBHOOK_SECRET_DROP, isMissingColumn);
  migrateCommentsTable(client);
}

/** Open the file-backed database, creating its directory first. */
function openDatabase(options: BunSqliteDatabaseOptions): InstanceType<typeof Database> {
  ensureDbDir(options.path ?? "");
  return new Database(options.path, connectionOptions(options));
}
