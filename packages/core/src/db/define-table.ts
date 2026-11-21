/**
 * `defineTable`: one dialect-neutral table definition (ADR 0041 decision 2; spike #800).
 *
 * A neutral table holds its columns plus the table-level parts every dialect shares: indexes
 * (composite, unique and partial), a composite primary key and named CHECK constraints. The
 * adapters' table factories build the Drizzle table from it; nothing here imports a dialect.
 */
import type { AnyNeutralColumn, NeutralColumn } from "./columns.ts";

/** An index over columns named by their property keys. `where` makes it partial (not in MySQL). */
export interface IndexSpec<TKey extends string = string> {
  readonly name: string;
  readonly columns: readonly TKey[];
  readonly unique: boolean;
  /** A partial index's predicate in portable SQL over column names. */
  readonly where?: string;
}

/** A named CHECK constraint; `sql` is portable SQL over column names. */
export interface CheckSpec {
  readonly name: string;
  readonly sql: string;
}

/** A composite primary key over property keys. */
export interface PrimaryKeySpec<TKey extends string = string> {
  readonly columns: readonly TKey[];
}

/** The table-level parts of a definition. */
export interface TableExtras<TKey extends string = string> {
  readonly indexes?: readonly IndexSpec<TKey>[];
  readonly primaryKey?: PrimaryKeySpec<TKey>;
  readonly checks?: readonly CheckSpec[];
}

/** A neutral table. */
export interface NeutralTable<
  TName extends string = string,
  TColumns extends Record<string, AnyNeutralColumn> = Record<string, AnyNeutralColumn>,
> {
  readonly name: TName;
  readonly columns: TColumns;
  /** Keys are checked by `defineTable`; stored as plain strings so tables stay covariant. */
  readonly indexes: readonly IndexSpec[];
  readonly primaryKey?: PrimaryKeySpec;
  readonly checks: readonly CheckSpec[];
}

/** Define a table once for every dialect. */
export function defineTable<
  const TName extends string,
  TColumns extends Record<string, AnyNeutralColumn>,
>(
  name: TName,
  columns: TColumns,
  extras: TableExtras<keyof TColumns & string> = {},
): NeutralTable<TName, TColumns> {
  return {
    name,
    columns,
    indexes: extras.indexes ?? [],
    ...(extras.primaryKey ? { primaryKey: extras.primaryKey } : {}),
    checks: extras.checks ?? [],
  };
}

/** A non-unique index. */
export function index<const TKey extends string>(
  name: string,
  columns: readonly TKey[],
  where?: string,
): IndexSpec<TKey> {
  return { name, columns, unique: false, ...(where === undefined ? {} : { where }) };
}

/** A unique index. */
export function uniqueIndex<const TKey extends string>(
  name: string,
  columns: readonly TKey[],
  where?: string,
): IndexSpec<TKey> {
  return { name, columns, unique: true, ...(where === undefined ? {} : { where }) };
}

/** The row type a column reads as. */
export type ColumnData<TColumn> =
  TColumn extends NeutralColumn<infer TData, infer TNotNull, boolean>
    ? TNotNull extends true
      ? TData
      : TData | null
    : never;

/** The row type of a neutral table: what every dialect's `$inferSelect` must equal. */
export type InferRow<T extends NeutralTable> = {
  -readonly [K in keyof T["columns"]]: ColumnData<T["columns"][K]>;
};
