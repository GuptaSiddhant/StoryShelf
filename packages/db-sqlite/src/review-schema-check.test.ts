import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { assertReviewSchema } from "./review-schema-check.ts";

/** An in-memory database opened as the adapter opens it (rows as arrays), with the given tables. */
function database(...statements: string[]): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:", { returnArrays: true });
  for (const statement of statements) {
    sqlite.exec(statement);
  }
  return sqlite;
}

const SETTINGS = [
  "CREATE TABLE projects (id TEXT, review_enabled INTEGER NOT NULL DEFAULT 1, review_approvals INTEGER NOT NULL DEFAULT 1)",
  "CREATE TABLE builds (id TEXT, review_cycle INTEGER NOT NULL DEFAULT 0, review_requested_cycle INTEGER)",
];
const REVIEWS =
  "CREATE TABLE build_reviews (id TEXT, build_id TEXT, user_id TEXT, verdict TEXT, body TEXT, created_at TEXT)";

describe("assertReviewSchema", () => {
  it("passes on a database with no review table or columns", () => {
    expect(() => {
      assertReviewSchema(
        database("CREATE TABLE projects (id TEXT)", "CREATE TABLE builds (id TEXT)"),
      );
    }).not.toThrow();
  });

  it("passes on an empty database", () => {
    expect(() => {
      assertReviewSchema(database());
    }).not.toThrow();
  });

  it("passes on a complete, matching schema", () => {
    expect(() => {
      assertReviewSchema(database(...SETTINGS, REVIEWS));
    }).not.toThrow();
  });

  it("names the table and the missing column of a build_reviews table without a required one", () => {
    const sqlite = database(
      ...SETTINGS,
      "CREATE TABLE build_reviews (id TEXT, user_id TEXT, verdict TEXT, body TEXT, created_at TEXT)",
    );
    expect(() => {
      assertReviewSchema(sqlite);
    }).toThrow("table build_reviews has no column build_id");
  });

  it("also requires the reviewer and body columns", () => {
    const sqlite = database(
      ...SETTINGS,
      "CREATE TABLE build_reviews (id TEXT, build_id TEXT, verdict TEXT, created_at TEXT)",
    );
    expect(() => {
      assertReviewSchema(sqlite);
    }).toThrow("table build_reviews has no column user_id");
  });

  it("names the table, column and types of a review column of another type", () => {
    const sqlite = database(
      "CREATE TABLE projects (id TEXT, review_approvals TEXT)",
      "CREATE TABLE builds (id TEXT)",
    );
    expect(() => {
      assertReviewSchema(sqlite);
    }).toThrow("column projects.review_approvals has type TEXT, expected INTEGER");
  });
});
