/**
 * The body of a `CREATE TABLE` as a shape (spike #800): columns with their inline constraints,
 * and the table-level primary key, unique, foreign key and check constraints.
 */
import { nameConstraints } from "./ddl-names.ts";
import type { ShapeColumn, ShapeDialect, ShapeTable } from "./ddl-shape.ts";
import { identList, unquote } from "./ddl-text.ts";
import { normaliseDefault } from "./schema-parity.ts";

const COLUMN = /^(?<name>"[^"]+"|`[^`]+`|\w+) (?<rest>.+)$/u;
const TYPE_END = / (?:NOT NULL|NULL|DEFAULT|PRIMARY KEY|UNIQUE|REFERENCES|CHECK)\b/iu;
const DEFAULT_VALUE = /\bDEFAULT (?<value>'[^']*'|\((?:[^()]|\([^()]*\))*\)|[^\s,]+)/iu;
const CHECK_BODY = /\bCHECK\s*(?<sql>\((?:[^()]|\([^()]*\))*\))/iu;
/** `CONSTRAINT [name] …`: MySQL may leave the name out (`CONSTRAINT PRIMARY KEY(…)`). */
const NAMED =
  /^CONSTRAINT (?:(?<name>"[^"]+"|`[^`]+`|(?!(?:PRIMARY|UNIQUE|CHECK|FOREIGN)\b)\w+) )?(?<rest>.+)$/iu;
/** `PRIMARY KEY (…)`, `UNIQUE (…)`, or MySQL's `UNIQUE INDEX (…)` / `UNIQUE KEY (…)`. */
const KEY_COLUMNS = /^(?:PRIMARY KEY|UNIQUE(?: INDEX| KEY)?)\s*\((?<columns>[^)]*)\)$/iu;
const FOREIGN_KEY = /^FOREIGN KEY\s*\((?<columns>[^)]*)\) (?<rest>REFERENCES .+)$/iu;
const REFERENCES =
  /REFERENCES (?:(?:"\w+"|`\w+`|\w+)\.)?(?<table>"[^"]+"|`[^`]+`|\w+)\s*\((?<column>[^)]*)\)(?<actions>.*)$/iu;
const ON_DELETE = /\bON DELETE (?<action>SET NULL|SET DEFAULT|NO ACTION|CASCADE|RESTRICT)\b/iu;

const TYPE_SYNONYMS: Record<ShapeDialect, Record<string, string>> = {
  sqlite: {},
  pg: { timestamptz: "timestamp with time zone", int: "integer", int4: "integer", bool: "boolean" },
  mysql: { integer: "int", "tinyint(1)": "boolean", bool: "boolean" },
};

/** Lower-cased SQL with whitespace and the outer parentheses removed. */
export function normaliseCheck(sqlText: string): string {
  const flat = sqlText.trim().toLowerCase().replaceAll(/\s+/gu, " ");
  const inner = flat.replace(/^\((?<body>.*)\)$/u, "$<body>").trim();
  return inner.replaceAll(/\(\s+/gu, "(").replaceAll(/\s+\)/gu, ")");
}

/** `REFERENCES t(c) ON DELETE x …` as `t(c) on delete x`, with the column list it constrains. */
export function foreignKeyDetail(text: string): { columns: string[]; detail: string } {
  const fk = FOREIGN_KEY.exec(text)?.groups;
  const ref = REFERENCES.exec(fk?.["rest"] ?? text)?.groups;
  const action = ON_DELETE.exec(ref?.["actions"] ?? "")?.groups?.["action"] ?? "no action";
  const target = `${unquote(ref?.["table"] ?? "")}(${identList(ref?.["column"] ?? "").join(",")})`;
  return {
    columns: fk ? identList(fk["columns"] ?? "") : [],
    detail: `${target} on delete ${action.toLowerCase()}`,
  };
}

function columnType(rest: string, dialect: ShapeDialect): string {
  const raw = (rest.split(TYPE_END)[0] ?? "").trim().toLowerCase().replaceAll(/\s+/gu, " ");
  return TYPE_SYNONYMS[dialect][raw] ?? raw;
}

function addColumn(table: ShapeTable, line: string, dialect: ShapeDialect): void {
  const groups = COLUMN.exec(line)?.groups ?? {};
  const name = unquote(groups["name"] ?? "");
  const rest = groups["rest"] ?? "";
  const constraints = rest.slice(rest.split(TYPE_END)[0]?.length ?? 0);
  const primaryKey = /\bPRIMARY KEY\b/iu.test(constraints);
  const column: ShapeColumn = {
    type: columnType(rest, dialect),
    notNull: primaryKey || /\bNOT NULL\b/iu.test(constraints),
    defaultValue: normaliseDefault(DEFAULT_VALUE.exec(constraints)?.groups?.["value"]),
  };
  table.columns.set(name, column);
  addInlineConstraints(table, name, constraints, primaryKey);
}

function addInlineConstraints(
  table: ShapeTable,
  column: string,
  constraints: string,
  primaryKey: boolean,
): void {
  const columns = [column];
  if (primaryKey) {
    table.primaryKey = { name: "", columns, detail: "" };
  }
  if (/\bUNIQUE\b/iu.test(constraints)) {
    table.uniques.push({ name: "", columns, detail: "" });
  }
  if (/\bREFERENCES\b/iu.test(constraints)) {
    table.foreignKeys.push({ name: "", columns, detail: foreignKeyDetail(constraints).detail });
  }
  const check = CHECK_BODY.exec(constraints)?.groups?.["sql"];
  if (check !== undefined) {
    table.checks.push({ name: "", columns, detail: normaliseCheck(check) });
  }
}

/** Add a table-level constraint; returns false when `item` is a column instead. */
function addTableConstraint(table: ShapeTable, item: string): boolean {
  const named = NAMED.exec(item)?.groups;
  const name = named ? unquote(named["name"] ?? "") : "";
  const rest = named ? (named["rest"] ?? "") : item;
  const keys = KEY_COLUMNS.exec(rest)?.groups?.["columns"];
  if (/^PRIMARY KEY/iu.test(rest)) {
    table.primaryKey = { name, columns: identList(keys ?? ""), detail: "" };
  } else if (/^UNIQUE/iu.test(rest)) {
    table.uniques.push({ name, columns: identList(keys ?? ""), detail: "" });
  } else if (/^FOREIGN KEY/iu.test(rest)) {
    table.foreignKeys.push({ name, ...foreignKeyDetail(rest) });
  } else if (/^CHECK/iu.test(rest)) {
    table.checks.push({ name, columns: [], detail: normaliseCheck(rest.replace(/^CHECK/iu, "")) });
  } else {
    return false;
  }
  return true;
}

/** Parse the items of a `CREATE TABLE` body into `table`, then name its constraints. */
export function applyTableBody(
  table: ShapeTable,
  name: string,
  items: readonly string[],
  dialect: ShapeDialect,
): ShapeTable {
  for (const item of items) {
    if (!addTableConstraint(table, item)) {
      addColumn(table, item, dialect);
    }
  }
  return nameConstraints(table, name, dialect);
}
