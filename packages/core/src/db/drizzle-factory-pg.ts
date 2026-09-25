import type { SQL } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import { eq, getTableColumns } from "drizzle-orm";
import type { AdapterLifecycle } from "../adapters/metadata.ts";
import type { DatabaseAdapter, DrizzleAdapterOptions, ListOptions } from "./database.ts";
import { applyListOptions, buildLifecycle } from "./drizzle-factory.ts";

/** Chainable select surface of the Postgres Drizzle dialect (directly awaitable). */
interface DrizzlePgSelectChain extends Promise<unknown[]> {
  where(where: SQL): DrizzlePgSelectChain;
  orderBy(order: SQL): DrizzlePgSelectChain;
  limit(n: number): DrizzlePgSelectChain;
  offset(n: number): DrizzlePgSelectChain;
}

/**
 * Minimal Postgres Drizzle surface consumed by {@link createDrizzlePgAdapter}.
 * Drivers pass their dialect instance as `unknown`; the cast lives here, once.
 */
interface DrizzlePgLike {
  insert(table: Table): {
    values(values: unknown): { returning(): Promise<unknown[]> };
  };
  update(table: Table): {
    set(values: unknown): { where(where: SQL): { returning(): Promise<unknown[]> } };
  };
  select(): { from(table: Table): DrizzlePgSelectChain };
  delete(table: Table): { where(where: SQL): Promise<unknown> };
  $count(table: Table, where?: SQL): Promise<number>;
  execute<T>(query: SQL): Promise<T>;
}

function idColumn(table: Table): SQLWrapper {
  const id = getTableColumns(table)["id"];
  if (!id) {
    throw new Error("Table has no id column");
  }
  return id;
}

function firstRow(rows: unknown[], what: string): unknown {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`${what} returned no rows`);
  }
  return row;
}

async function insertOne<T extends Table>(
  drizzle: DrizzlePgLike,
  table: T,
  values: T["$inferInsert"],
): Promise<T["$inferSelect"]> {
  const rows = await drizzle.insert(table).values(values).returning();
  return firstRow(rows, "Insert") as T["$inferSelect"];
}

async function updateOne<T extends Table>(
  drizzle: DrizzlePgLike,
  table: T,
  id: string,
  values: Partial<T["$inferInsert"]>,
): Promise<T["$inferSelect"]> {
  const where = eq(idColumn(table), id);
  const rows = await drizzle.update(table).set(values).where(where).returning();
  return firstRow(rows, "Update") as T["$inferSelect"];
}

/**
 * Build a {@link DatabaseAdapter} over any Postgres-compatible Drizzle
 * dialect. Mirrors `createDrizzleAdapter` with Postgres terminal shapes
 * (chains await directly; `returning()` yields arrays).
 */
export function createDrizzlePgAdapter(
  db: unknown,
  options: DrizzleAdapterOptions,
): DatabaseAdapter {
  const drizzle = db as DrizzlePgLike;
  const lifecycle: AdapterLifecycle = buildLifecycle(options);
  return {
    metadata: options.metadata,
    tables: options.tables,
    lifecycle,
    insert: async <T extends Table>(
      table: T,
      values: T["$inferInsert"],
    ): Promise<T["$inferSelect"]> => await insertOne(drizzle, table, values),
    update: async <T extends Table>(
      table: T,
      id: string,
      values: Partial<T["$inferInsert"]>,
    ): Promise<T["$inferSelect"]> => await updateOne(drizzle, table, id, values),
    get: async <T extends Table>(table: T, id: string): Promise<T["$inferSelect"] | null> => {
      const where = eq(idColumn(table), id);
      const rows = (await drizzle
        .select()
        .from(table)
        .where(where)
        .limit(1)) as T["$inferSelect"][];
      return rows[0] ?? null;
    },
    remove: async (table: Table, id: string): Promise<void> => {
      const where = eq(idColumn(table), id);
      await drizzle.delete(table).where(where);
    },
    list: async <T extends Table>(
      table: T,
      opts: ListOptions = {},
    ): Promise<T["$inferSelect"][]> => {
      const rows: unknown = await applyListOptions(drizzle.select().from(table), opts);
      return rows as T["$inferSelect"][];
    },
    count: async (table: Table, where?: SQL): Promise<number> => await drizzle.$count(table, where),
    all: async <T>(query: SQL): Promise<T[]> => await drizzle.execute<T[]>(query),
  };
}
