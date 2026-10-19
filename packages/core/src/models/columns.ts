import { getTableColumns } from "drizzle-orm";
import type { Column, Table } from "drizzle-orm";

/**
 * Column handle for query builders (`eq`, `inArray`, `desc`, …) from a table
 * handle and a property name. Throws on an unknown name instead of letting
 * `undefined` reach the query builder.
 */
export function col(table: Table, name: string): Column {
  const column = getTableColumns(table)[name];
  if (!column) {
    throw new Error(`Unknown column "${name}"`);
  }
  return column as Column;
}
