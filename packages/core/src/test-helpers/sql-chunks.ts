import { getTableColumns, type SQL, type Table } from "drizzle-orm";

/* eslint-disable require-await, no-unnecessary-type-assertion, no-unnecessary-type-parameters, non-nullable-type-assertion-style */

/** A drizzle SQL chunk inspected for matching and ordering. */
export interface SqlChunk {
  value?: unknown;
  name?: string;
  table?: unknown;
  brand?: unknown;
  queryChunks?: SqlChunk[];
}

/** Flatten the string parts of a drizzle SQL chunk into a single string. */
function textOf(chunk: SqlChunk | undefined): string | undefined {
  if (
    chunk === undefined ||
    !Array.isArray(chunk.value) ||
    !chunk.value.every((part) => typeof part === "string")
  ) {
    return undefined;
  }
  return chunk.value.join("");
}

/** Test whether an in-memory row satisfies a drizzle where-clause. */
export function whereMatches(where: SQL, row: Record<string, unknown>, table: Table): boolean {
  let current = where.queryChunks as unknown as SqlChunk[];
  let wrapped = current[1]?.queryChunks;
  while (wrapped !== undefined && textOf(current[0]) === "(" && textOf(current.at(-1)) === ")") {
    current = wrapped;
    wrapped = current[1]?.queryChunks;
  }
  // Drizzle's `and(singleCondition)` emits the condition directly, without
  // the enclosing parens produced for two or more clauses, so unwrap it.
  if (current.length === 1 && current[0]?.queryChunks !== undefined) {
    current = current[0].queryChunks as unknown as SqlChunk[];
  }
  if (current.some((chunk) => textOf(chunk)?.trim() === "and")) {
    return current
      .filter((chunk) => textOf(chunk) === undefined)
      .every((chunk) => matchChunk(chunk.queryChunks ?? [], row, table));
  }
  return matchChunk(current, row, table);
}

function matchChunk(chunks: SqlChunk[], row: Record<string, unknown>, table: Table): boolean {
  const text = chunks.map((c) => textOf(c) ?? "").join("");
  if (text.includes(" in ")) {
    return inArrayMatches(chunks, row, table);
  }
  if (text.includes(" < ")) {
    return ltMatches(chunks, row, table);
  }
  return eqMatches(chunks, row, table);
}

function eqMatches(chunks: SqlChunk[], row: Record<string, unknown>, table: Table): boolean {
  let columnName: string | undefined;
  let argument: unknown;
  for (const chunk of chunks) {
    if (typeof chunk.name === "string" && chunk.table !== undefined) {
      columnName = chunk.name;
    } else if ("brand" in chunk) {
      argument = chunk.value;
    }
  }
  if (columnName === undefined) {
    return false;
  }
  return row[columnKey(table, columnName)] === argument;
}

/* eslint-disable complexity, max-depth -- handles drizzle's varied chunk shapes */
function inArrayMatches(chunks: SqlChunk[], row: Record<string, unknown>, table: Table): boolean {
  let columnName: string | undefined;
  const values: unknown[] = [];
  const collect = (nodes: unknown[]): void => {
    for (const raw of nodes as SqlChunk[]) {
      const chunk = raw as SqlChunk & Record<string, unknown>;
      // Handle array-like chunk (inArray values stored as array of chunks)
      if (
        Array.isArray(chunk) ||
        (chunk && typeof chunk === "object" && Object.keys(chunk).every((k) => /^\d+$/u.test(k)))
      ) {
        collect(Object.values(chunk as unknown as Record<string, unknown>) as unknown[]);
        continue;
      }
      if (typeof chunk.name === "string" && chunk.table !== undefined) {
        columnName = chunk.name as string;
      }
      if ("brand" in chunk && (chunk as Record<string, unknown>)["value"] !== undefined) {
        const val = (chunk as Record<string, unknown>)["value"];
        if (Array.isArray(val)) {
          values.push(...(val as unknown[]));
        } else {
          values.push(val);
        }
      }
      if (chunk.queryChunks) {
        collect(chunk.queryChunks as unknown[]);
      }
      const val = (chunk as Record<string, unknown>)["value"];
      if (Array.isArray(val)) {
        for (const item of val as unknown[]) {
          if (
            item &&
            typeof item === "object" &&
            "queryChunks" in (item as Record<string, unknown>)
          ) {
            collect(((item as Record<string, unknown>)["queryChunks"] as unknown[]) ?? []);
          }
          if (item && typeof item === "object" && "value" in (item as Record<string, unknown>)) {
            const iv = (item as Record<string, unknown>)["value"];
            if (iv !== undefined) {
              values.push(iv);
            }
          }
          if (typeof item === "string") {
            values.push(item);
          }
        }
      }
    }
  };
  collect(chunks as unknown[]);
  if (columnName === undefined) {
    return false;
  }
  const key = columnKey(table, columnName);
  return values.includes(row[key]);
}
/* eslint-enable complexity, max-depth */

function ltMatches(chunks: SqlChunk[], row: Record<string, unknown>, table: Table): boolean {
  let columnName: string | undefined;
  let argument: unknown;
  for (const chunk of chunks) {
    if (typeof chunk.name === "string" && chunk.table !== undefined) {
      columnName = chunk.name;
    } else if ("brand" in chunk) {
      argument = chunk.value;
    }
  }
  if (columnName === undefined) {
    return false;
  }
  const key = columnKey(table, columnName);
  const cell = row[key];
  if (typeof cell === "string" && typeof argument === "string") {
    return cell < argument;
  }
  if (typeof cell === "number" && typeof argument === "number") {
    return cell < argument;
  }
  return String(cell) < String(argument);
}

function compareCells(left: unknown, right: unknown): number {
  if (typeof left === "string" && typeof right === "string") {
    if (left === right) {
      return 0;
    }
    return left < right ? -1 : 1;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  const leftText = String(left);
  const rightText = String(right);
  if (leftText === rightText) {
    return 0;
  }
  return leftText < rightText ? -1 : 1;
}

/** Collect every raw string part of a drizzle SQL chunk tree. */
function sqlText(nodes: SqlChunk[]): string {
  return nodes
    .map((node) => {
      const own = textOf(node) ?? "";
      const nested = node.queryChunks ? sqlText(node.queryChunks as unknown as SqlChunk[]) : "";
      return own + nested;
    })
    .join("");
}

/** Find the ordered column reference in a drizzle order-by expression. */
function findOrderColumn(nodes: SqlChunk[]): string | undefined {
  for (const node of nodes) {
    if (typeof node.name === "string" && node.table !== undefined) {
      return node.name;
    }
    if (node.queryChunks) {
      const nested = findOrderColumn(node.queryChunks as unknown as SqlChunk[]);
      if (nested !== undefined) {
        return nested;
      }
    }
  }
  return undefined;
}

/** Sort rows per a drizzle order-by expression (single-column asc/desc). */
export function orderRows(rows: unknown[], orderBy: SQL, table: Table): unknown[] {
  const chunks = orderBy.queryChunks as unknown as SqlChunk[];
  const columnName = findOrderColumn(chunks);
  if (columnName === undefined) {
    return rows;
  }
  const key = columnKey(table, columnName);
  const descending = /desc/iu.test(sqlText(chunks));
  return rows.toSorted((left, right) => {
    const order = compareCells(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
    );
    return descending ? -order : order;
  });
}

function columnKey(table: Table, dbName: string): string {
  for (const [property, column] of Object.entries(getTableColumns(table))) {
    if (column.name === dbName) {
      return property;
    }
  }
  return dbName;
}
/* eslint-enable require-await, no-unnecessary-type-assertion, no-unnecessary-type-parameters, non-nullable-type-assertion-style */
