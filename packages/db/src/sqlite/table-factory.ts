/**
 * SQLite table factory (ADR 0041 decision 2; spike #800): builds a Drizzle `sqliteTable` from a
 * neutral table. Tables not yet
 * defined in core stay hand-written in `schema/` and `ddl.ts`.
 */
import * as ns from "@storyshelf/core/db";
import type { BuildColumns } from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
  type ForeignKeyBuilder,
  type SQLiteTableWithColumns,
  type SQLiteTextBuilder,
} from "drizzle-orm/sqlite-core";

type Base = SQLiteTextBuilder<[string, ...string[]]>;

/** The Drizzle table a neutral table builds; its `$inferSelect` is `InferRow` of the neutral one. */
export type SqliteTableOf<T extends ns.NeutralTable> = SQLiteTableWithColumns<{
  name: T["name"];
  schema: undefined;
  dialect: "sqlite";
  isAlias: false;
  columns: BuildColumns<
    T["name"],
    { [K in keyof T["columns"]]: ns.FlaggedBuilder<Base, T["columns"][K]> },
    "sqlite"
  >;
}>;

/** A `json<T>` column: `TEXT` holding the JSON, encoded and parsed by `ns.jsonCodec`. */
const jsonText = customType<{ data: unknown; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => ns.jsonCodec.toDriver(value),
  fromDriver: (value) => ns.jsonCodec.fromDriver(value),
});
const plainText = (spec: ns.ColumnSpec): ns.ModifiableBuilder => text(spec.name);
/** SQLite has no column types to choose: integers for numbers and booleans, text otherwise. */
const COLUMNS: Record<ns.ColumnKind, (spec: ns.ColumnSpec) => ns.ModifiableBuilder> = {
  id: plainText,
  text: plainText,
  key: plainText,
  enum: plainText,
  timestamp: plainText,
  int: (spec) => integer(spec.name),
  bigint: (spec) => integer(spec.name),
  double: (spec) => real(spec.name),
  bool: (spec) => integer(spec.name, { mode: "boolean" }),
  json: (spec) => jsonText(spec.name),
};

type KeyColumns = [AnySQLiteColumn, ...AnySQLiteColumn[]];
/** The object form of `foreignKey` (the callback form is deprecated). */
function objectForeignKey(config: {
  name?: string;
  columns: KeyColumns;
  foreignColumns: KeyColumns;
}): ForeignKeyBuilder {
  return foreignKey(config);
}
const builders = { check, foreignKey: objectForeignKey, index, primaryKey, uniqueIndex } as never;
/** SQLite ignores constraint names on keys; leave them to the database. */
const names: ns.ConstraintNames = { primaryKey: () => null, foreignKey: () => null };

/** Build the SQLite table of a neutral table. `resolve` finds referenced tables by SQL name. */
export function sqliteTableOf<T extends ns.NeutralTable>(
  table: T,
  resolve: ns.TableResolver,
): SqliteTableOf<T> {
  const columns = Object.fromEntries(
    Object.entries(table.columns).map(([key, column]) => [
      key,
      ns.withJsonInsertDefault(
        ns.applyFlags(
          COLUMNS[column.spec.kind](column.spec) as ns.InsertDefaultBuilder,
          column.spec,
          `${table.name}_${column.spec.name}_unique`,
        ),
        column.spec,
      ),
    ]),
  );
  return sqliteTable(
    table.name,
    columns as never,
    (built) => ns.tableExtras({ table, columns: built, resolve, builders, names }) as never,
  );
}
