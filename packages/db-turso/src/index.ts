import { createClient } from "@libsql/client";
import { eq, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { AnySQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";

import type { DatabaseAdapter, ListOptions } from "@storyshelf/core/adapter/database";
import { schema } from "@storyshelf/core/schema";
import { DDL } from "@storyshelf/core/ddl";

function idOf(table: AnySQLiteTable): SQLiteColumn {
  // eslint-disable-next-line no-non-null-assertion -- every table has an `id` column
  return getTableColumns(table)["id"]!;
}

/**
 * Create a Turso/libSQL-backed DatabaseAdapter using Drizzle ORM.
 *
 * @param options - Connection options: the database `url` and an optional `authToken`.
 * @returns A DatabaseAdapter backed by the Turso database.
 */
export function createTursoDatabase(options: { url: string; authToken?: string }): DatabaseAdapter {
  const client = createClient({ url: options.url, authToken: options.authToken });
  const db = drizzle(client, { schema });

  return {
    async insert(table, values) {
      return await db.insert(table).values(values).returning().get();
    },
    async update(table, id, values) {
      return await db.update(table).set(values).where(eq(idOf(table), id)).returning().get();
    },
    async get(table, id) {
      return (await db.select().from(table).where(eq(idOf(table), id)).limit(1).get()) ?? null;
    },
    async remove(table, id) {
      await db.delete(table).where(eq(idOf(table), id)).run();
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
      return await query.all();
    },
    async count(table, where) {
      return await db.$count(table, where);
    },
    async all(query) {
      return await db.all(query);
    },
    async migrate() {
      await client.executeMultiple(DDL);
    },
    // eslint-disable-next-line require-await -- client.close() is synchronous
    async close() {
      client.close();
    },
  };
}
