import type { SQL } from "drizzle-orm";
import { eq, getTableColumns } from "drizzle-orm";
import type { AnySQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { AdapterLifecycle } from "../adapters/metadata.ts";
import type { DatabaseAdapter, DrizzleAdapterOptions, ListOptions } from "./database.ts";

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

function idOf(table: AnySQLiteTable): SQLiteColumn {
  const id = getTableColumns(table)["id"];
  if (!id) {
    throw new Error("Table has no id column");
  }
  return id;
}

/** Chainable filter surface shared by dialect select chains. */
export interface ChainFilter<C> {
  where(where: SQL): C;
  orderBy(order: SQL): C;
  limit(n: number): C;
  offset(n: number): C;
}

export function applyListOptions<C extends ChainFilter<C>>(query: C, opts: ListOptions): C {
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
 * Build the database lifecycle: migrations run in `init`, the connection
 * closes in `close`. Close tolerates repeated calls (drivers may not).
 */
export function buildLifecycle(options: DrizzleAdapterOptions): AdapterLifecycle {
  let closed = false;
  return {
    init: async () => {
      await options.migrate();
    },
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await options.close();
    },
  };
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
    lifecycle: buildLifecycle(options),
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
      ((await drizzle
        .select()
        .from(table)
        .where(eq(idOf(table), id))
        .limit(1)
        .get()) as T["$inferSelect"] | undefined) ?? null,
    remove: async (table: AnySQLiteTable, id: string): Promise<void> => {
      await drizzle
        .delete(table)
        .where(eq(idOf(table), id))
        .run();
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
  };
}
