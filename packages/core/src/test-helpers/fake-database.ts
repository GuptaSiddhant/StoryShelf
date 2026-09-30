import type { SQL, Table } from "drizzle-orm";
import type { DatabaseAdapter, ListOptions, TxStore } from "../adapters/database.ts";
import { fakeSchema } from "./fake-tables.ts";
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
  const store = new Map<Table, Map<string, unknown>>();

  const rowsOf = (table: Table): Map<string, unknown> => {
    let rowMap = store.get(table);
    if (!rowMap) {
      rowMap = new Map();
      store.set(table, rowMap);
    }
    return rowMap;
  };

  const insertRow = async <T extends Table>(
    table: T,
    values: T["$inferInsert"],
  ): Promise<T["$inferSelect"]> => {
    const row = withoutUndefined(values);
    const key = (row["id"] ?? row["hash"]) as string;
    rowsOf(table).set(key, row);
    return row as T["$inferSelect"];
  };

  const updateRow = async <T extends Table>(
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

  const getRow = async <T extends Table>(
    table: T,
    id: string,
  ): Promise<T["$inferSelect"] | null> => {
    const found = rowsOf(table).get(id);
    if (found === undefined) {
      return null;
    }
    return found as T["$inferSelect"];
  };

  const listRows = async <T extends Table>(
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

  const countRows = async (table: Table, where?: SQL): Promise<number> => {
    const matching = await listRows(table, where ? { where } : {});
    return matching.length;
  };

  const transactRows = async <R>(fn: (tx: TxStore) => Promise<R>): Promise<R> => {
    const snapshot = new Map<Table, Map<string, unknown>>();
    for (const [table, rows] of store) {
      snapshot.set(
        table,
        new Map([...rows].map(([id, row]) => [id, { ...(row as Record<string, unknown>) }])),
      );
    }
    const tx: TxStore = {
      insert: insertRow,
      update: updateRow,
      get: getRow,
      remove: async (table, id) => {
        rowsOf(table).delete(id);
      },
      list: listRows,
      count: countRows,
    };
    try {
      return await fn(tx);
    } catch (error) {
      store.clear();
      for (const [table, rows] of snapshot) {
        store.set(table, rows);
      }
      throw error;
    }
  };

  const db: DatabaseAdapter = {
    metadata: { name: "Fake Database", version: "0.0.0", kind: "memory", category: "database" },
    tables: fakeSchema,
    insert: insertRow,
    update: updateRow,
    get: getRow,
    remove: async (table, id) => {
      rowsOf(table).delete(id);
    },
    list: listRows,
    count: countRows,
    transact: transactRows,
    all: async (_query: SQL) => {
      const results: Record<string, unknown>[] = [];
      for (const rows of store.values()) {
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
