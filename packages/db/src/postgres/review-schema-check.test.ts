import { describe, expect, it } from "vitest";
import { assertReviewSchema } from "./review-schema-check.ts";

type Row = { table_name: string; column_name: string; data_type: string };

const runnerOf = (rows: Row[]) => async (): Promise<unknown[]> => await Promise.resolve(rows);

const reviews: Row[] = [
  { table_name: "build_reviews", column_name: "id", data_type: "text" },
  { table_name: "build_reviews", column_name: "build_id", data_type: "text" },
  { table_name: "build_reviews", column_name: "user_id", data_type: "text" },
  { table_name: "build_reviews", column_name: "verdict", data_type: "text" },
  { table_name: "build_reviews", column_name: "body", data_type: "text" },
  { table_name: "build_reviews", column_name: "created_at", data_type: "timestamp with time zone" },
];

const settings: Row[] = [
  { table_name: "projects", column_name: "review_enabled", data_type: "boolean" },
  { table_name: "projects", column_name: "review_approvals", data_type: "integer" },
  { table_name: "builds", column_name: "review_cycle", data_type: "integer" },
  { table_name: "builds", column_name: "review_requested_cycle", data_type: "integer" },
];

const accessibility: Row[] = [
  { table_name: "projects", column_name: "run_a11y", data_type: "boolean" },
  { table_name: "snapshots", column_name: "a11y_violations", data_type: "text" },
];

describe("assertReviewSchema", () => {
  it("passes on a database with no review table or columns", async () => {
    await expect(assertReviewSchema(runnerOf([]))).resolves.toBeUndefined();
  });

  it("passes when only some columns exist, with the right types", async () => {
    await expect(assertReviewSchema(runnerOf(settings.slice(0, 2)))).resolves.toBeUndefined();
  });

  it("passes on a complete, matching schema", async () => {
    await expect(
      assertReviewSchema(runnerOf([...reviews, ...settings, ...accessibility])),
    ).resolves.toBeUndefined();
  });

  it("names the table and the missing column of a build_reviews table without a required one", async () => {
    const partial = reviews.filter((row) => row.column_name !== "build_id");
    await expect(assertReviewSchema(runnerOf(partial))).rejects.toThrow(
      "table build_reviews has no column build_id",
    );
  });

  it("requires the reviewer column", async () => {
    const partial = reviews.filter((row) => row.column_name !== "user_id");
    await expect(assertReviewSchema(runnerOf(partial))).rejects.toThrow(
      "table build_reviews has no column user_id",
    );
  });

  it("also requires the reviewer and body columns", async () => {
    const partial = reviews.filter((row) => row.column_name !== "body");
    await expect(assertReviewSchema(runnerOf(partial))).rejects.toThrow(
      "table build_reviews has no column body",
    );
  });

  it("names the table, column and types of a review column of another type", async () => {
    const wrong = settings.filter((row) => row.column_name !== "review_approvals");
    wrong.push({ table_name: "projects", column_name: "review_approvals", data_type: "text" });
    await expect(assertReviewSchema(runnerOf(wrong))).rejects.toThrow(
      "column projects.review_approvals has type text, expected integer",
    );
  });

  it("passes on matching accessibility columns", async () => {
    await expect(assertReviewSchema(runnerOf(accessibility))).resolves.toBeUndefined();
  });

  it("names the accessibility switch when it has another type", async () => {
    const wrong: Row[] = [{ table_name: "projects", column_name: "run_a11y", data_type: "text" }];
    await expect(assertReviewSchema(runnerOf(wrong))).rejects.toThrow(
      "Cannot upgrade the schema: column projects.run_a11y has type text, expected boolean",
    );
  });

  it("names the stored findings column when it has another type", async () => {
    const wrong: Row[] = [
      { table_name: "snapshots", column_name: "a11y_violations", data_type: "integer" },
    ];
    await expect(assertReviewSchema(runnerOf(wrong))).rejects.toThrow(
      "column snapshots.a11y_violations has type integer, expected text",
    );
  });
});
