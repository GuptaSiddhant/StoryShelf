/**
 * Postgres table factory (ADR 0041 decision 2; spike #800): builds a Drizzle `pgTable` from a
 * neutral table. Not used by the adapter yet; `schema/` and `ddl.ts` stay authoritative.
 */
import { neutralSchema as ns } from "@storyshelf/core/test-helpers";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type PgBuildColumns,
  type PgTableWithColumns,
  type PgTextBuilder,
} from "drizzle-orm/pg-core";

type Base = PgTextBuilder;

/** The Drizzle table a neutral table builds; its `$inferSelect` is `InferRow` of the neutral one. */
export type PgTableOf<T extends ns.NeutralTable> = PgTableWithColumns<{
  name: T["name"];
  schema: undefined;
  dialect: "pg";
  isAlias: false;
  columns: PgBuildColumns<
    T["name"],
    { [K in keyof T["columns"]]: ns.FlaggedBuilder<Base, T["columns"][K]> }
  >;
}>;

const refuseJson = (spec: ns.ColumnSpec): never => {
  throw new Error(`json<T> column ${spec.name}: not mapped until a table needs it`);
};
const plainText = (spec: ns.ColumnSpec): ns.ModifiableBuilder => text(spec.name);
const COLUMNS: Record<ns.ColumnKind, (spec: ns.ColumnSpec) => ns.ModifiableBuilder> = {
  id: plainText,
  text: plainText,
  key: plainText,
  enum: plainText,
  int: (spec) => integer(spec.name),
  bigint: (spec) => bigint(spec.name, { mode: "number" }),
  bool: (spec) => boolean(spec.name),
  timestamp: (spec) => timestamp(spec.name, { withTimezone: true, mode: "string" }),
  json: refuseJson,
};

const builders = { check, foreignKey, index, primaryKey, uniqueIndex } as never;
/** The names Postgres gives the hand-written DDL's unnamed constraints. */
const names: ns.ConstraintNames = {
  primaryKey: (table) => `${table}_pkey`,
  foreignKey: (table, column) => `${table}_${column}_fkey`,
};

/** Build the Postgres table of a neutral table. `resolve` finds referenced tables by SQL name. */
export function pgTableOf<T extends ns.NeutralTable>(
  table: T,
  resolve: ns.TableResolver,
): PgTableOf<T> {
  const columns = Object.fromEntries(
    Object.entries(table.columns).map(([key, column]) => [
      key,
      ns.applyFlags(
        COLUMNS[column.spec.kind](column.spec),
        column.spec,
        `${table.name}_${column.spec.name}_key`,
      ),
    ]),
  );
  return pgTable(
    table.name,
    columns as never,
    (built) => ns.tableExtras({ table, columns: built, resolve, builders, names }) as never,
  );
}
