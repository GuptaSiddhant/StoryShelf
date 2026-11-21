/**
 * MySQL table factory (ADR 0041 decision 2; spike #800): builds a Drizzle `mysqlTable` from a
 * neutral table. Not used by the adapter yet; `schema/` and `ddl.ts` stay authoritative.
 */
import { neutralSchema as ns } from "@storyshelf/core/test-helpers";
import type { BuildColumns } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  int,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
  type MySqlTableWithColumns,
  type MySqlTextBuilder,
} from "drizzle-orm/mysql-core";
import { datetime } from "./schema/datetime.ts";

type Base = MySqlTextBuilder<[string, ...string[]]>;

/** The Drizzle table a neutral table builds; its `$inferSelect` is `InferRow` of the neutral one. */
export type MySqlTableOf<T extends ns.NeutralTable> = MySqlTableWithColumns<{
  name: T["name"];
  schema: undefined;
  dialect: "mysql";
  isAlias: false;
  columns: BuildColumns<
    T["name"],
    { [K in keyof T["columns"]]: ns.FlaggedBuilder<Base, T["columns"][K]> },
    "mysql"
  >;
}>;

/** An indexed or bounded text column; MySQL cannot index unbounded TEXT. */
function bounded(spec: ns.ColumnSpec): ns.ModifiableBuilder {
  if (spec.length === undefined) {
    throw new Error(`MySQL needs a length for ${spec.kind} column ${spec.name}`);
  }
  return varchar(spec.name, { length: spec.length });
}

const refuseJson = (spec: ns.ColumnSpec): never => {
  throw new Error(`json<T> column ${spec.name}: not mapped until a table needs it`);
};
const COLUMNS: Record<ns.ColumnKind, (spec: ns.ColumnSpec) => ns.ModifiableBuilder> = {
  id: bounded,
  key: bounded,
  enum: bounded,
  text: (spec) => text(spec.name),
  int: (spec) => int(spec.name),
  bigint: (spec) => bigint(spec.name, { mode: "number" }),
  bool: (spec) => boolean(spec.name),
  timestamp: (spec) => datetime(spec.name, { mode: "string", fsp: 3 }),
  json: refuseJson,
};

/** MySQL has no partial indexes: a neutral `where` is not expressible here. */
function refusePartialIndexes(table: ns.NeutralTable): void {
  const partial = table.indexes.find((i) => i.where !== undefined);
  if (partial) {
    throw new Error(`MySQL has no partial indexes (${table.name}.${partial.name})`);
  }
}

const builders = { check, foreignKey, index, primaryKey, uniqueIndex } as never;
/** The constraint names the hand-written MySQL DDL uses. */
const names: ns.ConstraintNames = {
  primaryKey: () => null,
  foreignKey: (table, column) => `fk_${table}_${column}`,
};

/** Build the MySQL table of a neutral table. `resolve` finds referenced tables by SQL name. */
export function mysqlTableOf<T extends ns.NeutralTable>(
  table: T,
  resolve: ns.TableResolver,
): MySqlTableOf<T> {
  refusePartialIndexes(table);
  const columns = Object.fromEntries(
    Object.entries(table.columns).map(([key, column]) => [
      key,
      ns.applyFlags(COLUMNS[column.spec.kind](column.spec), column.spec, column.spec.name),
    ]),
  );
  return mysqlTable(
    table.name,
    columns as never,
    (built) => ns.tableExtras({ table, columns: built, resolve, builders, names }) as never,
  );
}
