/**
 * The table-level half of a dialect factory (spike #800): indexes, a composite primary key,
 * checks and foreign keys, built with the dialect's own Drizzle builders and naming rules.
 */
import { sql, type SQL } from "drizzle-orm";
import type { OnDelete } from "./columns.ts";
import type { NeutralTable } from "./define-table.ts";
import {
  foreignKeysOf,
  referencedColumn,
  type ForeignKeyPlan,
  type TableResolver,
} from "./dialect-kit.ts";

/** A dialect's Drizzle constraint builders, loosely typed: the factory owns the precise types. */
export interface DialectBuilders {
  index(name: string): { on(...columns: never[]): unknown };
  uniqueIndex(name: string): { on(...columns: never[]): unknown };
  primaryKey(config: { name?: string; columns: never[] }): unknown;
  check(name: string, value: SQL): unknown;
  foreignKey(config: { name?: string; columns: never[]; foreignColumns: never[] }): {
    onDelete(action: OnDelete): unknown;
  };
}

/** How a dialect names the constraints the hand-written DDL leaves to the database. */
export interface ConstraintNames {
  /** A composite primary key's name, or null for the database default. */
  primaryKey(table: string): string | null;
  /** A foreign key's name, or null for the database default. */
  foreignKey(table: string, column: string): string | null;
}

/** The context a dialect factory passes to {@link tableExtras}. */
export interface ExtrasInput {
  readonly table: NeutralTable;
  /** The Drizzle columns of the table being built, by property key. */
  readonly columns: Readonly<Record<string, unknown>>;
  readonly resolve: TableResolver;
  readonly builders: DialectBuilders;
  readonly names: ConstraintNames;
}

function columnsAt(input: ExtrasInput, keys: readonly string[]): never[] {
  return keys.map((key) => input.columns[key]) as never[];
}

function indexesOf(input: ExtrasInput): unknown[] {
  return input.table.indexes.map((spec) => {
    const { builders } = input;
    const start = spec.unique ? builders.uniqueIndex(spec.name) : builders.index(spec.name);
    const built = start.on(...columnsAt(input, spec.columns)) as {
      where(condition: SQL): unknown;
    };
    return spec.where === undefined ? built : built.where(sql.raw(spec.where));
  });
}

function primaryKeyOf(input: ExtrasInput): unknown[] {
  const spec = input.table.primaryKey;
  if (!spec) {
    return [];
  }
  const name = input.names.primaryKey(input.table.name);
  const columns = columnsAt(input, spec.columns);
  return [input.builders.primaryKey(name === null ? { columns } : { name, columns })];
}

function foreignKeyOf(input: ExtrasInput, plan: ForeignKeyPlan): unknown {
  const name = input.names.foreignKey(input.table.name, plan.column);
  const columns = columnsAt(input, [plan.key]);
  const foreignColumns = [referencedColumn(input.resolve, plan.reference)] as never[];
  const config = name === null ? { columns, foreignColumns } : { name, columns, foreignColumns };
  return input.builders.foreignKey(config).onDelete(plan.reference.onDelete);
}

/** The table-level Drizzle parts of a neutral table: indexes, primary key, checks, foreign keys. */
export function tableExtras(input: ExtrasInput): unknown[] {
  return [
    ...indexesOf(input),
    ...primaryKeyOf(input),
    ...input.table.checks.map((c) => input.builders.check(c.name, sql.raw(c.sql))),
    ...foreignKeysOf(input.table).map((plan) => foreignKeyOf(input, plan)),
  ];
}
