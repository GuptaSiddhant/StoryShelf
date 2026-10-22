import type { BuildReview } from "@storyshelf/core/schema";
import { getTableColumns, getTableName } from "drizzle-orm";
import { expect, expectTypeOf, it } from "vitest";
import { DDL } from "../ddl.ts";
import { buildReviews } from "./build-review.ts";
import { schema } from "./index.ts";

it("types build_reviews rows exactly as core's BuildReview", () => {
  expectTypeOf<BuildReview>().toEqualTypeOf<typeof buildReviews.$inferSelect>();
  expect(schema.buildReviews).toBe(buildReviews);
  expect(getTableName(buildReviews)).toBe("build_reviews");
});

it("creates build_reviews and its indexes in the DDL, column for column", () => {
  const table = /CREATE TABLE IF NOT EXISTS build_reviews \((?<body>[^;]*)\);/u.exec(DDL)?.groups?.[
    "body"
  ];
  expect(table).toBeDefined();
  for (const column of Object.values(getTableColumns(buildReviews))) {
    expect(table, column.name).toMatch(new RegExp(`^\\s*${column.name} `, "mu"));
  }
  expect(DDL).toContain("build_reviews_build_id_idx ON build_reviews (build_id)");
});
