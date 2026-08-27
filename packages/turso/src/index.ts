import { createClient } from "@libsql/client";
import { eq, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";

import type { DatabaseAdapter, ListOptions } from "@storyshelf/core/adapter/database";
import { schema } from "@storyshelf/core/schema";

import { DDL } from "./ddl.ts";

function idOf(table: AnySQLiteTable) {
  return getTableColumns(table)["id"]!;
}

export function createTursoDatabase(options: { url: string; authToken?: string }): DatabaseAdapter {
  const client = createClient({ url: options.url, authToken: options.authToken });
  const db = drizzle(client, { schema });

  return {
    async insert(table, values) {
      return (await db.insert(table).values(values).returning().get())!;
    },
    async update(table, id, values) {
      return (await db.update(table).set(values).where(eq(idOf(table), id)).returning().get())!;
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
      return query.all();
    },
    async count(table, where) {
      return db.$count(table, where);
    },
    async all(query) {
      return db.all(query);
    },
    async migrate() {
      await client.executeMultiple(DDL);
    },
    async close() {
      client.close();
    },
  };
}
