/**
 * Logical column types of the neutral schema (ADR 0041 decision 2; spike #800).
 *
 * A column is a plain description; each database adapter's table factory turns it into a Drizzle
 * column. The type parameters carry the row type (`TData`), nullability and whether an insert may
 * omit the value, so every dialect infers the same row type from one definition.
 */

/** The logical types. `key` is indexed text: `varchar(n)` in MySQL, `text` elsewhere. */
export type ColumnKind =
  | "id"
  | "text"
  | "key"
  | "int"
  | "bigint"
  | "bool"
  | "timestamp"
  | "json"
  | "enum";

/** What a foreign key does when its parent row is deleted. */
export type OnDelete = "cascade" | "restrict" | "set null";

/** A literal column default, the only kind the neutral schema allows. */
export type DefaultValue = string | number | boolean;

/** A foreign key to another table, named by table and column (`projects`, `id`). */
export interface ColumnReference {
  readonly table: string;
  readonly column: string;
  readonly onDelete: OnDelete;
}

/** The runtime description of one column. */
export interface ColumnSpec {
  readonly kind: ColumnKind;
  /** The SQL column name. */
  readonly name: string;
  /** MySQL `varchar(n)` length of an `id`, `key` or `enumOf` column; SQLite and Postgres ignore it. */
  readonly length?: number;
  /** The allowed values of an `enumOf` column (stored as text; no database enum type). */
  readonly values?: readonly string[];
  readonly notNull: boolean;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly defaultValue?: DefaultValue;
  readonly references?: ColumnReference;
}

/** A neutral column. Immutable: every modifier returns a new column. */
export class NeutralColumn<
  TData,
  TNotNull extends boolean = false,
  THasDefault extends boolean = false,
> {
  /** Type-only brands; never set at runtime. */
  declare readonly $data: TData;
  declare readonly $notNull: TNotNull;
  declare readonly $hasDefault: THasDefault;

  readonly spec: ColumnSpec;

  constructor(spec: ColumnSpec) {
    this.spec = spec;
  }

  notNull(): NeutralColumn<TData, true, THasDefault> {
    return new NeutralColumn({ ...this.spec, notNull: true });
  }

  /** A single-column primary key; implies `notNull`. */
  primaryKey(): NeutralColumn<TData, true, THasDefault> {
    return new NeutralColumn({ ...this.spec, notNull: true, primaryKey: true });
  }

  unique(): NeutralColumn<TData, TNotNull, THasDefault> {
    return new NeutralColumn({ ...this.spec, unique: true });
  }

  default(value: TData & DefaultValue): NeutralColumn<TData, TNotNull, true> {
    return new NeutralColumn({ ...this.spec, defaultValue: value });
  }

  references(
    table: string,
    column: string,
    onDelete: OnDelete,
  ): NeutralColumn<TData, TNotNull, THasDefault> {
    return new NeutralColumn({ ...this.spec, references: { table, column, onDelete } });
  }

  /** Narrow the row type (for example to a status union) without changing the SQL type. */
  $type<T extends TData>(): NeutralColumn<T, TNotNull, THasDefault> {
    return new NeutralColumn(this.spec);
  }
}

/** Any neutral column, for constraints. */
// oxlint-disable-next-line typescript/no-explicit-any -- variance: any column fits
export type AnyNeutralColumn = NeutralColumn<any, boolean, boolean>;

function columnSpec(kind: ColumnKind, name: string, extra: Partial<ColumnSpec> = {}): ColumnSpec {
  return { kind, name, notNull: false, primaryKey: false, unique: false, ...extra };
}

/** An identifier (a ULID, or another table's id): `varchar(length)` in MySQL. */
export function id(name: string, length = 64): NeutralColumn<string> {
  return new NeutralColumn(columnSpec("id", name, { length }));
}

/** Unbounded text that is never indexed. */
export function text(name: string): NeutralColumn<string> {
  return new NeutralColumn(columnSpec("text", name));
}

/** Text that is indexed, unique or compared often: `varchar(length)` in MySQL. */
export function key(name: string, length: number): NeutralColumn<string> {
  return new NeutralColumn(columnSpec("key", name, { length }));
}

/** A 32-bit integer. */
export function int(name: string): NeutralColumn<number> {
  return new NeutralColumn(columnSpec("int", name));
}

/** A 64-bit integer read as a JavaScript number (counters such as generations). */
export function bigint(name: string): NeutralColumn<number> {
  return new NeutralColumn(columnSpec("bigint", name));
}

/** A boolean (`integer` 0/1 in SQLite, `boolean` in Postgres and MySQL). */
export function bool(name: string): NeutralColumn<boolean> {
  return new NeutralColumn(columnSpec("bool", name));
}

/** An instant, read and written as an ISO-8601 string in every dialect. */
export function timestamp(name: string): NeutralColumn<string> {
  return new NeutralColumn(columnSpec("timestamp", name));
}

/** A JSON document stored as text and parsed on read. */
export function json<T>(name: string): NeutralColumn<T> {
  return new NeutralColumn(columnSpec("json", name));
}

/** One of a fixed set of strings, stored as text (`varchar(length)` in MySQL). */
export function enumOf<const T extends readonly [string, ...string[]]>(
  name: string,
  values: T,
  length = 32,
): NeutralColumn<T[number]> {
  return new NeutralColumn(columnSpec("enum", name, { values, length }));
}
