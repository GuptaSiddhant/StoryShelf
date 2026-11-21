/**
 * The parts of a table factory every dialect shares (spike #800): the Drizzle builder type a
 * neutral column maps to, applying its flags, and resolving foreign keys against the tables built
 * so far. Each adapter's `table-factory.ts` adds only its column mapping and table constructor.
 */
import { getTableColumns, type Column, type Table } from "drizzle-orm";
import type { $Type, ColumnBuilderBase, HasDefault, NotNull } from "drizzle-orm";
import type { ColumnReference, ColumnSpec, NeutralColumn } from "./columns.ts";
import type { NeutralTable } from "./define-table.ts";

type WithNotNull<TBuilder extends ColumnBuilderBase, TNotNull> = TNotNull extends true
  ? NotNull<TBuilder>
  : TBuilder;
type WithDefault<TBuilder extends ColumnBuilderBase, THasDefault> = THasDefault extends true
  ? HasDefault<TBuilder>
  : TBuilder;

/**
 * The Drizzle builder type of a neutral column, given the dialect's base builder `TBuilder`. `$Type`
 * fixes the row type, so the select and insert types depend only on the neutral column.
 */
export type FlaggedBuilder<TBuilder extends ColumnBuilderBase, TColumn> =
  TColumn extends NeutralColumn<infer TData, infer TNotNull, infer THasDefault>
    ? WithDefault<WithNotNull<$Type<TBuilder, TData>, TNotNull>, THasDefault>
    : never;

/** The modifiers every Drizzle column builder has; each mutates the builder in place. */
export interface ModifiableBuilder {
  notNull(): unknown;
  primaryKey(): unknown;
  unique(name?: string): unknown;
  default(value: unknown): unknown;
}

/** Apply a column's flags. `uniqueName` names a single-column unique constraint per dialect. */
export function applyFlags<TBuilder extends ModifiableBuilder>(
  builder: TBuilder,
  spec: ColumnSpec,
  uniqueName: string,
): TBuilder {
  if (spec.primaryKey) {
    builder.primaryKey();
  }
  if (spec.notNull && !spec.primaryKey) {
    builder.notNull();
  }
  if (spec.unique) {
    builder.unique(uniqueName);
  }
  if (spec.defaultValue !== undefined) {
    builder.default(spec.defaultValue);
  }
  return builder;
}

/** Looks up a table already built for this dialect (neutral or still hand-written) by SQL name. */
export type TableResolver = (name: string) => Table;

/** One foreign key of a neutral table, ready for a dialect's `foreignKey(...)`. */
export interface ForeignKeyPlan {
  /** Property key of the referencing column. */
  readonly key: string;
  /** SQL name of the referencing column. */
  readonly column: string;
  readonly reference: ColumnReference;
}

/** The foreign keys of a table, in column order. */
export function foreignKeysOf(table: NeutralTable): ForeignKeyPlan[] {
  return Object.entries(table.columns).flatMap(([key, column]) =>
    column.spec.references
      ? [{ key, column: column.spec.name, reference: column.spec.references }]
      : [],
  );
}

/** The Drizzle column a reference points at; throws when the table or column is unknown. */
export function referencedColumn(resolve: TableResolver, reference: ColumnReference): Column {
  const columns = Object.values(getTableColumns(resolve(reference.table)));
  const found: Column | undefined = columns.find((column) => column.name === reference.column);
  if (!found) {
    throw new Error(`Unknown reference ${reference.table}.${reference.column}`);
  }
  return found;
}

/** A resolver over a fixed set of Drizzle tables, keyed by SQL name. */
export function resolverOf(tables: Readonly<Record<string, Table>>): TableResolver {
  return (name) => {
    const table = tables[name];
    if (!table) {
      throw new Error(`Unknown table ${name}`);
    }
    return table;
  };
}

/**
 * Build neutral tables in order (parents first) with one dialect's factory. `external` holds the
 * tables still hand-written (for example `projects`) that the neutral ones reference.
 */
export function buildAll<TBuilt extends Table>(
  tables: readonly NeutralTable[],
  build: (table: NeutralTable, resolve: TableResolver) => TBuilt,
  external: Readonly<Record<string, Table>>,
): Record<string, TBuilt> {
  const registry: Record<string, Table> = { ...external };
  const resolve = resolverOf(registry);
  const built: Record<string, TBuilt> = {};
  for (const table of tables) {
    const drizzleTable = build(table, resolve);
    built[table.name] = drizzleTable;
    registry[table.name] = drizzleTable;
  }
  return built;
}
