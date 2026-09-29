/**
 * Better Auth Where[] to drizzle conditions.
 *
 * Operators covered: eq, ne, lt, lte, gt, gte, in, not_in, contains,
 * starts_with, ends_with. Connectors AND/OR (default AND). Case-insensitive
 * mode lowers both sides (portable across sqlite and Postgres). Unknown
 * fields fail fast — silent ignores would corrupt auth lookups.
 */
import type { Where } from "better-auth";
import type { SQL, Table } from "drizzle-orm";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";

function columnOf(table: Table, field: string): SQL {
  const column = getTableColumns(table)[field] as SQL | undefined;
  if (!column) {
    throw new Error(`Unknown auth field "${field}"`);
  }
  return column;
}

function lowered(column: SQL): SQL {
  return sql`lower(${column})`;
}

/** Escape LIKE metacharacters so user input matches literally. */
function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function patternValue(operator: string, value: string): string {
  const literal = escapeLike(value);
  if (operator === "contains") {
    return `%${literal}%`;
  }
  if (operator === "starts_with") {
    return `${literal}%`;
  }
  return `%${literal}`;
}

/** LIKE with an explicit escape (sqlite has no default escape character). */
function likeEscaped(target: SQL, pattern: string): SQL {
  return sql`${target} LIKE ${pattern} ESCAPE '\\'`;
}

function singleCondition(table: Table, item: Where): SQL {
  const column = columnOf(table, item.field);
  const operator = item.operator ?? "eq";
  const raw =
    typeof item.value === "string" && item.mode === "insensitive"
      ? item.value.toLowerCase()
      : item.value;
  const target =
    typeof item.value === "string" && item.mode === "insensitive" ? lowered(column) : column;
  const value = toDriverScalar(raw);
  switch (operator) {
    case "eq":
      return eq(target, value);
    case "ne":
      return ne(target, value);
    case "lt":
      return lt(target, value as string | number);
    case "lte":
      return lte(target, value as string | number);
    case "gt":
      return gt(target, value as string | number);
    case "gte":
      return gte(target, value as string | number);
    case "in":
      return inArray(target, toArray(value));
    case "not_in":
      return not(inArray(target, toArray(value)));
    case "contains":
    case "starts_with":
    case "ends_with":
      return likeEscaped(target, patternValue(operator, String(raw ?? "")));
    default:
      throw new Error(`Unsupported auth where operator "${String(operator)}"`);
  }
}

function toArray(value: unknown): (string | number)[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Auth where `in` operator needs an array value");
  }
  return value as (string | number)[];
}

function toDriverScalar(value: Where["value"]): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

/** Split items into AND-groups at OR connectors (SQL precedence). */
function splitOrGroups(table: Table, where: readonly Where[]): SQL[][] {
  const groups: SQL[][] = [];
  let current: SQL[] = [];
  for (const [index, item] of where.entries()) {
    if (index > 0 && item.connector === "OR") {
      groups.push(current);
      current = [];
    }
    current.push(singleCondition(table, item));
  }
  groups.push(current);
  return groups;
}

/** Combine Where[] items with their connectors into one condition. */
export function buildCondition(table: Table, where: readonly Where[]): SQL | undefined {
  if (where.length === 0) {
    return undefined;
  }
  return or(...splitOrGroups(table, where).map((group) => and(...group)));
}

/** Build an order-by clause from a sort descriptor. */
export function buildOrderBy(
  table: Table,
  sortBy: { field: string; direction: "asc" | "desc" } | undefined,
): SQL | undefined {
  if (!sortBy) {
    return undefined;
  }
  const column = columnOf(table, sortBy.field);
  return sortBy.direction === "desc" ? desc(column) : asc(column);
}
