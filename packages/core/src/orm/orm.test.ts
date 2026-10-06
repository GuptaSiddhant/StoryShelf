import { describe, expect, it } from "vitest";
import * as orm from "./index.ts";
import * as pgCore from "./pg-core.ts";
import * as sqliteCore from "./sqlite-core.ts";

describe("orm re-exports", () => {
  it("exposes query helpers from drizzle-orm", () => {
    expect(orm.eq).toBeTypeOf("function");
    expect(orm.getTableColumns).toBeTypeOf("function");
    expect(orm.sql).toBeTypeOf("function");
  });

  it("exposes Postgres table builders", () => {
    expect(pgCore.pgTable).toBeTypeOf("function");
    expect(pgCore.text).toBeTypeOf("function");
  });

  it("exposes SQLite table builders", () => {
    expect(sqliteCore.sqliteTable).toBeTypeOf("function");
    expect(sqliteCore.integer).toBeTypeOf("function");
  });
});
