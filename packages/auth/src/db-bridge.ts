import type { DatabaseAdapter, ListOptions, TxStore } from "@storyshelf/core/adapter/database";
import { ulid } from "@storyshelf/core/utils";
/**
 * Opaque Better Auth database bridge over the shelf DatabaseAdapter.
 *
 * Better Auth talks to `DBAdapterInstance` (create/findOne/findMany/count/
 * update/updateMany/delete/deleteMany/consumeOne/incrementOne/transaction);
 * this maps each call onto {@link DatabaseAdapter} CRUD over an explicit
 * model→table registry. No dialect knowledge: sqlite, Turso, and Postgres
 * drivers all work untouched, present and future.
 */
import type { DBAdapterInstance, DBTransactionAdapter, Where } from "better-auth";
import type { SQL, Table } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { applySelect, toDriverRow, toModelRow } from "./db-values.ts";
import { buildCondition, buildOrderBy } from "./db-where.ts";

/** Model→table registry plus per-model date fields. */
export interface AuthBridgeSchema {
  /** Drizzle table handles keyed by Better Auth model name. */
  tables: Record<string, Table>;
  /** Date-valued fields per model (ISO at rest, Date in flight). */
  dateFields: Record<string, readonly string[]>;
  /** Id generator for creates missing an id (defaults to ULID). */
  generateId?: (model: string) => string;
}

/** CRUD surface the bridge is built over (adapter or transaction store). */
type CrudStore = Pick<TxStore, "insert" | "update" | "get" | "remove" | "list" | "count">;

interface OpInput {
  model: string;
}

function tableFor(schema: AuthBridgeSchema, model: string): Table {
  const table = schema.tables[model];
  if (!table) {
    throw new Error(`Unknown auth model "${model}"`);
  }
  return table;
}

function datesFor(schema: AuthBridgeSchema, model: string): readonly string[] {
  return schema.dateFields[model] ?? [];
}

function defaultGenerateId(): string {
  return ulid();
}

function whereOf(table: Table, where: readonly Where[] | undefined): SQL | undefined {
  if (!where || where.length === 0) {
    return undefined;
  }
  return buildCondition(table, where);
}

async function findFirst(
  store: CrudStore,
  schema: AuthBridgeSchema,
  model: string,
  where: readonly Where[] | undefined,
): Promise<Record<string, unknown> | null> {
  const table = tableFor(schema, model);
  const rows = (await store.list(table, { where: whereOf(table, where), limit: 1 })) as Record<
    string,
    unknown
  >[];
  const row = rows[0];
  return row ? toModelRow(row, datesFor(schema, model)) : null;
}

async function updateById(
  store: CrudStore,
  schema: AuthBridgeSchema,
  model: string,
  id: string,
  update: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const table = tableFor(schema, model);
  const existing = await store.get(table, id);
  if (!existing) {
    return null;
  }
  const updated = await store.update(table, id, toDriverRow(update));
  return toModelRow(updated, datesFor(schema, model));
}

async function opCreate(
  store: CrudStore,
  schema: AuthBridgeSchema,
  input: OpInput & { data: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const table = tableFor(schema, input.model);
  const generate = schema.generateId ?? defaultGenerateId;
  const data =
    input.data["id"] === undefined || input.data["id"] === null
      ? { ...input.data, id: generate(input.model) }
      : input.data;
  const inserted = await store.insert(table, toDriverRow(data));
  return toModelRow(inserted, datesFor(schema, input.model));
}

async function opUpdate(
  store: CrudStore,
  schema: AuthBridgeSchema,
  input: OpInput & { where: Where[]; update: Record<string, unknown> },
): Promise<Record<string, unknown> | null> {
  const row = await findFirst(store, schema, input.model, input.where);
  if (!row || typeof row["id"] !== "string") {
    return null;
  }
  return await updateById(store, schema, input.model, row["id"], input.update);
}

async function opUpdateMany(
  store: CrudStore,
  schema: AuthBridgeSchema,
  input: OpInput & { where: Where[]; update: Record<string, unknown> },
): Promise<number> {
  const table = tableFor(schema, input.model);
  const rows = (await store.list(table, {
    where: whereOf(table, input.where),
  })) as Record<string, unknown>[];
  const ids = rows.map((row) => row["id"]).filter((id): id is string => typeof id === "string");
  await Promise.all(
    ids.map(async (id) => await updateById(store, schema, input.model, id, input.update)),
  );
  return ids.length;
}

async function opDeleteMany(
  store: CrudStore,
  schema: AuthBridgeSchema,
  input: OpInput & { where: Where[] },
): Promise<number> {
  const table = tableFor(schema, input.model);
  const rows = (await store.list(table, {
    where: whereOf(table, input.where),
  })) as Record<string, unknown>[];
  const ids = rows.map((row) => row["id"]).filter((id): id is string => typeof id === "string");
  await Promise.all(
    ids.map(async (id) => {
      await store.remove(table, id);
    }),
  );
  return ids.length;
}

async function opConsumeOne(
  store: CrudStore,
  schema: AuthBridgeSchema,
  input: OpInput & { where: Where[] },
): Promise<Record<string, unknown> | null> {
  // Runs directly on the given store: the top-level binding wraps this in
  // `transact` for atomicity, while transaction-scoped bindings pass the
  // ambient `tx` so Better Auth's own transaction wrapper never nests a
  // second `begin` on single-connection drivers (sqlite).
  const row = await findFirst(store, schema, input.model, input.where);
  if (!row || typeof row["id"] !== "string") {
    return null;
  }
  await store.remove(tableFor(schema, input.model), row["id"]);
  return row;
}

async function opIncrementOne(
  store: CrudStore,
  schema: AuthBridgeSchema,
  input: OpInput & {
    where: Where[];
    increment: Record<string, number>;
    set?: Record<string, unknown>;
  },
): Promise<Record<string, unknown> | null> {
  const row = await findFirst(store, schema, input.model, input.where);
  if (!row || typeof row["id"] !== "string") {
    return null;
  }
  const deltas = Object.fromEntries(
    Object.entries(input.increment).map(([field, delta]) => {
      const current = row[field];
      return [field, (typeof current === "number" ? current : 0) + delta];
    }),
  );
  return await updateById(store, schema, input.model, row["id"], {
    ...deltas,
    ...input.set,
  });
}

function hasColumn(table: Table, field: string): boolean {
  return getTableColumns(table)[field] !== undefined;
}

async function joinMany(
  store: CrudStore,
  schema: AuthBridgeSchema,
  parentModel: string,
  parentId: unknown,
  joinedModel: string,
  limit: number | undefined,
): Promise<Record<string, unknown>[]> {
  const table = tableFor(schema, joinedModel);
  const opts: ListOptions = { limit };
  const where = whereOf(table, [{ field: `${parentModel}Id`, value: parentId as never }]);
  if (where) {
    opts.where = where;
  }
  const rows = (await store.list(table, opts)) as Record<string, unknown>[];
  return rows.map((row) => toModelRow(row, datesFor(schema, joinedModel)));
}

async function joinRelation(
  store: CrudStore,
  schema: AuthBridgeSchema,
  parentModel: string,
  parent: Record<string, unknown>,
  joinedModel: string,
  limit: number | undefined,
): Promise<Record<string, unknown>[] | Record<string, unknown> | null> {
  const table = tableFor(schema, joinedModel);
  if (hasColumn(table, `${parentModel}Id`)) {
    return await joinMany(store, schema, parentModel, parent["id"], joinedModel, limit);
  }
  if (typeof parent[`${joinedModel}Id`] === "string") {
    return await findFirst(store, schema, joinedModel, [
      { field: "id", value: parent[`${joinedModel}Id`] as never },
    ]);
  }
  throw new Error(`Unknown auth relation "${parentModel}.${joinedModel}"`);
}

async function attachJoins(
  store: CrudStore,
  schema: AuthBridgeSchema,
  parentModel: string,
  parent: Record<string, unknown>,
  join: Record<string, boolean | { limit?: number }> | undefined,
): Promise<Record<string, unknown>> {
  if (!join) {
    return {};
  }
  const attached: Record<string, unknown> = {};
  const entries = Object.entries(join);
  await Promise.all(
    entries.map(async ([joinedModel, joinAttr]) => {
      const limit = typeof joinAttr === "object" ? joinAttr.limit : undefined;
      attached[joinedModel] = await joinRelation(
        store,
        schema,
        parentModel,
        parent,
        joinedModel,
        limit,
      );
    }),
  );
  return attached;
}

type FindManyInput = OpInput & {
  where?: Where[];
  limit?: number;
  offset?: number;
  sortBy?: { field: string; direction: "asc" | "desc" };
  select?: string[];
  join?: Record<string, boolean | { limit?: number }>;
};

async function listRows(
  store: CrudStore,
  schema: AuthBridgeSchema,
  input: FindManyInput,
): Promise<Record<string, unknown>[]> {
  const table = tableFor(schema, input.model);
  const opts: ListOptions = { limit: input.limit, offset: input.offset };
  const where = whereOf(table, input.where);
  if (where) {
    opts.where = where;
  }
  const orderBy = buildOrderBy(table, input.sortBy);
  if (orderBy) {
    opts.orderBy = orderBy;
  }
  const listed: Record<string, unknown>[] = await store.list(table, opts);
  return listed;
}

async function opFindMany(
  store: CrudStore,
  schema: AuthBridgeSchema,
  input: FindManyInput,
): Promise<Record<string, unknown>[]> {
  const rows = await listRows(store, schema, input);
  return await Promise.all(
    rows.map(async (row) => {
      const withJoins = input.join
        ? { ...row, ...(await attachJoins(store, schema, input.model, row, input.join)) }
        : row;
      return applySelect(toModelRow(withJoins, datesFor(schema, input.model)), input.select);
    }),
  );
}

/** One bound operation set (adapter top-level or transaction store). */
interface JoinSpec {
  join?: Record<string, boolean | { limit?: number }>;
}

interface BoundOps {
  create(input: OpInput & { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  findOne(
    input: OpInput & { where: Where[]; select?: string[] } & JoinSpec,
  ): Promise<Record<string, unknown> | null>;
  findMany(
    input: OpInput & {
      where?: Where[];
      limit?: number;
      offset?: number;
      sortBy?: { field: string; direction: "asc" | "desc" };
      select?: string[];
    } & JoinSpec,
  ): Promise<Record<string, unknown>[]>;
  count(input: OpInput & { where?: Where[] }): Promise<number>;
  update(
    input: OpInput & { where: Where[]; update: Record<string, unknown> },
  ): Promise<Record<string, unknown> | null>;
  updateMany(input: OpInput & { where: Where[]; update: Record<string, unknown> }): Promise<number>;
  delete(input: OpInput & { where: Where[] }): Promise<void>;
  deleteMany(input: OpInput & { where: Where[] }): Promise<number>;
  consumeOne(input: OpInput & { where: Where[] }): Promise<Record<string, unknown> | null>;
  incrementOne(
    input: OpInput & {
      where: Where[];
      increment: Record<string, number>;
      set?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown> | null>;
}

async function opFindOne(
  store: CrudStore,
  schema: AuthBridgeSchema,
  input: OpInput & { where: Where[]; select?: string[] } & JoinSpec,
): Promise<Record<string, unknown> | null> {
  const row = await findFirst(store, schema, input.model, input.where);
  if (!row) {
    return null;
  }
  const withJoins = input.join
    ? { ...row, ...(await attachJoins(store, schema, input.model, row, input.join)) }
    : row;
  return applySelect(withJoins, input.select);
}

/** Read operations bound to one store. */
function bindQueryOps(
  store: CrudStore,
  schema: AuthBridgeSchema,
): Pick<BoundOps, "findOne" | "findMany" | "count"> {
  return {
    findOne: async (
      input: OpInput & { where: Where[]; select?: string[] } & JoinSpec,
    ): Promise<Record<string, unknown> | null> => await opFindOne(store, schema, input),
    findMany: async (
      input: OpInput & {
        where?: Where[];
        limit?: number;
        offset?: number;
        sortBy?: { field: string; direction: "asc" | "desc" };
        select?: string[];
      } & JoinSpec,
    ): Promise<Record<string, unknown>[]> => await opFindMany(store, schema, input),
    count: async (input: OpInput & { where?: Where[] }): Promise<number> => {
      const table = tableFor(schema, input.model);
      return await store.count(table, whereOf(table, input.where));
    },
  };
}

/** Write operations bound to one store (transaction-aware where marked). */
function bindMutationOps(
  store: CrudStore,
  schema: AuthBridgeSchema,
  db: DatabaseAdapter,
): Omit<BoundOps, "findOne" | "findMany" | "count"> {
  return {
    create: async (
      input: OpInput & { data: Record<string, unknown> },
    ): Promise<Record<string, unknown>> => await opCreate(store, schema, input),
    update: async (
      input: OpInput & { where: Where[]; update: Record<string, unknown> },
    ): Promise<Record<string, unknown> | null> => await opUpdate(store, schema, input),
    updateMany: async (
      input: OpInput & { where: Where[]; update: Record<string, unknown> },
    ): Promise<number> => await opUpdateMany(store, schema, input),
    delete: async (input: OpInput & { where: Where[] }): Promise<void> => {
      const row = await findFirst(store, schema, input.model, input.where);
      if (row && typeof row["id"] === "string") {
        await store.remove(tableFor(schema, input.model), row["id"]);
      }
    },
    deleteMany: async (input: OpInput & { where: Where[] }): Promise<number> =>
      await opDeleteMany(store, schema, input),
    consumeOne: async (
      input: OpInput & { where: Where[] },
    ): Promise<Record<string, unknown> | null> => {
      // Atomic at the top level when the driver offers transact; inside a
      // Better Auth transaction `store` is the ambient `tx`, which must run
      // directly (a second `begin` fails on single-connection sqlite).
      if (store === db && db.transact) {
        return await db.transact(async (tx) => await opConsumeOne(tx, schema, input));
      }
      return await opConsumeOne(store, schema, input);
    },
    incrementOne: async (
      input: OpInput & {
        where: Where[];
        increment: Record<string, number>;
        set?: Record<string, unknown>;
      },
    ): Promise<Record<string, unknown> | null> => {
      if (store === db && db.transact) {
        return await db.transact(async (tx) => await opIncrementOne(tx, schema, input));
      }
      return await opIncrementOne(store, schema, input);
    },
  };
}

/** Build the Better Auth database adapter over a shelf database. */
export function createShelfDbBridge(
  db: DatabaseAdapter,
  schema: AuthBridgeSchema,
): DBAdapterInstance {
  return (_options: unknown) => {
    const ops: BoundOps = { ...bindQueryOps(db, schema), ...bindMutationOps(db, schema, db) };
    return {
      ...ops,
      transaction: async <R>(callback: (trx: DBTransactionAdapter) => Promise<R>): Promise<R> => {
        if (db.transact) {
          return await db.transact(async (tx) => {
            const txOps: BoundOps = {
              ...bindQueryOps(tx, schema),
              ...bindMutationOps(tx, schema, db),
            };
            return await callback(txOps as never);
          });
        }
        return await callback(ops as never);
      },
      options: { adapterName: "storyshelf", supportsDates: false, supportsJSON: false },
    } as never;
  };
}
