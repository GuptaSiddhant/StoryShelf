import { eq, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { AnySQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";
import Database from "better-sqlite3";

import type { DatabaseAdapter, ListOptions } from "@storyshelf/core/adapter/database";
import { schema } from "@storyshelf/core/schema";
import { DDL } from "@storyshelf/core/ddl";

declare const __PKG_VERSION__: string | undefined;

function idOf(table: AnySQLiteTable): SQLiteColumn {
  // eslint-disable-next-line no-non-null-assertion -- every table has an `id` column
  return getTableColumns(table)["id"]!;
}

/* eslint-disable typescript/no-explicit-any, typescript/no-unsafe-call, typescript/no-unsafe-member-access -- drizzle query builder is intentionally loosely typed */
function applyListOptions(
  query: any,
  opts: ListOptions,
): void {
  if (opts.where) {
    query.where(opts.where);
  }
  if (opts.orderBy) {
    query.orderBy(opts.orderBy);
  }
  if (opts.limit !== undefined) {
    query.limit(opts.limit);
  }
  if (opts.offset !== undefined) {
    query.offset(opts.offset);
  }
}
/* eslint-enable typescript/no-explicit-any, typescript/no-unsafe-call, typescript/no-unsafe-member-access */

/**
 * Create a SQLite-backed DatabaseAdapter using better-sqlite3 and Drizzle ORM.
 *
 * @param path - Filesystem path to the SQLite database file.
 * @returns A DatabaseAdapter backed by the given SQLite file (WAL mode).
 */
export function createSqliteDatabase(path: string): DatabaseAdapter {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });

  // Better-sqlite3 is synchronous, so `async` is required only by the
  // DatabaseAdapter interface (no `await`), and drizzle's `.get()`/`["id"]`
  // Are guaranteed present despite the undefined-able types. Both rules are
  // False positives here.
  /* eslint-disable require-await, no-non-null-assertion, no-unnecessary-type-assertion */
  return {
    metadata: {
      name: "SQLite",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "SQLite database adapter (better-sqlite3 + Drizzle)",
      kind: "sqlite",
    },
    async insert(table, values) {
      return db.insert(table).values(values).returning().get()!;
    },
    async update(table, id, values) {
      return db.update(table).set(values).where(eq(idOf(table), id)).returning().get()!;
    },
    async get(table, id) {
      return db.select().from(table).where(eq(idOf(table), id)).limit(1).get() ?? null;
    },
    async remove(table, id) {
      db.delete(table).where(eq(idOf(table), id)).run();
    },
    async list(table, opts: ListOptions = {}) {
      const query = db.select().from(table);
      applyListOptions(query, opts);
      return query.all();
    },
    async count(table, where) {
      return db.$count(table, where);
    },
    async all(query) {
      return db.all(query);
    },
    async migrate() {
      sqlite.exec(DDL);
      try {
        sqlite.exec("ALTER TABLE projects ADD COLUMN storybook_meta TEXT");
      } catch {
        // Column already exists or other error — ignore for idempotency
      }
    },
    async close() {
      sqlite.close();
    },
  };
  /* eslint-enable require-await, no-non-null-assertion, no-unnecessary-type-assertion */
}
