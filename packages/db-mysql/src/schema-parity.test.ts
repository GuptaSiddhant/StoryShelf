import {
  compareCoreRowsWithDrizzle,
  compareDdlWithDrizzle,
  compareRequiredWithDdl,
  indexStatementsIn,
  CORE_ROW_TABLES,
  type GetTableConfig,
  type ParityAllowance,
} from "@storyshelf/core/test-helpers";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DDL } from "./ddl.ts";
import * as schema from "./schema/index.ts";

const CORE_SCHEMA_DIR = fileURLToPath(new URL("../../core/src/schema", import.meta.url));
const MIGRATE_SOURCE = readFileSync(
  fileURLToPath(new URL("./migrate.ts", import.meta.url)),
  "utf8",
);
const config = getTableConfig as unknown as GetTableConfig;

/** Known DDL / Drizzle differences. Every entry names the issue that removes it. */
const DDL_ALLOWANCES: readonly ParityAllowance[] = [
  {
    table: "user",
    reason: "Auth engine table: DDL only, the auth bridge has its own model registry.",
    issue: "ADR 0041 decision 3",
  },
  {
    table: "session",
    reason: "Auth engine table: DDL only, the auth bridge has its own model registry.",
    issue: "ADR 0041 decision 3",
  },
  {
    table: "account",
    reason: "Auth engine table: DDL only, the auth bridge has its own model registry.",
    issue: "ADR 0041 decision 3",
  },
  {
    table: "verification",
    reason: "Auth engine table: DDL only, the auth bridge has its own model registry.",
    issue: "ADR 0041 decision 3",
  },
  {
    table: "passkey",
    reason: "Auth engine table: DDL only, the auth bridge has its own model registry.",
    issue: "ADR 0041 decision 3",
  },
  {
    table: "ssoProvider",
    reason: "Auth engine table: DDL only, the auth bridge has its own model registry.",
    issue: "ADR 0041 decision 3",
  },
  {
    table: "notification_channels",
    index: "notification_channels_project_id_idx",
    reason: "Index in the DDL, not declared in the Drizzle schema.",
    issue: "#833",
  },
  {
    table: "notification_subscriptions",
    index: "notification_subscriptions_project_user_idx",
    reason: "Index in the DDL, not declared in the Drizzle schema.",
    issue: "#833",
  },
  {
    table: "insights",
    index: "insights_project_build_idx",
    reason: "Index in the DDL, not declared in the Drizzle schema.",
    issue: "#833",
  },
  {
    table: "insights",
    index: "insights_created_at_idx",
    reason: "Index in the DDL, not declared in the Drizzle schema.",
    issue: "#833",
  },
  {
    table: "insights",
    index: "insights_triage_unique_idx",
    reason: "Index in the DDL, not declared in the Drizzle schema.",
    issue: "#833",
  },
  {
    table: "insights",
    index: "insights_health_unique_idx",
    reason: "Index in the DDL, not declared in the Drizzle schema.",
    issue: "#833",
  },
  {
    table: "ai_usage",
    index: "ai_usage_created_at_idx",
    reason: "Index in the DDL, not declared in the Drizzle schema.",
    issue: "#833",
  },
  {
    table: "ai_usage",
    index: "ai_usage_project_created_idx",
    reason: "Index in the DDL, not declared in the Drizzle schema.",
    issue: "#833",
  },
];

/** Core row fields without a column in this dialect. Every entry names the issue that removes it. */
const CORE_ALLOWANCES: readonly ParityAllowance[] = [];

/** Tables and columns the DDL lacks on purpose. Every entry names the issue that removes it. */
const REQUIRED_ALLOWANCES: readonly ParityAllowance[] = [
  {
    table: "build_references",
    reason: "Retention lifecycle (ADR 0039) is not implemented for MySQL yet.",
    issue: "#376",
  },
  {
    table: "build_reference_generations",
    reason: "Retention lifecycle (ADR 0039) is not implemented for MySQL yet.",
    issue: "#376",
  },
  {
    table: "build_deletions",
    reason: "Retention lifecycle (ADR 0039) is not implemented for MySQL yet.",
    issue: "#376",
  },
  {
    table: "build_content_releases",
    reason: "Retention lifecycle (ADR 0039) is not implemented for MySQL yet.",
    issue: "#376",
  },
  {
    table: "builds",
    column: "retention_state",
    reason: "Retention lifecycle (ADR 0039) is not implemented for MySQL yet.",
    issue: "#376",
  },
];

describe("mysql schema parity (ADR 0041)", () => {
  it("DDL and Drizzle schema agree on tables, columns, types, nullability, defaults and indexes", () => {
    expect(
      compareDdlWithDrizzle({
        ddl: DDL,
        schema,
        getTableConfig: config,
        extraStatements: indexStatementsIn(MIGRATE_SOURCE),
        allowances: DDL_ALLOWANCES,
      }),
    ).toEqual([]);
  });

  it("the DDL carries every required table and column", () => {
    expect(compareRequiredWithDdl(DDL, REQUIRED_ALLOWANCES)).toEqual([]);
  });

  it("every core row field maps to a column", () => {
    expect(
      compareCoreRowsWithDrizzle({
        schemaDir: CORE_SCHEMA_DIR,
        rowTables: CORE_ROW_TABLES,
        schema,
        getTableConfig: config,
        allowances: CORE_ALLOWANCES,
      }),
    ).toEqual([]);
  });
});
