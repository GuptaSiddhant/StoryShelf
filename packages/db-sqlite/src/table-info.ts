/**
 * Read `PRAGMA table_info` the same way on every SQLite client. The clients differ in the shape of
 * a row (`node:sqlite` with `returnArrays` gives `[cid, name, type, ...]`; `better-sqlite3`,
 * `bun:sqlite`, D1 and libSQL give `{ name, type, ... }`) and in being sync or async, so each
 * preset fetches the rows its own way and this turns them into one map: column name → declared
 * type, upper-cased. A table that does not exist has no rows, so the map is empty.
 */

/** Column name → declared type (upper case). */
export type TableColumns = Map<string, string>;

/** Reads the columns of one table; async so D1 and libSQL fit. */
export type TableInfoReader = (table: string) => Promise<TableColumns>;

function rowColumn(row: unknown): [string, string] | undefined {
  if (Array.isArray(row)) {
    return [String(row[1]).toLowerCase(), String(row[2] ?? "").toUpperCase()];
  }
  if (typeof row === "object" && row !== null) {
    const { name, type } = row as { name?: unknown; type?: unknown };
    return typeof name === "string"
      ? [name.toLowerCase(), typeof type === "string" ? type.toUpperCase() : ""]
      : undefined;
  }
  return undefined;
}

/** The columns described by the rows of `PRAGMA table_info(<table>)`. */
export function parseTableInfo(rows: readonly unknown[]): TableColumns {
  const columns = rows.map((row) => rowColumn(row)).filter((column) => column !== undefined);
  return new Map(columns);
}
