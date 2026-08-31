import { getTableColumns, type SQL } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";

import type { DatabaseAdapter, ListOptions } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";

/** Storage and database doubles used by the capture pipeline tests. */
export interface FakeStorage {
  storage: StorageAdapter;
  objects: Map<string, Buffer>;
}

export function makeStorage(): FakeStorage {
  const objects = new Map<string, Buffer>();
  const storage: StorageAdapter = {
    read: async (path) => {
      const found = objects.get(path);
      if (found === undefined) {
        throw new Error(`no object at "${path}"`);
      }
      return await Promise.resolve(found);
    },
    write: async (path, data) => {
      objects.set(path, Buffer.from(data));
      await Promise.resolve();
    },
    delete: async (path) => {
      objects.delete(path);
      await Promise.resolve();
    },
    exists: async (path) => await Promise.resolve(objects.has(path)),
    list: async (prefix) =>
      await Promise.resolve([...objects.keys()].filter((key) => key.startsWith(prefix)).toSorted()),
  };
  return { storage, objects };
}

interface SqlChunk {
  value?: unknown;
  name?: string;
  table?: unknown;
  brand?: unknown;
  queryChunks?: SqlChunk[];
}

/** Flatten the string parts of a drizzle SQL chunk into a single string. */
function textOf(chunk: SqlChunk | undefined): string | undefined {
  if (chunk === undefined || !Array.isArray(chunk.value) || !chunk.value.every((part) => typeof part === "string")) {
    return undefined;
  }
  return chunk.value.join("");
}

function withoutUndefined(values: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values as Record<string, unknown>).filter((pair) => pair[1] !== undefined));
}

// The in-memory fake back-fills Drizzle's inferred row types from raw maps
// Without a driver, so the casts and await-free `async` methods are unavoidable.
/* eslint-disable require-await, no-unnecessary-type-assertion, no-unnecessary-type-parameters, non-nullable-type-assertion-style */
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

  const getRow = async <T extends AnySQLiteTable>(table: T, id: string): Promise<T["$inferSelect"] | null> => {
    const found = rowsOf(table).get(id);
    if (found === undefined) {
      return null;
    }
    return found as T["$inferSelect"];
  };

  const listRows = async <T extends AnySQLiteTable>(table: T, opts: ListOptions = {}): Promise<T["$inferSelect"][]> => {
    let current = [...rowsOf(table).values()];
    if (opts.where) {
      const where = opts.where;
      current = current.filter((row) => whereMatches(where, row as Record<string, unknown>, table));
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
    migrate: async () => {
      await Promise.resolve();
    },
    close: async () => {
      await Promise.resolve();
    },
  };
  return { db };
}

function whereMatches(where: SQL, row: Record<string, unknown>, table: AnySQLiteTable): boolean {
  let current = where.queryChunks as unknown as SqlChunk[];
  let wrapped = current[1]?.queryChunks;
  while (wrapped !== undefined && textOf(current[0]) === "(" && textOf(current.at(-1)) === ")") {
    current = wrapped;
    wrapped = current[1]?.queryChunks;
  }
  if (current.some((chunk) => textOf(chunk)?.trim() === "and")) {
    return current
      .filter((chunk) => textOf(chunk) === undefined)
      .every((chunk) => matchChunk(chunk.queryChunks ?? [], row, table));
  }
  return matchChunk(current, row, table);
}

function matchChunk(chunks: SqlChunk[], row: Record<string, unknown>, table: AnySQLiteTable): boolean {
  const text = chunks.map((c) => textOf(c) ?? "").join("");
  if (text.includes(" in ")) {
    return inArrayMatches(chunks, row, table);
  }
  if (text.includes(" < ")) {
    return ltMatches(chunks, row, table);
  }
  return eqMatches(chunks, row, table);
}

function eqMatches(chunks: SqlChunk[], row: Record<string, unknown>, table: AnySQLiteTable): boolean {
  let columnName: string | undefined;
  let argument: unknown;
  for (const chunk of chunks) {
    if (typeof chunk.name === "string" && chunk.table !== undefined) {
      columnName = chunk.name;
    } else if ("brand" in chunk) {
      argument = chunk.value;
    }
  }
  if (columnName === undefined) {
    return false;
  }
  return row[columnKey(table, columnName)] === argument;
}

/* eslint-disable complexity, max-depth -- handles drizzle's varied chunk shapes */
function inArrayMatches(chunks: SqlChunk[], row: Record<string, unknown>, table: AnySQLiteTable): boolean {
  let columnName: string | undefined;
  const values: unknown[] = [];
  const collect = (nodes: unknown[]): void => {
    for (const raw of nodes as SqlChunk[]) {
      const chunk = raw as SqlChunk & Record<string, unknown>;
      // handle array-like chunk (inArray values stored as array of chunks)
      if (Array.isArray(chunk) || (chunk && typeof chunk === "object" && Object.keys(chunk).every((k) => /^\d+$/u.test(k)))) {
        collect(Object.values(chunk as unknown as Record<string, unknown>) as unknown[]);
        continue;
      }
      if (typeof chunk.name === "string" && chunk.table !== undefined) {
        columnName = chunk.name as string;
      }
      if ("brand" in chunk && (chunk as Record<string, unknown>)["value"] !== undefined) {
        const val = (chunk as Record<string, unknown>)["value"];
        if (Array.isArray(val)) {
          values.push(...(val as unknown[]));
        } else {
          values.push(val);
        }
      }
      if (chunk.queryChunks) {
        collect(chunk.queryChunks as unknown[]);
      }
      const val = (chunk as Record<string, unknown>)["value"];
      if (Array.isArray(val)) {
        for (const item of val as unknown[]) {
          if (item && typeof item === "object" && "queryChunks" in (item as Record<string, unknown>)) {
            collect(((item as Record<string, unknown>)["queryChunks"] as unknown[]) ?? []);
          }
          if (item && typeof item === "object" && "value" in (item as Record<string, unknown>)) {
            const iv = (item as Record<string, unknown>)["value"];
            if (iv !== undefined) values.push(iv);
          }
          if (typeof item === "string") values.push(item);
        }
      }
    }
  };
  collect(chunks as unknown[]);
  if (columnName === undefined) {
    return false;
  }
  const key = columnKey(table, columnName);
  return values.includes(row[key]);
}
/* eslint-enable complexity, max-depth */

function ltMatches(chunks: SqlChunk[], row: Record<string, unknown>, table: AnySQLiteTable): boolean {
  let columnName: string | undefined;
  let argument: unknown;
  for (const chunk of chunks) {
    if (typeof chunk.name === "string" && chunk.table !== undefined) {
      columnName = chunk.name;
    } else if ("brand" in chunk) {
      argument = chunk.value;
    }
  }
  if (columnName === undefined) {
    return false;
  }
  const key = columnKey(table, columnName);
  const cell = row[key];
  if (typeof cell === "string" && typeof argument === "string") {
    return cell < argument;
  }
  if (typeof cell === "number" && typeof argument === "number") {
    return cell < argument;
  }
  return String(cell) < String(argument);
}

function columnKey(table: AnySQLiteTable, dbName: string): string {
  for (const [property, column] of Object.entries(getTableColumns(table))) {
    if (column.name === dbName) {
      return property;
    }
  }
  return dbName;
}
/* eslint-enable require-await, no-unnecessary-type-assertion, no-unnecessary-type-parameters, non-nullable-type-assertion-style */