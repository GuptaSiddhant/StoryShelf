/**
 * Database adapter interface: query builders over explicitly typed tables.
 */
import type { SQL } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { AdapterMetadata } from "./metadata.ts";

/** Options that narrow and page a list query. */
export interface ListOptions {
  /** SQL WHERE condition. */
  where?: SQL;
  /** SQL ORDER BY condition. */
  orderBy?: SQL;
  /** Maximum number of rows to return. */
  limit?: number;
  /** Number of rows to skip. */
  offset?: number;
}

/** Database abstraction over Drizzle tables, agnostic of the underlying driver. */
export interface DatabaseAdapter {
  /** Adapter identity. */
  readonly metadata?: AdapterMetadata;
  /** Insert a row and return the inserted record. */
  insert<T extends AnySQLiteTable>(table: T, values: T["$inferInsert"]): Promise<T["$inferSelect"]>;
  /** Update a row by id and return the updated record. */
  update<T extends AnySQLiteTable>(
    table: T,
    id: string,
    values: Partial<T["$inferInsert"]>,
  ): Promise<T["$inferSelect"]>;
  /** Fetch a single row by id, or null if not found. */
  get<T extends AnySQLiteTable>(table: T, id: string): Promise<T["$inferSelect"] | null>;
  /** Delete a row by id. */
  remove(table: AnySQLiteTable, id: string): Promise<void>;
  /** List rows matching the given options. */
  list<T extends AnySQLiteTable>(table: T, opts?: ListOptions): Promise<T["$inferSelect"][]>;
  /** Count rows matching an optional where condition. */
  count(table: AnySQLiteTable, where?: SQL): Promise<number>;
  /** Run an arbitrary SQL query and return typed rows. */
  all<T>(query: SQL): Promise<T[]>;
  /** Apply any pending schema migrations. */
  migrate(): Promise<void>;
  /** Close the underlying database connection. */
  close(): Promise<void>;
}
