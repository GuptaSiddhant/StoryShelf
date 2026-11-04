import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";
import { drizzle, type AsyncRemoteCallback } from "drizzle-orm/sqlite-proxy";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { CAPTURE_JOB_BACKFILL } from "./capture-job-backfill.ts";
import { commentsRebuildStatements } from "./comments-rebuild.ts";
import { DDL, IDENTITY_STATEMENTS, tableColumns } from "./ddl.ts";
import { createDrizzleAdapter } from "./drizzle-factory.ts";
import { ensureDbDir } from "./ensure-db-dir.ts";
import { rollbackQuietly } from "./lifecycle-transaction.ts";
import {
  execUnless,
  isDuplicateColumn,
  isMissingColumn,
  reportSkippedIndex,
  toleratedFor,
} from "./migration-errors.ts";
import {
  activateRetention,
  attachRetention,
  type RetentionActivation,
} from "./retention-activation.ts";
import { assertReviewSchema } from "./review-schema-check.ts";
import { schema } from "./schema/index.ts";
import { parseTableInfo, type TableColumns } from "./table-info.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create a SQLite-backed DatabaseAdapter using node:sqlite and Drizzle ORM.
 *
 * @param path - Filesystem path to the SQLite database file.
 * @returns A DatabaseAdapter backed by the given SQLite file (WAL mode).
 */
export function createSqliteDatabase(path: string): DatabaseAdapter {
  ensureDbDir(path);
  const sqlite = new DatabaseSync(path, { returnArrays: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  const callback = createCallback(sqlite);
  const db = drizzle(callback, { schema });
  const retention: RetentionActivation = {};

  const adapter = createDrizzleAdapter(db, {
    metadata: {
      name: "SQLite",
      version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
      description: "SQLite database adapter (node:sqlite + Drizzle)",
      kind: "sqlite",
      category: "database",
    },
    tables: schema,
    migrate: async ({ logger }) => {
      await assertReviewSchema(async (table) => await Promise.resolve(tableInfo(sqlite, table)));
      runMigrations(sqlite, logger);
      await activateRetention(path, retention);
    },
    close: () => {
      sqlite.close();
    },
    ping: () => {
      sqlite.prepare("SELECT 1").get();
    },
  });
  return attachRetention(adapter, retention);
}

const WEBHOOK_SECRET_DROP = "ALTER TABLE webhooks DROP COLUMN secret";

/**
 * Re-runs share `(project_id, git_sha)` by design (ULID build ids), so the
 * lookup index must not be unique. Existing databases created it UNIQUE —
 * drop and recreate it plain.
 */
const BUILDS_GITSHA_DEDUP = "DROP INDEX IF EXISTS builds_project_gitsha_idx";
const BUILDS_GITSHA_INDEX =
  "CREATE INDEX IF NOT EXISTS builds_project_gitsha_idx ON builds (project_id, git_sha)";

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

export function createCallback(sqlite: DatabaseSync): AsyncRemoteCallback {
  const callback = (async (sql: string, params: unknown[], method: ProxyMethod) => {
    await Promise.resolve();
    return executeStatement(sqlite, sql, params, method);
  }) as AsyncRemoteCallback;
  return callback;
}

function migrateCommentsTable(sqlite: DatabaseSync): void {
  // The connection opens with `returnArrays`: a row is `[sql]`, not `{ sql }`. (Reading it as an
  // object threw here on every boot, and the catch-all around the call hid that the rebuild never ran.)
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='comments'")
    .get() as unknown as [string] | undefined;
  if (!row?.[0].includes("user_id TEXT NOT NULL REFERENCES users")) {
    return;
  }
  swapCommentsTable(sqlite);
}

/** Swap `comments` for a rebuilt table in one transaction, with foreign keys off for the swap. */
function swapCommentsTable(sqlite: DatabaseSync): void {
  sqlite.exec("PRAGMA foreign_keys = OFF");
  try {
    sqlite.exec("BEGIN");
    rebuildComments(sqlite);
    sqlite.exec("COMMIT");
  } catch (error) {
    rollbackQuietly(sqlite);
    throw error;
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON");
  }
}

/** Swap `comments` for the current table, whose `user_id` may be null (inside one transaction). */
function rebuildComments(sqlite: DatabaseSync): void {
  for (const statement of commentsRebuildStatements()) {
    sqlite.exec(statement);
  }
}

/** Add any DDL column missing from a volume created before it shipped. */
function ensureColumns(sqlite: DatabaseSync, ddl: string): void {
  for (const [table, columns] of tableColumns(ddl)) {
    const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as unknown as unknown[][];
    const existing = new Set(rows.map((row) => String(row[1])));
    for (const column of columns) {
      const [name] = column.split(/\s+/u);
      if (name && !existing.has(name)) {
        execUnless(sqlite, `ALTER TABLE ${table} ADD COLUMN ${column}`, isDuplicateColumn);
      }
    }
  }
}

/** Swap in the browser-aware unique indexes (after `ensureColumns` added the column). */
function applyIdentityStatements(sqlite: DatabaseSync, logger: Logger | undefined): void {
  for (const statement of IDENTITY_STATEMENTS) {
    if (execUnless(sqlite, statement, toleratedFor(statement))) {
      // The connection opens with `returnArrays`: the count is the first value of the row.
      reportSkippedIndex(
        statement,
        (sql) => Number((sqlite.prepare(sql).get() as unknown as [number | bigint])[0]),
        logger,
      );
    }
  }
  sqlite.exec(CAPTURE_JOB_BACKFILL); // not ignored: see its doc
}

function runMigrations(sqlite: DatabaseSync, logger: Logger | undefined): void {
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(DDL);
  ensureColumns(sqlite, DDL);
  applyIdentityStatements(sqlite, logger);
  dropWebhookSecret(sqlite);
  migrateBuildsGitShaIndex(sqlite);
  migrateCommentsTable(sqlite);
}

/** The columns of a table, from `PRAGMA table_info` (rows are arrays: the adapter opens with `returnArrays`). */
function tableInfo(sqlite: DatabaseSync, table: string): TableColumns {
  return parseTableInfo(sqlite.prepare(`PRAGMA table_info(${table})`).all());
}

/** Drop the retired `webhooks.secret` column; a database that no longer has it is already migrated. */
function dropWebhookSecret(sqlite: DatabaseSync): void {
  execUnless(sqlite, WEBHOOK_SECRET_DROP, isMissingColumn);
}

/** Downgrade a legacy UNIQUE project/sha index to a plain lookup index. */
function migrateBuildsGitShaIndex(sqlite: DatabaseSync): void {
  sqlite.exec(BUILDS_GITSHA_DEDUP);
  sqlite.exec(BUILDS_GITSHA_INDEX);
}
