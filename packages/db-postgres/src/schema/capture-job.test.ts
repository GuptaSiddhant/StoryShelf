import type { CaptureJobRow } from "@storyshelf/core/schema";
import { getTableColumns, getTableName } from "drizzle-orm";
import { expect, expectTypeOf, it } from "vitest";
import { DDL } from "../ddl.ts";
import { captureJobs } from "./capture-job.ts";
import { schema } from "./index.ts";

it("types capture_jobs rows exactly as core's CaptureJobRow", () => {
  expectTypeOf<CaptureJobRow>().toEqualTypeOf<typeof captureJobs.$inferSelect>();
  expect(schema.captureJobs).toBe(captureJobs);
  expect(getTableName(captureJobs)).toBe("capture_jobs");
});

it("creates capture_jobs and its indexes in the DDL, column for column", () => {
  const table = /CREATE TABLE IF NOT EXISTS capture_jobs \((?<body>[^;]*)\);/u.exec(DDL)?.groups?.[
    "body"
  ];
  expect(table).toBeDefined();
  for (const column of Object.values(getTableColumns(captureJobs))) {
    expect(table, column.name).toMatch(new RegExp(`^\\s*${column.name} `, "mu"));
  }
  for (const index of [
    "capture_jobs_poll_idx ON capture_jobs (kind, visible_at, status)",
    "capture_jobs_job_id_idx ON capture_jobs (job_id)",
    "capture_jobs_build_id_idx ON capture_jobs (build_id)",
    "capture_jobs_entry_created_idx ON capture_jobs (entry, created_at)",
  ]) {
    expect(DDL).toContain(index);
  }
});
