import { getTableColumns, type Table } from "@storyshelf/core/orm";
import { describe, expect, it } from "vitest";
import { baseAuthTables } from "./auth-tables.ts";

/** `@storyshelf/db` does not publish its `ddl` module, so load it by file: a static import would pull another package's source into this package's type-check and declaration build. */
const ddlModule = new URL("../../db/src/sqlite/ddl.ts", import.meta.url).href;
const { DDL, tableColumns } = (await import(ddlModule)) as {
  DDL: string;
  tableColumns: (ddl: string) => Map<string, string[]>;
};

/**
 * Pin the auth drizzle definitions to the driver DDL: every table and
 * column in `auth-tables.ts` must exist in @storyshelf/db/sqlite's hand-written DDL
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
