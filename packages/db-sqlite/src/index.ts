import { eq, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { AnySQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";
import Database from "better-sqlite3";

import type { DatabaseAdapter, ListOptions } from "@storyshelf/core/adapter/database";
import { schema } from "@storyshelf/core/schema";
import { DDL } from "@storyshelf/core/ddl";

declare const __PKG_VERSION__: string;

function idOf(table: AnySQLiteTable): SQLiteColumn {
  // eslint-disable-next-line no-non-null-assertion -- every table has an `id` column
  return getTableColumns(table)["id"]!;
}

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

  // better-sqlite3 is synchronous, so `async` is required only by the
  // DatabaseAdapter interface (no `await`), and drizzle's `.get()`/`["id"]`
  // are guaranteed present despite the undefined-able types. Both rules are
  // false positives here.
  /* eslint-disable require-await, no-non-null-assertion, no-unnecessary-type-assertion */
  return {
    metadata: {
      name: "SQLite",
      version: typeof __PKG_VERSION__ === "undefined" ? "0.0.0" : __PKG_VERSION__, // oxlint-disable-line unicorn/no-typeof-undefined
      description: "SQLite database adapter (better-sqlite3 + Drizzle)",
      kind: "sqlite",
    },
    async insert(table, values) {
      const row = db.insert(table).values(values).returning().get();
      return row!;
    },
    async update(table, id, values) {
      const row = db.update(table).set(values).where(eq(idOf(table), id)).returning().get();
      return row!;
    },
    async get(table, id) {
      const row = db.select().from(table).where(eq(idOf(table), id)).limit(1).get();
      return row ?? null;
    },
    async remove(table, id) {
      db.delete(table).where(eq(idOf(table), id)).run();
    },
    async list(table, opts: ListOptions = {}) {
      const query = db.select().from(table);
      if (opts.where) query.where(opts.where);
      if (opts.orderBy) query.orderBy(opts.orderBy);
      if (opts.limit !== undefined) query.limit(opts.limit);
      if (opts.offset !== undefined) query.offset(opts.offset);
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
        // column already exists or other error — ignore for idempotency
      }
    },
    async close() {
      sqlite.close();
    },
  };
  /* eslint-enable require-await, no-non-null-assertion, no-unnecessary-type-assertion */
}
