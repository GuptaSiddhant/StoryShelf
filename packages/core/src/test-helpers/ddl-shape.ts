/**
 * Parse DDL text into a structural shape (spike #800, ADR 0041): columns with exact types,
 * nullability and defaults, the primary key, unique keys, indexes, foreign keys and checks. Both
 * the hand-written `ddl.ts` and drizzle-kit's output parse into the same shape, so
 * `compareDdlShapes` reports only real differences, not formatting.
 *
 * Unnamed constraints get the name their database would give them, so a name that only the
 * database chooses still compares.
 */
import { applyTableBody, foreignKeyDetail } from "./ddl-shape-body.ts";
import { identList, splitTopLevel, statementsOf, unquote } from "./ddl-text.ts";

/** The dialect a DDL text is written in. */
export type ShapeDialect = "sqlite" | "pg" | "mysql";

export interface ShapeColumn {
  type: string;
  notNull: boolean;
  defaultValue: string | null;
}

/** A primary key, unique key, foreign key or check, with its (possibly implicit) name. */
export interface ShapeConstraint {
  name: string;
  columns: string[];
  /** Foreign keys: `table(column) on delete <action>`; checks: normalised SQL. */
  detail: string;
}

export interface ShapeTable {
  columns: Map<string, ShapeColumn>;
  primaryKey: ShapeConstraint | null;
  uniques: ShapeConstraint[];
  foreignKeys: ShapeConstraint[];
  checks: ShapeConstraint[];
}

export interface ShapeIndex {
  name: string;
  table: string;
  columns: string[];
  where: string | null;
}

export interface DdlShape {
  tables: Map<string, ShapeTable>;
  /** Non-unique indexes; unique indexes are folded into `ShapeTable.uniques`. */
  indexes: Map<string, ShapeIndex>;
}

const IDENT = String.raw`(?:"[^"]+"|\x60[^\x60]+\x60|\w+)`;
const CREATE_TABLE = new RegExp(
  String.raw`^CREATE TABLE (?:IF NOT EXISTS )?(?<name>${IDENT})\s*\((?<body>[\s\S]*)\)$`,
  "iu",
);
const CREATE_INDEX = new RegExp(
  String.raw`^CREATE (?<unique>UNIQUE )?INDEX (?:IF NOT EXISTS )?(?<name>${IDENT}) ON (?<table>${IDENT})(?: USING \w+)?\s*\((?<columns>[^)]*)\)(?: WHERE (?<where>.+))?$`,
  "iu",
);
const ADD_FOREIGN_KEY = new RegExp(
  String.raw`^ALTER TABLE (?<table>${IDENT}) ADD CONSTRAINT (?<name>${IDENT}) (?<rest>FOREIGN KEY .+)$`,
  "iu",
);

function emptyTable(): ShapeTable {
  return { columns: new Map(), primaryKey: null, uniques: [], foreignKeys: [], checks: [] };
}

/** Parse every table, index and added foreign key of `sqlText` in the given dialect. */
export function ddlShape(sqlText: string, dialect: ShapeDialect): DdlShape {
  const shape: DdlShape = { tables: new Map(), indexes: new Map() };
  for (const statement of statementsOf(sqlText)) {
    const table = CREATE_TABLE.exec(statement)?.groups;
    const index = CREATE_INDEX.exec(statement)?.groups;
    const foreignKey = ADD_FOREIGN_KEY.exec(statement)?.groups;
    if (table) {
      const name = unquote(table["name"] ?? "");
      shape.tables.set(
        name,
        applyTableBody(emptyTable(), name, splitTopLevel(table["body"] ?? ""), dialect),
      );
    } else if (index) {
      addIndex(shape, index);
    } else if (foreignKey) {
      addForeignKey(shape, foreignKey);
    }
  }
  return shape;
}

function addIndex(shape: DdlShape, groups: Record<string, string | undefined>): void {
  const table = unquote(groups["table"] ?? "");
  const entry = {
    name: unquote(groups["name"] ?? ""),
    columns: identList(groups["columns"] ?? ""),
  };
  if (groups["unique"]) {
    shape.tables.get(table)?.uniques.push({ ...entry, detail: groups["where"]?.trim() ?? "" });
  } else {
    shape.indexes.set(entry.name, { ...entry, table, where: groups["where"]?.trim() ?? null });
  }
}

function addForeignKey(shape: DdlShape, groups: Record<string, string | undefined>): void {
  const parsed = foreignKeyDetail(groups["rest"] ?? "");
  shape.tables
    .get(unquote(groups["table"] ?? ""))
    ?.foreignKeys.push({ name: unquote(groups["name"] ?? ""), ...parsed });
}
