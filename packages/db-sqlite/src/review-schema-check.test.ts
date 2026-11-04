import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { assertReviewSchema } from "./review-schema-check.ts";
import { parseTableInfo, type TableInfoReader } from "./table-info.ts";

/** An in-memory database opened as the adapter opens it (rows as arrays), with the given tables. */
function readerFor(...statements: string[]): TableInfoReader {
  const sqlite = new DatabaseSync(":memory:", { returnArrays: true });
  for (const statement of statements) {
    sqlite.exec(statement);
  }
  return async (table) =>
    await Promise.resolve(parseTableInfo(sqlite.prepare(`PRAGMA table_info(${table})`).all()));
}

const SETTINGS = [
  "CREATE TABLE projects (id TEXT, review_enabled INTEGER NOT NULL DEFAULT 1, review_approvals INTEGER NOT NULL DEFAULT 1, run_a11y INTEGER NOT NULL DEFAULT 1)",
  "CREATE TABLE builds (id TEXT, review_cycle INTEGER NOT NULL DEFAULT 0, review_requested_cycle INTEGER)",
];
const SNAPSHOTS = "CREATE TABLE snapshots (id TEXT, a11y_violations TEXT)";
const REVIEWS =
  "CREATE TABLE build_reviews (id TEXT, build_id TEXT, user_id TEXT, verdict TEXT, body TEXT, created_at TEXT)";

describe("assertReviewSchema", () => {
  it("passes on a database with no review table or columns", async () => {
    const read = readerFor("CREATE TABLE projects (id TEXT)", "CREATE TABLE builds (id TEXT)");
    await expect(assertReviewSchema(read)).resolves.toBeUndefined();
  });

  it("passes on an empty database", async () => {
    await expect(assertReviewSchema(readerFor())).resolves.toBeUndefined();
  });

  it("passes on a complete, matching schema", async () => {
    await expect(
      assertReviewSchema(readerFor(...SETTINGS, SNAPSHOTS, REVIEWS)),
    ).resolves.toBeUndefined();
  });

  it("names the table and the missing column of a build_reviews table without a required one", async () => {
    const read = readerFor(
      ...SETTINGS,
      "CREATE TABLE build_reviews (id TEXT, user_id TEXT, verdict TEXT, body TEXT, created_at TEXT)",
    );
    await expect(assertReviewSchema(read)).rejects.toThrow(
      "table build_reviews has no column build_id",
    );
  });

  it("also requires the reviewer and body columns", async () => {
    const read = readerFor(
      ...SETTINGS,
      "CREATE TABLE build_reviews (id TEXT, build_id TEXT, verdict TEXT, created_at TEXT)",
    );
    await expect(assertReviewSchema(read)).rejects.toThrow(
      "table build_reviews has no column user_id",
    );
  });

  it("requires the body column", async () => {
    const read = readerFor(
      ...SETTINGS,
      "CREATE TABLE build_reviews (id TEXT, build_id TEXT, user_id TEXT, verdict TEXT, created_at TEXT)",
    );
    await expect(assertReviewSchema(read)).rejects.toThrow(
      "table build_reviews has no column body",
    );
  });

  it("compares column names without regard to case, as SQLite does", async () => {
    const read = readerFor(
      ...SETTINGS,
      "CREATE TABLE build_reviews (ID TEXT, BUILD_ID TEXT, USER_ID TEXT, VERDICT TEXT, BODY TEXT, CREATED_AT TEXT)",
    );
    await expect(assertReviewSchema(read)).resolves.toBeUndefined();
  });

  it("names the table, column and types of a review column of another type", async () => {
    const read = readerFor(
      "CREATE TABLE projects (id TEXT, review_approvals TEXT)",
      "CREATE TABLE builds (id TEXT)",
    );
    await expect(assertReviewSchema(read)).rejects.toThrow(
      "column projects.review_approvals has type TEXT, expected INTEGER",
    );
  });

  it("names the accessibility switch when it has another type", async () => {
    const read = readerFor("CREATE TABLE projects (id TEXT, run_a11y TEXT)");
    await expect(assertReviewSchema(read)).rejects.toThrow(
      "Cannot upgrade the schema: column projects.run_a11y has type TEXT, expected INTEGER",
    );
  });

  it("names the stored findings column when it has another type", async () => {
    const read = readerFor("CREATE TABLE snapshots (id TEXT, a11y_violations INTEGER)");
    await expect(assertReviewSchema(read)).rejects.toThrow(
      "column snapshots.a11y_violations has type INTEGER, expected TEXT",
    );
  });

  it("reads all four tables, whatever order the reader answers in", async () => {
    const asked: string[] = [];
    const read: TableInfoReader = async (table) => {
      asked.push(table);
      return await Promise.resolve(new Map());
    };
    await assertReviewSchema(read);
    expect(asked.toSorted()).toEqual(["build_reviews", "builds", "projects", "snapshots"]);
  });
});
