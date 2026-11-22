import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";
import { DatabaseSync } from "node:sqlite";
import { CAPTURE_JOB_BACKFILL } from "./capture-job-backfill.ts";
import { commentsRebuildStatements } from "./comments-rebuild.ts";
import { DDL, IDENTITY_STATEMENTS, tableColumns } from "./ddl.ts";
import { createDrizzleAdapter } from "./drizzle-factory.ts";
import { ensureDbDir } from "./ensure-db-dir.ts";
import { gatedSyncMigration } from "./gated-migration.ts";
import { rollbackQuietly } from "./lifecycle-transaction.ts";
import {
  execUnless,
  isDuplicateColumn,
  isMissingColumn,
  reportSkippedIndex,
  toleratedFor,
} from "./migration-errors.ts";
import { applyConnectionPragmas, type SqliteConnectionOptions } from "./pragmas.ts";
import { BUSY_WAIT_MS, drizzleOver } from "./proxy-executors.ts";
import {
  activateRetention,
  attachRetention,
  type RetentionActivation,
} from "./retention-activation.ts";
import { assertReviewSchema } from "./review-schema-check.ts";
import { schema } from "./schema/index.ts";
import { parseTableInfo, type TableColumns } from "./table-info.ts";

export { BUSY_WAIT_MS } from "./proxy-executors.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create a SQLite-backed DatabaseAdapter using node:sqlite and Drizzle ORM.
 *
 * @param path - Filesystem path to the SQLite database file.
 * @param options - `synchronous: "full"` syncs every commit (survives a power cut); default `"normal"`.
 * @returns A DatabaseAdapter backed by the given SQLite file (WAL mode).
 */
export function createSqliteDatabase(
  path: string,
  options: SqliteConnectionOptions = {},
): DatabaseAdapter {
  ensureDbDir(path);
  const sqlite = new DatabaseSync(path, { returnArrays: true });
  applyConnectionPragmas((sql) => {
    sqlite.exec(sql);
  }, options);
  const db = drizzleOver(sqlite, BUSY_WAIT_MS);
  const retention: RetentionActivation = {};

  const adapter = createDrizzleAdapter(
    db,
    {
      metadata: {
        name: "SQLite",
        version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
        description: "SQLite database adapter (node:sqlite + Drizzle)",
        kind: "sqlite",
        category: "database",
      },
      tables: schema,
      migrate: async ({ logger, release }) => {
        await migrateGated(sqlite, logger, release);
        await activateRetention(path, retention);
        // From here a statement waits for a lock without blocking the event loop (`createExecutors`).
        sqlite.exec("PRAGMA busy_timeout = 0");
      },
      close: () => {
        sqlite.close();
      },
      ping: () => {
        sqlite.prepare("SELECT 1").get();
      },
    },
    // One connection: plain statements take their turn behind an open transaction. Raw reads
    // answer arrays, as this adapter always has.
    { isolateStatements: true, rawRows: "arrays" },
  );
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

/** Build lists read `(project_id [, git_branch]) ORDER BY created_at DESC`; these serve it without a sort. */
const BUILDS_LIST_INDEXES = [
  "CREATE INDEX IF NOT EXISTS builds_project_created_idx ON builds (project_id, created_at)",
  "CREATE INDEX IF NOT EXISTS builds_project_branch_created_idx ON builds (project_id, git_branch, created_at)",
  "DROP INDEX IF EXISTS builds_git_branch_idx",
];

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

/** Migrate, skip or refuse by the release recorded in `schema_meta` (ADR 0053). */
async function migrateGated(
  sqlite: DatabaseSync,
  logger: Logger | undefined,
  release: string | undefined,
): Promise<void> {
  await gatedSyncMigration(
    {
      exec: (sql) => {
        sqlite.exec(sql);
      },
      all: (sql) => sqlite.prepare(sql).all(),
    },
    {
      release,
      logger,
      migrate: async () => {
        await assertReviewSchema(async (table) => await Promise.resolve(tableInfo(sqlite, table)));
        runMigrations(sqlite, logger);
      },
    },
  );
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
  for (const statement of BUILDS_LIST_INDEXES) sqlite.exec(statement);
}
