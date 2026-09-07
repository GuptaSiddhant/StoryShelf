import type { SQL } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { DatabaseAdapter, ListOptions } from "../adapters/database.ts";
import { orderRows, whereMatches } from "./sql-chunks.ts";

function withoutUndefined(values: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values as Record<string, unknown>).filter((pair) => pair[1] !== undefined),
  );
}

// The in-memory fake back-fills Drizzle's inferred row types from raw maps
// Without a driver, so the casts and await-free `async` methods are unavoidable.
/* eslint-disable require-await, no-unnecessary-type-assertion, no-unnecessary-type-parameters, non-nullable-type-assertion-style */
/** Create an in-memory database adapter for capture pipeline tests. */
export function makeDatabase(): { db: DatabaseAdapter } {
  const tables = new Map<AnySQLiteTable, Map<string, unknown>>();

  const rowsOf = (table: AnySQLiteTable): Map<string, unknown> => {
    let rowMap = tables.get(table);
    if (!rowMap) {
      rowMap = new Map();
      tables.set(table, rowMap);
    }
    return rowMap;
  };

  const insertRow = async <T extends AnySQLiteTable>(
    table: T,
    values: T["$inferInsert"],
  ): Promise<T["$inferSelect"]> => {
    const row = withoutUndefined(values);
    rowsOf(table).set(String(row["id"]), row);
    return row as T["$inferSelect"];
  };

  const updateRow = async <T extends AnySQLiteTable>(
    table: T,
    id: string,
    values: Partial<T["$inferInsert"]>,
  ): Promise<T["$inferSelect"]> => {
    const current = rowsOf(table).get(id) as Record<string, unknown> | undefined;
    if (current === undefined) {
      throw new Error("row not found");
    }
    const merged = withoutUndefined({ ...current, ...values });
    rowsOf(table).set(id, merged);
    return merged as T["$inferSelect"];
  };

  const getRow = async <T extends AnySQLiteTable>(
    table: T,
    id: string,
  ): Promise<T["$inferSelect"] | null> => {
    const found = rowsOf(table).get(id);
    if (found === undefined) {
      return null;
    }
    return found as T["$inferSelect"];
  };

  const listRows = async <T extends AnySQLiteTable>(
    table: T,
    opts: ListOptions = {},
  ): Promise<T["$inferSelect"][]> => {
    let current = [...rowsOf(table).values()];
    if (opts.where) {
      const { where } = opts;
      current = current.filter((row) => whereMatches(where, row as Record<string, unknown>, table));
    }
    if (opts.orderBy) {
      current = orderRows(current, opts.orderBy, table);
    }
    if (opts.limit !== undefined) {
      current = current.slice(0, opts.limit);
    }
    return current as T["$inferSelect"][];
  };

  const countRows = async (table: AnySQLiteTable, where?: SQL): Promise<number> => {
    const matching = await listRows(table, where ? { where } : {});
    return matching.length;
  };

  const db: DatabaseAdapter = {
    metadata: { name: "Fake Database", version: "0.0.0", kind: "memory", category: "database" },
    insert: insertRow,
    update: updateRow,
    get: getRow,
    remove: async (table, id) => {
      rowsOf(table).delete(id);
    },
    list: listRows,
    count: countRows,
    all: async (_query: SQL) => {
      // For raw SQL queries, collect all rows across all tables.
      // The caller is responsible for filtering/parsing the results.
      const results: Record<string, unknown>[] = [];
      for (const rows of tables.values()) {
        for (const row of rows.values()) {
          results.push(row as Record<string, unknown>);
        }
      }
      return results as never[];
    },
  };
  return { db };
}
/* eslint-enable require-await, no-unnecessary-type-assertion, no-unnecessary-type-parameters, non-nullable-type-assertion-style */
