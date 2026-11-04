/**
 * Which errors an idempotent migration statement may skip. A statement that is already done raises
 * one specific error; everything else (a lock timeout, a permission error, a full disk, a statement
 * the engine rejects) must stop the boot, because carrying on leaves the schema short of what the
 * code reads and the failure surfaces later at run time. Drivers word these errors differently
 * (node:sqlite, better-sqlite3, libSQL and D1 all pass SQLite's message through), so they are
 * matched by their text, which SQLite has kept stable.
 */

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

/** Run a statement, skipping only the error `tolerated` names; any other failure propagates. */
export function execUnless(
  database: { exec(sql: string): unknown },
  sql: string,
  tolerated: ErrorTest,
): void {
  try {
    database.exec(sql);
  } catch (error) {
    if (!tolerated(error)) throw error;
  }
}

/** {@link execUnless} for a driver whose statements are asynchronous. */
export async function execUnlessAsync(
  exec: (sql: string) => Promise<unknown>,
  sql: string,
  tolerated: ErrorTest,
): Promise<void> {
  try {
    await exec(sql);
  } catch (error) {
    if (!tolerated(error)) throw error;
  }
}
