/**
 * Database adapter interface: query builders over explicitly typed tables.
 *
 * The primary export is {@link DatabaseAdapter}; driver machinery
 * (`createDrizzleAdapter`) lives in `drizzle-factory.ts` and is
 * re-exported here so `core/adapter/database` stays the single import.
 */
import type { SQL } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type { Adapter, AdapterMetadata } from "../adapters/metadata.ts";
import type { Tables } from "./tables.ts";

export type { Tables };

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

/** Database abstraction over Drizzle tables, agnostic of dialect and driver. */
export interface DatabaseAdapter extends Adapter<{ readonly category: "database" }> {
  /** Table handles for this adapter's dialect, enforced with type safety. */
  readonly tables: Tables;
  /** Insert a row and return the inserted record. */
  insert<T extends Table>(table: T, values: T["$inferInsert"]): Promise<T["$inferSelect"]>;
  /** Update a row by id and return the updated record. */
  update<T extends Table>(
    table: T,
    id: string,
    values: Partial<T["$inferInsert"]>,
  ): Promise<T["$inferSelect"]>;
  /** Fetch a single row by id, or null if not found. */
  get<T extends Table>(table: T, id: string): Promise<T["$inferSelect"] | null>;
  /** Delete a row by id. */
  remove(table: Table, id: string): Promise<void>;
  /** List rows matching the given options. */
  list<T extends Table>(table: T, opts?: ListOptions): Promise<T["$inferSelect"][]>;
  /** Count rows matching an optional where condition. */
  count(table: Table, where?: SQL): Promise<number>;
  /** Run an arbitrary SQL query and return typed rows. */
  all<T>(query: SQL): Promise<T[]>;
}

/** Driver-supplied identity plus lifecycle hooks. */
export interface DrizzleAdapterOptions {
  metadata: AdapterMetadata & { readonly category: "database" };
  tables: Tables;
  migrate: () => Promise<void> | void;
  close: () => Promise<void> | void;
  /** Cheap liveness probe (e.g. `SELECT 1`); omitted when the driver has none. */
  ping?: () => Promise<void> | void;
}

/**
 * Create a {@link DatabaseAdapter} from a Drizzle instance for Postgres.
 */
export { createDrizzlePgAdapter } from "./drizzle-factory-pg.ts";
