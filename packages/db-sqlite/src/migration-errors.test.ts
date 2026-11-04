import { describe, expect, it } from "vitest";
import {
  execUnless,
  execUnlessAsync,
  isDuplicateColumn,
  isMissingColumn,
  isUniqueViolation,
  toleratedFor,
} from "./migration-errors.ts";

describe("which errors a migration statement may skip", () => {
  it("recognises a column that already exists, in the wording of every driver", () => {
    expect(isDuplicateColumn(new Error("duplicate column name: duration_ms"))).toBe(true);
    expect(isDuplicateColumn(new Error("SQLite error: duplicate column name: x"))).toBe(true);
    expect(isDuplicateColumn(new Error("D1_ERROR: duplicate column name: x: SQLITE_ERROR"))).toBe(
      true,
    );
    expect(isDuplicateColumn(new Error("database is locked"))).toBe(false);
    expect(isDuplicateColumn("duplicate column name: x")).toBe(true);
  });

  it("recognises a column that is already gone", () => {
    expect(isMissingColumn(new Error('no such column: "secret"'))).toBe(true);
    expect(isMissingColumn(new Error("no such table: webhooks"))).toBe(false);
  });

  it("recognises a unique violation by code, error code or message, and nothing else", () => {
    expect(
      isUniqueViolation(Object.assign(new Error("x"), { code: "SQLITE_CONSTRAINT_UNIQUE" })),
    ).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error("x"), { errcode: 2067 }))).toBe(true);
    expect(isUniqueViolation(new Error("UNIQUE constraint failed: design_links.import_path"))).toBe(
      true,
    );
    expect(isUniqueViolation(Object.assign(new Error("x"), { code: "SQLITE_BUSY" }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it("tolerates a unique violation only for the creation of a unique index", () => {
    const violation = new Error("UNIQUE constraint failed: t.c");

    expect(toleratedFor("CREATE UNIQUE INDEX IF NOT EXISTS i ON t (c)")(violation)).toBe(true);
    expect(toleratedFor("CREATE INDEX IF NOT EXISTS i ON t (c)")(violation)).toBe(false);
    // The single-flight index is never skipped.
    expect(
      toleratedFor(
        "CREATE UNIQUE INDEX IF NOT EXISTS capture_jobs_active_key_idx ON capture_jobs (active_key)",
      )(violation),
    ).toBe(false);
    expect(toleratedFor("DROP INDEX IF EXISTS i")(violation)).toBe(false);
  });
});

const failing = (error: Error) => ({
  exec: () => {
    throw error;
  },
});

const rejecting = (error: Error) => async () => await Promise.reject(error);

describe("execUnless", () => {
  it("skips the tolerated error and passes every other one on", () => {
    expect(() =>
      execUnless(failing(new Error("duplicate column name: x")), "ALTER", isDuplicateColumn),
    ).not.toThrow();
    expect(() =>
      execUnless(failing(new Error("database is locked")), "ALTER", isDuplicateColumn),
    ).toThrow("database is locked");
  });

  it("does the same for an asynchronous driver", async () => {
    await expect(
      execUnlessAsync(rejecting(new Error("duplicate column name: x")), "ALTER", isDuplicateColumn),
    ).resolves.toBeUndefined();
    await expect(
      execUnlessAsync(rejecting(new Error("disk I/O error")), "ALTER", isDuplicateColumn),
    ).rejects.toThrow("disk I/O error");
  });
});
