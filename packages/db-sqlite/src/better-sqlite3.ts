import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";
/**
 * better-sqlite3 preset for the SQLite database adapter.
 *
 * Same schema, DDL, and Drizzle factory as the `node:sqlite` default;
 * only the driver differs (synchronous, native). Requires the optional
 * `better-sqlite3` peer (`nub add better-sqlite3`).
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
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
import { applyConnectionPragmas, type SqliteConnectionOptions } from "./pragmas.ts";
import { assertReviewSchema } from "./review-schema-check.ts";
import { schema } from "./schema/index.ts";
import { parseTableInfo } from "./table-info.ts";

declare const __PKG_VERSION__: string | undefined;

type BetterSqlite3Client = InstanceType<typeof Database>;

/**
 * Options for creating a better-sqlite3-backed DatabaseAdapter.
 *
 * When `client` is supplied, `path` is ignored and the caller owns the
 * lifecycle of the client (teardown is a no-op). This is the hook for
 * shared connections and hermetic tests.
 */
export interface BetterSqlite3DatabaseOptions extends SqliteConnectionOptions {
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
  const client = options.client ?? openDatabase(options);
  if (owned) {
    applyConnectionPragmas((sql) => {
      client.exec(sql);
    }, options);
  }
  const db = drizzle(client, { schema });

  const adapter = createDrizzleAdapter(db, {
    metadata: {
      name: "better-sqlite3",
      version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
      description: "better-sqlite3 database adapter (native + Drizzle)",
      kind: "better-sqlite3",
      category: "database",
    },
    tables: schema,
    migrate: async ({ logger }) => {
      await assertReviewSchema(
        async (table) =>
          await Promise.resolve(
            parseTableInfo(client.prepare(`PRAGMA table_info(${table})`).all()),
          ),
      );
      runMigrations(client, logger);
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

function migrateCommentsTable(client: BetterSqlite3Client): void {
  const row = client
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='comments'")
    .get() as { sql: string } | undefined;
  if (!row?.sql.includes("user_id TEXT NOT NULL REFERENCES users")) {
    return;
  }
  swapCommentsTable(client);
}

/** Swap `comments` for a rebuilt table in one transaction, with foreign keys off for the swap. */
function swapCommentsTable(client: BetterSqlite3Client): void {
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
function rebuildComments(client: BetterSqlite3Client): void {
  for (const statement of commentsRebuildStatements()) {
    client.exec(statement);
  }
}

/** Add any DDL column missing from a volume created before it shipped. */
function ensureColumns(client: BetterSqlite3Client, ddl: string): void {
  for (const [table, columns] of tableColumns(ddl)) {
    const rows = client.prepare(`PRAGMA table_info(${table})`).all() as { name: unknown }[];
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
function applyIdentityStatements(client: BetterSqlite3Client, logger: Logger | undefined): void {
  for (const statement of IDENTITY_STATEMENTS) {
    if (execUnless(client, statement, toleratedFor(statement))) {
      reportSkippedIndex(
        statement,
        (sql) =>
          Number(
            (client.prepare(sql).get() as { duplicate_groups: number | bigint })[
              "duplicate_groups"
            ],
          ),
        logger,
      );
    }
  }
}

function runMigrations(client: BetterSqlite3Client, logger: Logger | undefined): void {
  client.exec("PRAGMA foreign_keys = ON");
  client.exec(DDL);
  ensureColumns(client, DDL);
  applyIdentityStatements(client, logger);
  client.exec(CAPTURE_JOB_BACKFILL); // not ignored: see its doc
  execUnless(client, WEBHOOK_SECRET_DROP, isMissingColumn);
  migrateCommentsTable(client);
}

/** Open the file-backed database, creating its directory first. */
function openDatabase(options: BetterSqlite3DatabaseOptions): InstanceType<typeof Database> {
  ensureDbDir(options.path ?? "");
  return new Database(options.path, connectionOptions(options));
}
