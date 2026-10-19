import { makeDatabase } from "@storyshelf/core/test-helpers";
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema } from "./schema/index.ts";

/**
 * The core test fake (`makeDatabase`) cannot import the real drizzle schema
 * (it lives here, above core), so it keeps stub tables with the same
 * property → column mapping. This pins the two together: a renamed or
 * re-mapped column fails here instead of silently desyncing core's tests.
 */
describe("core test fake mirrors the real sqlite schema", () => {
  const fake = makeDatabase().db.tables as unknown as Record<string, Table>;
  const real = schema as unknown as Record<string, Table>;

  it("covers exactly the same tables", () => {
    expect(Object.keys(fake).toSorted()).toEqual(Object.keys(real).toSorted());
  });

  it.each(Object.keys(fake))("%s: table and column names match", (key) => {
    const fakeTable = fake[key]!;
    const realTable = real[key]!;
    expect(getTableName(fakeTable)).toBe(getTableName(realTable));
    const realColumns = getTableColumns(realTable);
    for (const [property, column] of Object.entries(getTableColumns(fakeTable))) {
      expect(realColumns[property]?.name, `${key}.${property}`).toBe(column.name);
    }
  });
});
