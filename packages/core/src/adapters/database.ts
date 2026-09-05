/**
 * Database adapter interface: query builders over explicitly typed tables.
 */
import type { SQL } from "drizzle-orm";
import { eq, getTableColumns } from "drizzle-orm";
import type { AnySQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";
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

/** A value or a promise of one (sync node:sqlite vs async libSQL drivers). */
type MaybePromise<T> = T | Promise<T>;

/** Chainable select surface shared by the sync and async Drizzle dialects. */
interface DrizzleSelectChain {
  where(where: SQL): DrizzleSelectChain;
  orderBy(order: SQL): DrizzleSelectChain;
  limit(n: number): DrizzleSelectChain;
  offset(n: number): DrizzleSelectChain;
  get(): MaybePromise<unknown>;
  all(): MaybePromise<unknown[]>;
}

/**
 * Minimal Drizzle surface consumed by {@link createDrizzleAdapter}. Drivers
 * pass their dialect instance as `unknown`; the cast lives here, once, so
 * driver packages stay fully typed. Covered by the adapter contract tests.
 */
interface DrizzleLike {
  insert(table: AnySQLiteTable): {
    values(values: unknown): { returning(): { get(): MaybePromise<unknown> } };
  };
  update(table: AnySQLiteTable): {
    set(values: unknown): { where(where: SQL): { returning(): { get(): MaybePromise<unknown> } } };
  };
  select(): { from(table: AnySQLiteTable): DrizzleSelectChain };
  delete(table: AnySQLiteTable): { where(where: SQL): { run(): MaybePromise<unknown> } };
  $count(table: AnySQLiteTable, where?: SQL): MaybePromise<number>;
  all<T>(query: SQL): MaybePromise<T[]>;
}

/** Driver-supplied identity plus lifecycle hooks. */
export interface DrizzleAdapterOptions {
  metadata: AdapterMetadata;
  migrate: () => Promise<void> | void;
  close: () => Promise<void> | void;
}

function idOf(table: AnySQLiteTable): SQLiteColumn {
  const id = getTableColumns(table)["id"];
  if (!id) {
    throw new Error("Table has no id column");
  }
  return id;
}

function applyListOptions(query: DrizzleSelectChain, opts: ListOptions): DrizzleSelectChain {
  let current = query;
  if (opts.where) {
    current = current.where(opts.where);
  }
  if (opts.orderBy) {
    current = current.orderBy(opts.orderBy);
  }
  if (opts.limit !== undefined) {
    current = current.limit(opts.limit);
  }
  if (opts.offset !== undefined) {
    current = current.offset(opts.offset);
  }
  return current;
}

/**
 * Build a {@link DatabaseAdapter} over any SQLite-compatible Drizzle
 * dialect. Sync results (node:sqlite) and promises (libSQL) are both
 * awaited, so drivers only supply connection setup, metadata, and the
 * driver-specific migrate/close.
 */
export function createDrizzleAdapter(db: unknown, options: DrizzleAdapterOptions): DatabaseAdapter {
  const drizzle = db as DrizzleLike;
  return {
    metadata: options.metadata,
    insert: async <T extends AnySQLiteTable>(
      table: T,
      values: T["$inferInsert"],
    ): Promise<T["$inferSelect"]> =>
      (await drizzle.insert(table).values(values).returning().get()) as T["$inferSelect"],
    update: async <T extends AnySQLiteTable>(
      table: T,
      id: string,
      values: Partial<T["$inferInsert"]>,
    ): Promise<T["$inferSelect"]> =>
      (await drizzle
        .update(table)
        .set(values)
        .where(eq(idOf(table), id))
        .returning()
        .get()) as T["$inferSelect"],
    get: async <T extends AnySQLiteTable>(
      table: T,
      id: string,
    ): Promise<T["$inferSelect"] | null> =>
      ((await drizzle.select().from(table).where(eq(idOf(table), id)).limit(1).get()) as
        | T["$inferSelect"]
        | undefined) ?? null,
    remove: async (table: AnySQLiteTable, id: string): Promise<void> => {
      await drizzle.delete(table).where(eq(idOf(table), id)).run();
    },
    list: async <T extends AnySQLiteTable>(
      table: T,
      opts: ListOptions = {},
    ): Promise<T["$inferSelect"][]> => {
      const query = applyListOptions(drizzle.select().from(table), opts);
      const rows: unknown = await query.all();
      return rows as T["$inferSelect"][];
    },
    count: async (table: AnySQLiteTable, where?: SQL): Promise<number> =>
      await drizzle.$count(table, where),
    all: async <T>(query: SQL): Promise<T[]> => await drizzle.all(query),
    migrate: async () => {
      await options.migrate();
    },
    close: async () => {
      await options.close();
    },
  };
}
