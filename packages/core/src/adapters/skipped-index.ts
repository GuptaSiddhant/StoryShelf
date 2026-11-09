/**
 * A unique index a migration could not build because existing rows already repeat its key. The
 * database boots without it (an upgrade must not be blocked by old data), says so once at `error`,
 * and tries again on the next boot, so the index lands as soon as the data is clean.
 */
import type { Logger } from "../logger.ts";

/** What a driver learned when a unique index could not be built. */
export interface SkippedIndex {
  readonly table: string;
  readonly index: string;
  /** The indexed columns, as written in the `CREATE UNIQUE INDEX` statement. */
  readonly columns: string;
  /** How many keys occur more than once. */
  readonly duplicateGroups: number;
}

/** What a driver's `migrate` is given by its lifecycle `setup`. */
export interface MigrationContext {
  readonly logger?: Logger | undefined;
}

/** The `CREATE UNIQUE INDEX` parts a driver needs to report a skip, or `null` for another statement. */
export function parseUniqueIndex(
  statement: string,
): { index: string; table: string; columns: string } | null {
  const match =
    /^CREATE UNIQUE INDEX(?: IF NOT EXISTS)? (?<index>\w+) ON (?<table>\w+) ?\((?<columns>[^)]+)\)/u.exec(
      statement,
    );
  const groups = match?.groups;
  if (groups?.["index"] === undefined || groups["table"] === undefined) return null;
  return { index: groups["index"], table: groups["table"], columns: groups["columns"] ?? "" };
}

/** The query that counts how many keys of `columns` occur more than once in `table`. */
export function duplicateGroupsSql(table: string, columns: string): string {
  return `SELECT COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM ${table} GROUP BY ${columns} HAVING COUNT(*) > 1) AS repeated`;
}

/**
 * Log, once, that `skipped.index` was not built: the table, the index and the number of repeated
 * keys, never a row, and how to fix it. Without a logger (a bare adapter in a test) it says nothing.
 */
export function logSkippedIndex(logger: Logger | undefined, skipped: SkippedIndex): void {
  const { table, index, columns, duplicateGroups } = skipped;
  logger?.error(
    { table, index, duplicateGroups },
    `Unique index ${index} on ${table} was not created: ${String(duplicateGroups)} key(s) of ` +
      `(${columns}) occur more than once, so the database runs without it and duplicates can still ` +
      `be written. Find them with: SELECT ${columns}, COUNT(*) FROM ${table} GROUP BY ${columns} ` +
      `HAVING COUNT(*) > 1. Remove or merge the extra rows and restart: the index is created on ` +
      `the next boot.`,
  );
}
