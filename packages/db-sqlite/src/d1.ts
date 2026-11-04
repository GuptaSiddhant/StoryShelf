/**
 * Cloudflare D1 preset for the SQLite database adapter.
 *
 * Same schema, DDL, and Drizzle factory as the `node:sqlite` default;
 * only the driver differs (D1 HTTP binding, async). No peer dependency:
 * the `D1Database` binding is provided by the Workers runtime and its
 * minimal surface is declared locally (no `@cloudflare/workers-types`
 * needed).
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/d1";
import { CAPTURE_JOB_BACKFILL } from "./capture-job-backfill.ts";
import { commentsRebuildStatements } from "./comments-rebuild.ts";
import { DDL, IDENTITY_STATEMENTS, tableColumns } from "./ddl.ts";
import { createDrizzleAdapter } from "./drizzle-factory.ts";
import {
  execUnlessAsync,
  isDuplicateColumn,
  isMissingColumn,
  toleratedFor,
} from "./migration-errors.ts";
import { assertReviewSchema } from "./review-schema-check.ts";
import { schema } from "./schema/index.ts";
import { parseTableInfo } from "./table-info.ts";

declare const __PKG_VERSION__: string | undefined;

/** Minimal prepared-statement surface of a D1 database binding. */
export interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  all(): Promise<{ results: unknown[] }>;
  run(): Promise<unknown>;
  first(): Promise<unknown>;
  raw(): Promise<unknown[]>;
}

/** Minimal surface of a Cloudflare D1 database binding. */
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
  exec(query: string): Promise<unknown>;
}

/**
 * Options for creating a D1-backed DatabaseAdapter. Client-only: the
 * binding comes from the Workers runtime (`env.DB`), so the caller always
 * owns its lifecycle (teardown is a no-op).
 */
export interface D1DatabaseOptions {
  client: D1Database;
}

/**
 * Create a Cloudflare-D1-backed DatabaseAdapter using Drizzle ORM.
 *
 * @param options - The D1 database binding (`env.DB`).
 * @returns A DatabaseAdapter backed by the D1 database.
 */
export function createD1Database(options: D1DatabaseOptions): DatabaseAdapter {
  if (!options.client) {
    throw new Error("createD1Database: provide a D1 `client` binding (env.DB)");
  }
  const { client } = options;
  // oxlint-disable-next-line typescript/no-unsafe-argument -- structural D1 binding vs platform type
  const db = drizzle(client as never, { schema });

  return createDrizzleAdapter(db, {
    metadata: {
      name: "Cloudflare D1",
      version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
      description: "Cloudflare D1 database adapter (D1 binding + Drizzle)",
      kind: "d1",
      category: "database",
      // A Workers-only binding: no long-running process to consume capture jobs (ADR 0006, decision 3).
      supportsTesting: false,
    },
    tables: schema,
    migrate: async () => {
      // A binding that refuses PRAGMA has no columns to check, as in `ensureColumns`.
      await assertReviewSchema(async (table) =>
        parseTableInfo((await inspectRows(client, table)) ?? []),
      );
      await runMigrations(client);
    },
    close: () => {
      // no-op: the Workers runtime owns the binding
    },
    ping: async () => {
      await client.prepare("SELECT 1").bind().first();
    },
  });
}

const WEBHOOK_SECRET_DROP = "ALTER TABLE webhooks DROP COLUMN secret";

async function runMigrations(client: D1Database): Promise<void> {
  // Sequential: DDL order matters (tables before indexes) and D1 has no
  // multi-statement exec.
  for (const statement of splitStatements(DDL)) {
    // oxlint-disable-next-line no-await-in-loop -- ordered DDL, see above
    await client.exec(statement);
  }
  await ensureColumns(client, DDL);
  for (const statement of IDENTITY_STATEMENTS) {
    // oxlint-disable-next-line no-await-in-loop -- ordered: drop old indexes, then create new
    await execUnlessAsync(
      async (sql) => await client.exec(sql),
      statement,
      toleratedFor(statement),
    );
  }
  await client.exec(CAPTURE_JOB_BACKFILL); // not ignored: see its doc
  await execUnlessAsync(
    async (sql) => await client.exec(sql),
    WEBHOOK_SECRET_DROP,
    isMissingColumn,
  );
  await migrateCommentsTable(client);
}

/** Split a multi-statement DDL script into single statements for `exec`. */
function splitStatements(ddl: string): string[] {
  return ddl
    .split(/;\n/u)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
}

/** Add any DDL column missing from a database created before it shipped. */
async function ensureColumns(client: D1Database, ddl: string): Promise<void> {
  // Sequential: one PRAGMA round-trip per table keeps the per-table round-trips ordered.
  for (const [table, columns] of tableColumns(ddl)) {
    // oxlint-disable-next-line no-await-in-loop -- ordered per-table inspection
    const existing = await inspectColumns(client, table);
    for (const column of columns) {
      const [name] = column.split(/\s+/u);
      if (name && (existing === undefined || !existing.has(name))) {
        // oxlint-disable-next-line no-await-in-loop -- ordered column backfill
        await execUnlessAsync(
          async (sql) => await client.exec(sql),
          `ALTER TABLE ${table} ADD COLUMN ${column}`,
          isDuplicateColumn,
        );
      }
    }
  }
}

/** The rows of `PRAGMA table_info`, or `undefined` when the binding cannot serve PRAGMA. */
async function inspectRows(client: D1Database, table: string): Promise<unknown[] | undefined> {
  try {
    const result = await client.prepare(`PRAGMA table_info(${table})`).bind().all();
    return result.results;
  } catch {
    return undefined;
  }
}

/**
 * Read a table's columns via `PRAGMA table_info`. Returns `undefined` when
 * the binding cannot serve PRAGMA (callers then add columns blindly).
 */
async function inspectColumns(client: D1Database, table: string): Promise<Set<string> | undefined> {
  const rows = (await inspectRows(client, table)) as { name: unknown }[] | undefined;
  return rows === undefined ? undefined : new Set(rows.map((row) => String(row.name)));
}

async function migrateCommentsTable(client: D1Database): Promise<void> {
  const row = (await client
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='comments'")
    .bind()
    .first()) as { sql: string } | null;
  if (!row?.sql.includes("user_id TEXT NOT NULL REFERENCES users")) {
    return;
  }
  await recreateCommentsTable(client);
}

/**
 * Swap `comments` for a table whose `user_id` may be null. One `batch` is one transaction on D1, so
 * a failure leaves the old table as it was. Nothing references `comments`, so foreign keys need not
 * be switched off for the swap.
 */
async function recreateCommentsTable(client: D1Database): Promise<void> {
  await client.batch(commentsRebuildStatements().map((sql) => client.prepare(sql)));
}
