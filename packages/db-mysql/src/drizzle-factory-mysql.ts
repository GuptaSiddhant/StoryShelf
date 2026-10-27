import type {
  DatabaseAdapter,
  DrizzleAdapterOptions,
  ListOptions,
  TxStore,
} from "@storyshelf/core/adapter/database";
import type { AdapterLifecycle } from "@storyshelf/core/adapter/metadata";
import type { SQL } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import { and, eq, getTableColumns } from "drizzle-orm";
import { applyListOptions, buildLifecycle } from "./drizzle-factory.ts";

/** Chainable select surface of the MySQL Drizzle dialect (directly awaitable). */
interface DrizzleMySqlSelectChain extends Promise<unknown[]> {
  where(where: SQL): DrizzleMySqlSelectChain;
  orderBy(order: SQL): DrizzleMySqlSelectChain;
  limit(n: number): DrizzleMySqlSelectChain;
  offset(n: number): DrizzleMySqlSelectChain;
}

/**
 * Minimal MySQL Drizzle surface consumed by {@link createDrizzleMySqlAdapter}.
 * Drivers pass their dialect instance as `unknown`; the cast lives here, once.
 */
interface DrizzleMySqlLike {
  insert(table: Table): {
    values(values: unknown): { returning(): Promise<unknown[]> };
  };
  update(table: Table): {
    set(values: unknown): { where(where: SQL): { returning(): Promise<unknown[]> } };
  };
  select(): { from(table: Table): DrizzleMySqlSelectChain };
  delete(table: Table): { where(where: SQL): Promise<unknown> };
  $count(table: Table, where?: SQL): Promise<number>;
  execute<T>(query: SQL): Promise<T>;
  transaction<R>(fn: (tx: unknown) => Promise<R>): Promise<R>;
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

async function updateWhereOne<T extends Table>(
  drizzle: DrizzleMySqlLike,
  table: T,
  id: string,
  values: Partial<T["$inferInsert"]>,
  where: SQL,
): Promise<T["$inferSelect"] | null> {
  // MySQL has no UPDATE RETURNING. The condition is evaluated by the UPDATE;
  // reading afterwards may observe a newer state, but cannot undo cancellation.
  // oxlint-disable-next-line typescript/await-thenable -- MySQL updates are thenable via drizzle
  await drizzle
    .update(table)
    .set(values)
    .where(and(eq(idColumn(table), id), where) ?? where);
  const current = (await drizzle
    .select()
    .from(table)
    .where(eq(idColumn(table), id))
    .limit(1)) as T["$inferSelect"][];
  return current[0] ?? null;
}

async function insertOne<T extends Table>(
  drizzle: DrizzleMySqlLike,
  table: T,
  values: T["$inferInsert"],
): Promise<T["$inferSelect"]> {
  try {
    const rows = await drizzle.insert(table).values(values).returning();
    return firstRow(rows, "Insert") as T["$inferSelect"];
  } catch {
    // oxlint-disable-next-line typescript/await-thenable -- MySQL insert is thenable via drizzle
    await drizzle.insert(table).values(values);
    const id = (values as Record<string, unknown>)["id"] as string;
    const where = eq(idColumn(table), id);
    const rows = (await drizzle.select().from(table).where(where).limit(1)) as T["$inferSelect"][];
    return firstRow(rows, "Insert") as T["$inferSelect"];
  }
}

async function updateOne<T extends Table>(
  drizzle: DrizzleMySqlLike,
  table: T,
  id: string,
  values: Partial<T["$inferInsert"]>,
): Promise<T["$inferSelect"]> {
  const where = eq(idColumn(table), id);
  try {
    const rows = await drizzle.update(table).set(values).where(where).returning();
    return firstRow(rows, "Update") as T["$inferSelect"];
  } catch {
    // oxlint-disable-next-line typescript/await-thenable -- MySQL update is thenable via drizzle
    await drizzle.update(table).set(values).where(where);
    const rows = (await drizzle.select().from(table).where(where).limit(1)) as T["$inferSelect"][];
    return firstRow(rows, "Update") as T["$inferSelect"];
  }
}

/** mysql2 resolves `execute` to `[rows, fields]`; adapters expose just the rows. */
async function allRows<T>(drizzle: DrizzleMySqlLike, query: SQL): Promise<T[]> {
  const result: unknown = await drizzle.execute(query);
  if (Array.isArray(result) && Array.isArray(result[0]) && result.length === 2) {
    return result[0] as T[];
  }
  return result as T[];
}

/**
 * Build a {@link DatabaseAdapter} over any Postgres-compatible Drizzle
 * dialect. Mirrors `createDrizzleAdapter` with Postgres terminal shapes
 * (chains await directly; `returning()` yields arrays).
 */
export function createDrizzleMySqlAdapter(
  db: unknown,
  options: DrizzleAdapterOptions,
): DatabaseAdapter {
  const drizzle = db as DrizzleMySqlLike;
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
    updateWhere: async <T extends Table>(
      table: T,
      id: string,
      values: Partial<T["$inferInsert"]>,
      where: SQL,
    ): Promise<T["$inferSelect"] | null> => await updateWhereOne(drizzle, table, id, values, where),
    get: async <T extends Table>(table: T, id: string): Promise<T["$inferSelect"] | null> =>
      await getOne(drizzle, table, id),
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
    all: async <T>(query: SQL): Promise<T[]> => await allRows<T>(drizzle, query),
    transact: async <R>(fn: (tx: TxStore) => Promise<R>): Promise<R> =>
      await drizzle.transaction(async (tx) => await fn(buildTxStore(tx as DrizzleMySqlLike))),
  };
}

/** CRUD subset bound to a Postgres transaction handle. */
function buildTxStore(drizzle: DrizzleMySqlLike): TxStore {
  return {
    insert: async (table, values) => await insertOne(drizzle, table, values as never),
    update: async (table, id, values) => await updateOne(drizzle, table, id, values as never),
    get: async (table, id) => await getOne(drizzle, table, id),
    remove: async (table, id) => {
      const where = eq(idColumn(table), id);
      await drizzle.delete(table).where(where);
    },
    list: async (table, opts: ListOptions = {}) => {
      const rows: unknown = await applyListOptions(drizzle.select().from(table), opts);
      return rows as never[];
    },
    count: async (table, where) => await drizzle.$count(table, where),
  };
}

async function getOne<T extends Table>(
  drizzle: DrizzleMySqlLike,
  table: T,
  id: string,
): Promise<T["$inferSelect"] | null> {
  const where = eq(idColumn(table), id);
  const rows = (await drizzle.select().from(table).where(where).limit(1)) as T["$inferSelect"][];
  return rows[0] ?? null;
}
