import { getTableColumns, type Table } from "@storyshelf/core/orm";
import { DDL } from "@storyshelf/db-postgres/ddl";
import { describe, expect, it } from "vitest";
import { baseAuthDateFieldsPg, baseAuthTablesPg } from "./auth-tables-pg.ts";

/**
 * Pin the pg auth definitions to the Postgres driver DDL: every table and
 * column in `auth-tables-pg.ts` must exist in db-postgres's hand-written
 * DDL. Quoted identifiers (`"user"`, `"ssoProvider"`) are normalized.
 */
const PG_TABLE_BLOCK =
  /CREATE TABLE IF NOT EXISTS\s+"?(?<table>\w+)"?\s*\((?<body>[\s\S]*?)\n\);/gu;

function pgTableColumns(ddl: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const match of ddl.matchAll(PG_TABLE_BLOCK)) {
    const name = match.groups?.["table"] ?? "";
    const columns = new Set(
      (match.groups?.["body"] ?? "")
        .split("\n")
        .map((line) => line.trim().split(/\s+/u)[0] ?? "")
        .filter(
          (fragment) =>
            fragment && !/^(?:PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\s/iu.test(fragment),
        )
        .map((fragment) => fragment.replaceAll('"', "")),
    );
    tables.set(name, columns);
  }
  return tables;
}

describe("auth DDL parity (postgres)", () => {
  it("covers every auth table and column", () => {
    const ddlTables = pgTableColumns(DDL);
    const entries = Object.entries(baseAuthTablesPg) as [string, Table][];
    for (const [model, table] of entries) {
      const columns = ddlTables.get(model);
      expect(columns, `DDL table ${model}`).toBeDefined();
      const defined = getTableColumns(table) as Record<string, { name: string }>;
      for (const key of Object.keys(defined)) {
        expect(columns?.has(defined[key]?.name ?? ""), `${model}.${key}`).toBe(true);
      }
    }
  });

  it("declares the same date fields as the sqlite definitions", async () => {
    const sqlite = await import("./auth-tables.ts");
    expect(baseAuthDateFieldsPg).toEqual(sqlite.baseAuthDateFields);
    expect(Object.keys(baseAuthTablesPg).toSorted()).toEqual(
      Object.keys(sqlite.baseAuthTables).toSorted(),
    );
  });
});
