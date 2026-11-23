/**
 * The names each database gives the constraints the hand-written DDL leaves unnamed (spike #800),
 * so `compareDdlShapes` can compare an implicit name with one drizzle-kit writes out.
 */
import type { ShapeConstraint, ShapeDialect, ShapeTable } from "./ddl-shape.ts";

/** Constraint names a dialect never uses (SQLite keys and checks; MySQL's `PRIMARY`). */
const IGNORED = "-";

/** Fill in unnamed constraints and drop the names a dialect ignores. */
export function nameConstraints(
  table: ShapeTable,
  name: string,
  dialect: ShapeDialect,
): ShapeTable {
  return dialect === "sqlite"
    ? sqliteNames(table, name)
    : dialect === "pg"
      ? pgNames(table, name)
      : mysqlNames(table, name);
}

function renamed(list: ShapeConstraint[], name: (c: ShapeConstraint, n: number) => string) {
  let ordinal = 0;
  return list.map((c) => {
    ordinal += c.name === "" ? 1 : 0;
    return c.name === "" ? { ...c, name: name(c, ordinal) } : c;
  });
}

function ignored(list: ShapeConstraint[]): ShapeConstraint[] {
  return list.map((c) => ({ ...c, name: IGNORED }));
}

function sqliteNames(table: ShapeTable, name: string): ShapeTable {
  return {
    ...table,
    primaryKey: table.primaryKey ? { ...table.primaryKey, name: IGNORED } : null,
    uniques: renamed(table.uniques, (_c, n) => `sqlite_autoindex_${name}_${n}`),
    foreignKeys: ignored(table.foreignKeys),
    checks: ignored(table.checks),
  };
}

function pgNames(table: ShapeTable, name: string): ShapeTable {
  const pk = table.primaryKey;
  return {
    ...table,
    primaryKey: pk ? { ...pk, name: pk.name || `${name}_pkey` } : null,
    uniques: renamed(table.uniques, (c) => `${name}_${c.columns.join("_")}_key`),
    foreignKeys: renamed(table.foreignKeys, (c) => `${name}_${c.columns.join("_")}_fkey`),
    checks: renamed(table.checks, (c) =>
      c.columns.length === 1 ? `${name}_${c.columns[0]}_check` : `${name}_check`,
    ),
  };
}

function mysqlNames(table: ShapeTable, name: string): ShapeTable {
  return {
    ...table,
    primaryKey: table.primaryKey ? { ...table.primaryKey, name: "PRIMARY" } : null,
    uniques: renamed(table.uniques, (c) => c.columns[0] ?? ""),
    foreignKeys: renamed(table.foreignKeys, (_c, n) => `${name}_ibfk_${n}`),
    checks: renamed(table.checks, (_c, n) => `${name}_chk_${n}`),
  };
}
