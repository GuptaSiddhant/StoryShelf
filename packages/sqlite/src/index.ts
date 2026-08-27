import Database from "better-sqlite3";
import { eq, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";

import type { DatabaseAdapter, ListOptions } from "@storyshelf/core/adapter/database";
import { schema } from "@storyshelf/core/schema";

import { DDL } from "./ddl.ts";

function idOf(table: AnySQLiteTable) {
  return getTableColumns(table)["id"]!;
}

export function createSqliteDatabase(path: string): DatabaseAdapter {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });

  return {
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
    },
    async close() {
      sqlite.close();
    },
  };
}
