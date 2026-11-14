import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import type { Column } from "drizzle-orm";
/**
 * Schema parity (ADR 0041, decision 1): compares the hand-written DDL of a
 * dialect with its Drizzle schema and with the core row interfaces, and
 * returns every disagreement as a message. The three database adapters each
 * run it from a `schema-parity.test.ts`, so the tests stay identical.
 *
 * Hermetic: it parses text and reads Drizzle table metadata, nothing connects.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Coarse column type shared by the three dialects. */
export type TypeFamily = "text" | "int" | "bool" | "real" | "time" | "json" | "blob" | "other";

export interface DdlColumn {
  name: string;
  type: string;
  family: TypeFamily;
  notNull: boolean;
  /** Normalised default literal, or `null` when there is none. */
  defaultValue: string | null;
  unique: boolean;
}

export interface DdlIndex {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  where: string | null;
}

export interface ParsedDdl {
  tables: Map<string, Map<string, DdlColumn>>;
  indexes: Map<string, DdlIndex>;
}

/** A known difference. `issue` names the issue that removes the entry. */
export interface ParityAllowance {
  /** Table name; `*` is not supported on purpose. */
  table: string;
  /** Column name, or omitted for a whole table / index. */
  column?: string;
  /** Index name, for an index that exists on one side only. */
  index?: string;
  /** Why the difference is accepted. */
  reason: string;
  /** The issue (or ADR) whose work removes the entry, for example `#376`. */
  issue: string;
}

/** The slice of Drizzle's `getTableConfig` result the comparison reads. */
export interface DrizzleTableConfig {
  name: string;
  columns: Column[];
  indexes: {
    config: {
      name: string;
      unique?: boolean;
      where?: unknown;
      columns: ({ name?: string } | object)[];
    };
  }[];
}

export type GetTableConfig = (table: never) => DrizzleTableConfig;

const FAMILY_PATTERNS: [RegExp, TypeFamily][] = [
  [/^(?:tinyint\(1\)|bool(?:ean)?)$/u, "bool"],
  [/^(?:json|jsonb)$/u, "json"],
  [/^(?:text|varchar|char|longtext|mediumtext|character varying)(?:\(\d+\))?$/u, "text"],
  [/^(?:int|integer|bigint|smallint|tinyint|mediumint|serial|bigserial)(?:\(\d+\))?$/u, "int"],
  [/^(?:real|double|double precision|float|numeric|decimal)(?:\(.*\))?$/u, "real"],
  [
    /^(?:timestamp|timestamptz|datetime|date|time)(?:\(\d+\))?(?: with(?:out)? time zone)?$/u,
    "time",
  ],
  [/^(?:blob|bytea|longblob|mediumblob)$/u, "blob"],
];

/** Map a SQL type such as `VARCHAR(64)` or `timestamp with time zone` to a family. */
export function typeFamily(sqlType: string): TypeFamily {
  const normal = sqlType.trim().toLowerCase().replaceAll(/\s+/gu, " ");
  return FAMILY_PATTERNS.find(([pattern]) => pattern.test(normal))?.[1] ?? "other";
}

const CONSTRAINT_PREFIX = /^(?:PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\s/iu;
const TABLE_BLOCK =
  /CREATE TABLE IF NOT EXISTS\s+["`]?(?<table>\w+)["`]?\s*\((?<body>[\s\S]*?)\n\)[^\n]*;/gu;
const INDEX_STATEMENT =
  /CREATE\s+(?<unique>UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?(?<name>\w+)\s+ON\s+["`]?(?<table>\w+)["`]?\s*\((?<columns>[^)]*)\)(?:\s+WHERE\s+(?<where>[^;]+))?;/gu;
const TYPE_END =
  /\s+(?:NOT NULL|NULL|DEFAULT|PRIMARY|UNIQUE|REFERENCES|CHECK|COLLATE|GENERATED)\b/iu;
const DEFAULT_CLAUSE = /\bDEFAULT\s+(?<value>'[^']*'|\([^)]*\)|[^\s,]+)/iu;

function stripQuotes(value: string): string {
  return value.trim().replace(/^["`](.*)["`]$/u, "$1");
}

/** Normalise a default so `false`, `0` and `FALSE` compare equal across dialects. */
export function normaliseDefault(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = (
    typeof value === "object" ? JSON.stringify(value) : `${value as number | boolean | string}`
  )
    .trim()
    .replace(/^\((.*)\)$/u, "$1");
  const lower = text.toLowerCase();
  if (lower === "true") {
    return "1";
  }
  if (lower === "false") {
    return "0";
  }
  return text.replace(/^'(.*)'$/u, "$1");
}

function parseColumn(line: string): DdlColumn | null {
  const match = /^(?<name>"[^"]+"|`[^`]+`|\w+)\s+(?<rest>.+)$/u.exec(line);
  const rest = match?.groups?.["rest"];
  if (!match?.groups?.["name"] || rest === undefined) {
    return null;
  }
  const type = rest.split(TYPE_END)[0]?.trim() ?? "";
  const constraints = rest.slice(type.length);
  return {
    name: stripQuotes(match.groups["name"]),
    type,
    family: typeFamily(type),
    notNull: /\bNOT NULL\b/iu.test(constraints) || /\bPRIMARY KEY\b/iu.test(constraints),
    defaultValue: normaliseDefault(DEFAULT_CLAUSE.exec(constraints)?.groups?.["value"]),
    unique: /\bUNIQUE\b/iu.test(constraints) || /\bPRIMARY KEY\b/iu.test(constraints),
  };
}

function columnLines(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim().replace(/,$/u, ""))
    .filter((line) => line !== "" && !CONSTRAINT_PREFIX.test(line));
}

/** Parse every `CREATE TABLE` and `CREATE INDEX` statement of a DDL string. */
export function parseDdl(ddl: string): ParsedDdl {
  const tables = new Map<string, Map<string, DdlColumn>>();
  for (const match of ddl.matchAll(TABLE_BLOCK)) {
    const columns = new Map<string, DdlColumn>();
    for (const line of columnLines(match.groups?.["body"] ?? "")) {
      const column = parseColumn(line);
      if (column) {
        columns.set(column.name, column);
      }
    }
    tables.set(match.groups?.["table"] ?? "", columns);
  }
  const indexes = new Map<string, DdlIndex>();
  for (const match of ddl.matchAll(INDEX_STATEMENT)) {
    const name = match.groups?.["name"] ?? "";
    indexes.set(name, {
      name,
      table: match.groups?.["table"] ?? "",
      columns: (match.groups?.["columns"] ?? "").split(",").map((c) => stripQuotes(c)),
      unique: match.groups?.["unique"] !== undefined,
      where: match.groups?.["where"]?.trim() ?? null,
    });
  }
  return { tables, indexes };
}

interface DrizzleTable {
  name: string;
  config: DrizzleTableConfig;
}

function drizzleTables(
  exported: Record<string, unknown>,
  getConfig: GetTableConfig,
): Map<string, DrizzleTable> {
  const found = new Map<string, DrizzleTable>();
  for (const value of Object.values(exported)) {
    if (is(value, Table)) {
      found.set(getTableName(value), {
        name: getTableName(value),
        config: getConfig(value as never),
      });
    }
  }
  return found;
}

function allowed(
  allowances: readonly ParityAllowance[],
  used: Set<ParityAllowance>,
  table: string,
  column?: string,
  index?: string,
): boolean {
  const hit = allowances.find((a) => a.table === table && a.column === column && a.index === index);
  if (hit) {
    used.add(hit);
  }
  return hit !== undefined;
}

function sqlTypeOf(column: Column): string {
  return column.getSQLType();
}

function compareColumn(table: string, drizzle: Column, ddl: DdlColumn): string[] {
  const where = `${table}.${ddl.name}`;
  const problems: string[] = [];
  const family = typeFamily(sqlTypeOf(drizzle));
  if (family !== ddl.family) {
    problems.push(
      `${where}: DDL type ${ddl.type} (${ddl.family}) but Drizzle ${sqlTypeOf(drizzle)} (${family})`,
    );
  }
  if (drizzle.notNull !== ddl.notNull) {
    problems.push(`${where}: DDL ${ddl.notNull ? "NOT NULL" : "nullable"} but Drizzle differs`);
  }
  const drizzleDefault = drizzle.hasDefault && drizzle.default !== null;
  if (drizzleDefault !== (ddl.defaultValue !== null)) {
    problems.push(`${where}: default present in only one of DDL and Drizzle`);
  } else if (
    typeof drizzle.default !== "object" &&
    drizzle.default !== undefined &&
    normaliseDefault(drizzle.default) !== ddl.defaultValue
  ) {
    problems.push(
      `${where}: DDL default ${ddl.defaultValue} but Drizzle ${normaliseDefault(drizzle.default)}`,
    );
  }
  return problems;
}

function indexColumns(config: DrizzleTableConfig["indexes"][number]["config"]): string[] {
  return config.columns.map((c) => ("name" in c && typeof c.name === "string" ? c.name : "<sql>"));
}

function compareIndexes(
  parsed: ParsedDdl,
  tables: Map<string, DrizzleTable>,
  allowances: readonly ParityAllowance[],
  used: Set<ParityAllowance>,
): string[] {
  const problems: string[] = [];
  const drizzleIndexes = new Map<
    string,
    { table: string; cfg: DrizzleTableConfig["indexes"][number]["config"] }
  >();
  for (const [table, info] of tables) {
    for (const { config } of info.config.indexes) {
      drizzleIndexes.set(config.name, { table, cfg: config });
    }
  }
  for (const [name, ddl] of parsed.indexes) {
    if (!tables.has(ddl.table) || allowed(allowances, used, ddl.table, undefined, name)) {
      continue;
    }
    const peer = drizzleIndexes.get(name);
    if (!peer) {
      problems.push(`index ${name} (${ddl.table}) is in the DDL but not in Drizzle`);
    } else if (
      indexColumns(peer.cfg).join(",") !== ddl.columns.join(",") ||
      Boolean(peer.cfg.unique) !== ddl.unique ||
      (peer.cfg.where !== undefined) !== (ddl.where !== null)
    ) {
      problems.push(`index ${name}: columns, uniqueness or WHERE differ between DDL and Drizzle`);
    }
  }
  for (const [name, { table }] of drizzleIndexes) {
    if (!parsed.indexes.has(name) && !allowed(allowances, used, table, undefined, name)) {
      problems.push(`index ${name} (${table}) is in Drizzle but not in the DDL`);
    }
  }
  return problems;
}

export interface ParityInput {
  /** The dialect's `DDL` string. */
  ddl: string;
  /** The module namespace of the dialect's Drizzle schema (`import * as`). */
  schema: Record<string, unknown>;
  /** The dialect's `getTableConfig`. */
  getTableConfig: GetTableConfig;
  /** `CREATE INDEX` statements the migration code adds beyond `ddl` (see `indexStatementsIn`). */
  extraStatements?: readonly string[];
  /** Known differences; an entry that no longer applies is itself reported. */
  allowances?: readonly ParityAllowance[];
}

function compareTableSets(
  parsed: ParsedDdl,
  tables: Map<string, DrizzleTable>,
  allowances: readonly ParityAllowance[],
  used: Set<ParityAllowance>,
): string[] {
  const problems: string[] = [];
  for (const [table, ddlColumns] of parsed.tables) {
    const info = tables.get(table);
    if (!info) {
      if (!allowed(allowances, used, table)) {
        problems.push(`table ${table} is in the DDL but has no Drizzle schema`);
      }
      continue;
    }
    const drizzleColumns = new Map(info.config.columns.map((c) => [c.name, c]));
    for (const [name, column] of ddlColumns) {
      const peer = drizzleColumns.get(name);
      if (peer) {
        problems.push(...compareColumn(table, peer, column));
      } else if (!allowed(allowances, used, table, name)) {
        problems.push(`${table}.${name} is in the DDL but not in Drizzle`);
      }
    }
    for (const name of drizzleColumns.keys()) {
      if (!ddlColumns.has(name) && !allowed(allowances, used, table, name)) {
        problems.push(`${table}.${name} is in Drizzle but not in the DDL`);
      }
    }
  }
  for (const table of tables.keys()) {
    if (!parsed.tables.has(table) && !allowed(allowances, used, table)) {
      problems.push(`table ${table} has a Drizzle schema but no DDL`);
    }
  }
  return problems;
}

/** The `CREATE [UNIQUE] INDEX` string literals in a migration source file. */
export function indexStatementsIn(source: string): string[] {
  return [...source.matchAll(/"(?<sql>CREATE (?:UNIQUE )?INDEX [^"]+)"/gu)].map(
    (m) => m.groups?.["sql"] ?? "",
  );
}

/** Disagreements between a dialect's DDL and its Drizzle schema. Empty when they agree. */
export function compareDdlWithDrizzle(input: ParityInput): string[] {
  const parsed = parseDdl(
    [input.ddl, ...(input.extraStatements ?? []).map((s) => `${s};`)].join("\n"),
  );
  const tables = drizzleTables(input.schema, input.getTableConfig);
  const allowances = input.allowances ?? [];
  const used = new Set<ParityAllowance>();
  const problems = [
    ...compareTableSets(parsed, tables, allowances, used),
    ...compareIndexes(parsed, tables, allowances, used),
  ];
  for (const stale of allowances.filter((a) => !used.has(a))) {
    problems.push(
      `stale allowance for ${stale.table}${stale.column ? `.${stale.column}` : ""}${stale.index ? ` (${stale.index})` : ""}: remove it (${stale.issue})`,
    );
  }
  return problems;
}

/** Row interface name → table name, for every core row type stored in a table. */
export type CoreRowTables = Readonly<Record<string, string>>;

/** Read the field names of every exported `interface` in a directory of `.ts` files. */
export function readCoreRowFields(schemaDir: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const file of readdirSync(schemaDir).filter(
    (f) => f.endsWith(".ts") && !f.includes(".test."),
  )) {
    const source = readFileSync(join(schemaDir, file), "utf8");
    for (const match of source.matchAll(
      /export interface (?<name>\w+)[^{]*\{(?<body>[\s\S]*?)\n\}/gu,
    )) {
      const fields = [...(match.groups?.["body"] ?? "").matchAll(/^ {2}(?<field>\w+)\??:/gmu)].map(
        (m) => m.groups?.["field"] ?? "",
      );
      rows.set(match.groups?.["name"] ?? "", fields);
    }
  }
  return rows;
}

export interface CoreParityInput {
  /** Directory of `packages/core/src/schema`. */
  schemaDir: string;
  rowTables: CoreRowTables;
  schema: Record<string, unknown>;
  getTableConfig: GetTableConfig;
  /** Core fields known to have no column in this dialect (`table` + `column` = the field name). */
  allowances?: readonly ParityAllowance[];
}

function propertyNames(config: DrizzleTableConfig, schema: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const value of Object.values(schema)) {
    if (is(value, Table) && getTableName(value) === config.name) {
      for (const key of Object.keys(getTableColumns(value))) {
        names.add(key);
      }
    }
  }
  return names;
}

/** Core row fields that have no column in this dialect. Empty when every field maps. */
export function compareCoreRowsWithDrizzle(input: CoreParityInput): string[] {
  const rows = readCoreRowFields(input.schemaDir);
  const tables = drizzleTables(input.schema, input.getTableConfig);
  const allowances = input.allowances ?? [];
  const used = new Set<ParityAllowance>();
  const problems: string[] = [];
  for (const [rowName, tableName] of Object.entries(input.rowTables)) {
    const fields = rows.get(rowName);
    const info = tables.get(tableName);
    if (!fields) {
      problems.push(`core row type ${rowName} not found in ${input.schemaDir}`);
    } else if (!info) {
      if (!allowed(allowances, used, tableName)) {
        problems.push(`core row ${rowName}: table ${tableName} has no Drizzle schema`);
      }
    } else {
      const keys = propertyNames(info.config, input.schema);
      for (const field of fields.filter((f) => !keys.has(f))) {
        if (!allowed(allowances, used, tableName, field)) {
          problems.push(`core ${rowName}.${field} has no column in ${tableName}`);
        }
      }
    }
  }
  for (const stale of allowances.filter((a) => !used.has(a))) {
    problems.push(
      `stale core allowance for ${stale.table}.${stale.column ?? ""}: remove it (${stale.issue})`,
    );
  }
  return problems;
}

/** Every core row interface stored in a table, and the table that stores it. */
export const CORE_ROW_TABLES: CoreRowTables = {
  Baseline: "baselines",
  Build: "builds",
  BuildComponent: "build_components",
  BuildReview: "build_reviews",
  CaptureAttempt: "capture_attempts",
  CaptureLog: "capture_logs",
  CaptureJobRow: "capture_jobs",
  CaptureShard: "capture_shards",
  Comment: "comments",
  UserConnection: "user_connections",
  ContentUse: "content_uses",
  DesignLink: "design_links",
  DesignCredential: "design_credentials",
  DesignNode: "design_nodes",
  InsightRow: "insights",
  AiUsageRow: "ai_usage",
  AiBudgetAlertRow: "ai_budget_alerts",
  LabelType: "label_types",
  BuildLabel: "build_labels",
  ProjectMember: "project_members",
  NotificationChannelRow: "notification_channels",
  NotificationSubscriptionRow: "notification_subscriptions",
  PushSubscriptionRow: "push_subscriptions",
  ProjectGroupMapping: "project_group_mappings",
  Project: "projects",
  SchemaMeta: "schema_meta",
  SiteSetting: "site_settings",
  Snapshot: "snapshots",
  Token: "tokens",
  ProjectLink: "project_links",
  BuildPackageUsage: "build_package_usage",
  User: "users",
  Webhook: "webhooks",
};

/**
 * Tables and columns every dialect's DDL must carry, so a gap in one dialect
 * (MySQL retention until #376) is a named, allowlisted difference and not an
 * unnoticed one. Every table that stores a core row type is required as well.
 */
export const REQUIRED_DDL: { tables: readonly string[]; columns: readonly [string, string][] } = {
  // ADR 0039 lifecycle tables: DDL only, read and written with the capability's own SQL.
  tables: [
    ...Object.values(CORE_ROW_TABLES),
    "user_invite_tokens",
    "build_references",
    "build_reference_generations",
    "build_deletions",
    "build_content_releases",
  ],
  columns: [["builds", "retention_state"]],
};

/** Required tables and columns missing from a dialect's DDL. */
export function compareRequiredWithDdl(
  ddl: string,
  allowances: readonly ParityAllowance[] = [],
): string[] {
  const { tables } = parseDdl(ddl);
  const used = new Set<ParityAllowance>();
  const problems: string[] = [];
  for (const table of REQUIRED_DDL.tables) {
    if (!tables.has(table) && !allowed(allowances, used, table)) {
      problems.push(`required table ${table} is missing from the DDL`);
    }
  }
  for (const [table, column] of REQUIRED_DDL.columns) {
    if (
      tables.has(table) &&
      !tables.get(table)?.has(column) &&
      !allowed(allowances, used, table, column)
    ) {
      problems.push(`required column ${table}.${column} is missing from the DDL`);
    }
  }
  for (const stale of allowances.filter((a) => !used.has(a))) {
    problems.push(
      `stale required-DDL allowance for ${stale.table}${stale.column ? `.${stale.column}` : ""}: remove it (${stale.issue})`,
    );
  }
  return problems;
}
