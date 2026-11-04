/**
 * Which errors an idempotent migration statement may skip. A statement that is already done raises
 * one specific error; everything else (a lock timeout, a permission error, a full disk, a statement
 * the engine rejects) must stop the boot, because carrying on leaves the schema short of what the
 * code reads and the failure surfaces later at run time. Drivers word these errors differently
 * (node:sqlite, better-sqlite3, libSQL and D1 all pass SQLite's message through), so they are
 * matched by their text, which SQLite has kept stable.
 */
import {
  duplicateGroupsSql,
  logSkippedIndex,
  parseUniqueIndex,
} from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";

/** Whether an error is one a migration statement may skip. */
export type ErrorTest = (error: unknown) => boolean;

function textOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `ADD COLUMN` of a column that exists: another boot added it between the check and the ALTER. */
export const isDuplicateColumn: ErrorTest = (error) =>
  /duplicate column name/iu.test(textOf(error));

/** `DROP COLUMN` of a column that is already gone: the migration ran before. */
export const isMissingColumn: ErrorTest = (error) => /no such column/iu.test(textOf(error));

/** A unique index over rows that already repeat its key (SQLITE_CONSTRAINT_UNIQUE). */
export const isUniqueViolation: ErrorTest = (error) => {
  const code = (error as { code?: unknown; errcode?: unknown } | null)?.code;
  const errcode = (error as { errcode?: unknown } | null)?.errcode;
  return (
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    errcode === 2067 ||
    /UNIQUE constraint failed/iu.test(textOf(error))
  );
};

/**
 * For an identity statement: only the creation of a unique index may be skipped, and only for
 * duplicates. The single-flight index is never skipped: without it the database no longer holds one
 * active job per key, so duplicate keys must stop the boot (as they do on Postgres).
 */
export function toleratedFor(statement: string): ErrorTest {
  const skippable =
    statement.startsWith("CREATE UNIQUE INDEX") &&
    !statement.includes("capture_jobs_active_key_idx");
  return skippable ? isUniqueViolation : () => false;
}

/** Run a statement, skipping only the error `tolerated` names (resolves true then); any other failure propagates. */
export function execUnless(
  database: { exec(sql: string): unknown },
  sql: string,
  tolerated: ErrorTest,
): boolean {
  try {
    database.exec(sql);
    return false;
  } catch (error) {
    if (!tolerated(error)) throw error;
    return true;
  }
}

/** {@link execUnless} for a driver whose statements are asynchronous. */
export async function execUnlessAsync(
  exec: (sql: string) => Promise<unknown>,
  sql: string,
  tolerated: ErrorTest,
): Promise<boolean> {
  try {
    await exec(sql);
    return false;
  } catch (error) {
    if (!tolerated(error)) throw error;
    return true;
  }
}

/** Say, once, that the unique index `statement` creates was skipped; `count` runs the group count. */
export function reportSkippedIndex(
  statement: string,
  count: (sql: string) => number,
  logger: Logger | undefined,
): void {
  const parsed = parseUniqueIndex(statement);
  if (parsed === null) return;
  const duplicateGroups = count(duplicateGroupsSql(parsed.table, parsed.columns));
  logSkippedIndex(logger, { ...parsed, duplicateGroups });
}

/** {@link reportSkippedIndex} for a driver whose queries are asynchronous. */
export async function reportSkippedIndexAsync(
  statement: string,
  count: (sql: string) => Promise<number>,
  logger: Logger | undefined,
): Promise<void> {
  const parsed = parseUniqueIndex(statement);
  if (parsed === null) return;
  const duplicateGroups = await count(duplicateGroupsSql(parsed.table, parsed.columns));
  logSkippedIndex(logger, { ...parsed, duplicateGroups });
}
