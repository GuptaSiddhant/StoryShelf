/**
 * Compare two DDL shapes table by table (spike #800, ADR 0041): the hand-written `ddl.ts` against
 * drizzle-kit's output. Every message names the table and the part that differs, `today → generated`.
 */
import type { DdlShape, ShapeConstraint, ShapeTable } from "./ddl-shape.ts";

const show = (value: unknown): string => JSON.stringify(value);

function compareColumns(table: string, today: ShapeTable, generated: ShapeTable): string[] {
  const names = new Set([...today.columns.keys(), ...generated.columns.keys()]);
  return [...names].flatMap((name) => {
    const a = today.columns.get(name);
    const b = generated.columns.get(name);
    if (!a || !b) {
      return [`${table}.${name}: column only ${a ? "today" : "generated"}`];
    }
    return (["type", "notNull", "defaultValue"] as const)
      .filter((field) => a[field] !== b[field])
      .map((field) => `${table}.${name}: ${field} ${show(a[field])} → ${show(b[field])}`);
  });
}

type Keyed = (c: ShapeConstraint) => string;
const byColumns: Keyed = (c) => `(${c.columns.join(",")})`;
const byDetail: Keyed = (c) => c.detail;

function compareConstraints(
  label: string,
  today: ShapeConstraint[],
  generated: ShapeConstraint[],
  keyOf: Keyed,
): string[] {
  const keys = new Set([...today, ...generated].map((c) => keyOf(c)));
  return [...keys].flatMap((key) => {
    const before = today.find((c) => keyOf(c) === key);
    const after = generated.find((c) => keyOf(c) === key);
    if (!before || !after) {
      return [`${label} ${key}: only ${before ? "today" : "generated"}`];
    }
    const names = before.name === after.name ? [] : [`name ${before.name} → ${after.name}`];
    const details = before.detail === after.detail ? [] : [`${before.detail} → ${after.detail}`];
    const changes = [...names, ...details];
    return changes.map((change) => `${label} ${key}: ${change}`);
  });
}

const pk = (table: ShapeTable): ShapeConstraint[] => (table.primaryKey ? [table.primaryKey] : []);

function compareTable(table: string, today: ShapeTable, generated: ShapeTable): string[] {
  return [
    ...compareColumns(table, today, generated),
    ...compareConstraints(`${table} primary key`, pk(today), pk(generated), byColumns),
    ...compareConstraints(`${table} unique`, today.uniques, generated.uniques, byColumns),
    ...compareConstraints(
      `${table} foreign key`,
      today.foreignKeys,
      generated.foreignKeys,
      byColumns,
    ),
    ...compareConstraints(`${table} check`, today.checks, generated.checks, byDetail),
  ];
}

function compareIndexes(tables: readonly string[], today: DdlShape, generated: DdlShape): string[] {
  const names = new Set(
    [...today.indexes.values(), ...generated.indexes.values()]
      .filter((i) => tables.includes(i.table))
      .map((i) => i.name),
  );
  return [...names].flatMap((name) => {
    const a = today.indexes.get(name);
    const b = generated.indexes.get(name);
    if (!a || !b) {
      return [`index ${name}: only ${a ? "today" : "generated"}`];
    }
    const same = show([a.table, a.columns, a.where]) === show([b.table, b.columns, b.where]);
    return same ? [] : [`index ${name}: ${show(a)} → ${show(b)}`];
  });
}

/** Every difference between `today` and `generated` for `tables`; empty when they agree. */
export function compareDdlShapes(
  tables: readonly string[],
  today: DdlShape,
  generated: DdlShape,
): string[] {
  const tableProblems = tables.flatMap((table) => {
    const a = today.tables.get(table);
    const b = generated.tables.get(table);
    if (a && b) {
      return compareTable(table, a, b);
    }
    return [`${table}: table ${a ? "only today" : b ? "only generated" : "in neither"}`];
  });
  return [...tableProblems, ...compareIndexes(tables, today, generated)];
}
