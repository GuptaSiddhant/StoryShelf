import { DDL, tableColumns } from "@storyshelf/db-sqlite/ddl";
import { getTableColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { baseAuthTables } from "./auth-tables.ts";

/**
 * Pin the auth drizzle definitions to the driver DDL: every table and
 * column in `auth-tables.ts` must exist in db-sqlite's hand-written DDL
 * (which Turso shares). Drivers stay auth-agnostic; this test is the seam.
 */
describe("auth DDL parity", () => {
  it("covers every auth table and column", () => {
    const ddlTables = tableColumns(DDL);
    const entries = Object.entries(baseAuthTables) as [string, Table][];
    for (const [model, table] of entries) {
      const columns = ddlTables.get(model);
      expect(columns, `DDL table ${model}`).toBeDefined();
      const ddlNames = new Set((columns ?? []).map((fragment) => fragment.split(/\s+/u)[0] ?? ""));
      const defined = getTableColumns(table) as Record<string, { name: string }>;
      for (const key of Object.keys(defined)) {
        expect(ddlNames.has(defined[key]?.name ?? ""), `${model}.${key}`).toBe(true);
      }
    }
  });
});
