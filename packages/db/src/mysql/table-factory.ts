/**
 * MySQL table factory (ADR 0041 decision 2; spike #800): builds a Drizzle `mysqlTable` from a
 * neutral table. Tables not yet
 * defined in core stay hand-written in `schema/` and `ddl.ts`.
 */
import * as ns from "@storyshelf/core/db";
import type { BuildColumns } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  double,
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

/** A `json<T>` column: `TEXT` holding the JSON, encoded and parsed by `ns.jsonCodec`. */
const jsonText = customType<{ data: unknown; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => ns.jsonCodec.toDriver(value),
  fromDriver: (value) => ns.jsonCodec.fromDriver(value),
});
const COLUMNS: Record<ns.ColumnKind, (spec: ns.ColumnSpec) => ns.ModifiableBuilder> = {
  id: bounded,
  key: bounded,
  enum: bounded,
  text: (spec) => text(spec.name),
  int: (spec) => int(spec.name),
  bigint: (spec) => bigint(spec.name, { mode: "number" }),
  double: (spec) => double(spec.name),
  bool: (spec) => boolean(spec.name),
  timestamp: (spec) => datetime(spec.name, { mode: "string", fsp: 3 }),
  json: (spec) => jsonText(spec.name),
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

/**
 * A column with its flags. MySQL 8 (and TiDB, PlanetScale) gives a `TEXT` column no literal
 * default, so the default of a `text` or `json<T>` column is applied by Drizzle on insert
 * (`$defaultFn`) and the DDL has none, as `ddl.ts` writes it.
 */
function mysqlColumn(spec: ns.ColumnSpec): ns.ModifiableBuilder {
  const builder = COLUMNS[spec.kind](spec) as ns.InsertDefaultBuilder;
  if ((spec.kind !== "json" && spec.kind !== "text") || spec.defaultValue === undefined) {
    return ns.applyFlags(builder, spec, spec.name);
  }
  const { defaultValue, ...withoutDdlDefault } = spec;
  const flagged = ns.applyFlags(builder, withoutDdlDefault, spec.name);
  if (spec.kind === "json") {
    return ns.withJsonInsertDefault(flagged, spec);
  }
  flagged.$defaultFn(() => defaultValue);
  return flagged;
}

/** Build the MySQL table of a neutral table. `resolve` finds referenced tables by SQL name. */
export function mysqlTableOf<T extends ns.NeutralTable>(
  table: T,
  resolve: ns.TableResolver,
): MySqlTableOf<T> {
  refusePartialIndexes(table);
  const columns = Object.fromEntries(
    Object.entries(table.columns).map(([key, column]) => [key, mysqlColumn(column.spec)]),
  );
  return mysqlTable(
    table.name,
    columns as never,
    (built) => ns.tableExtras({ table, columns: built, resolve, builders, names }) as never,
  );
}
